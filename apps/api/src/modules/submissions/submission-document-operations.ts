import { and, eq, sql } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { submissions, submissionRounds } from './submission.schema.js'
import { reviewerAuthorities, reviewVisibility } from './submission.authorization.js'
import {
  submissionDocumentSets,
  submissionDocumentJobs,
  submissionDocuments,
  submissionDocumentRetries,
  type RegistryFormat,
  type DocumentRetryReason,
} from './submission-document-registry.schema.js'
import { SubmissionError } from './submission.types.js'
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
export interface DocumentRetryInput {
  requestId: string
  expectedAttemptId: string
  reasonCode: DocumentRetryReason
}
export const documentRetryReasons = {
  RENDER_FAILED: 'RENDERER_FIXED',
  CONVERT_FAILED: 'CONVERTER_FIXED',
  STORAGE_FAILED: 'STORAGE_FIXED',
  LEASE_EXPIRED: 'WORKER_RESTARTED',
} as const
function conflict() {
  return new SubmissionError(
    409,
    'DOCUMENT_RETRY_CONFLICT',
    'Tình trạng tài liệu đã đổi hoặc không còn đủ điều kiện. Hãy kiểm tra lại trước khi mở lượt.',
  )
}
async function permitted(tx: Transaction, userId: string, submissionId: string) {
  const authority = await reviewerAuthorities(tx, { userId, requireDocumentRetry: true })
  const [row] = await tx
    .select({ id: submissions.id })
    .from(submissions)
    .where(and(eq(submissions.id, submissionId), reviewVisibility(userId, authority)))
    .limit(1)
  return Boolean(row)
}
export class DrizzleSubmissionDocumentOperations {
  constructor(private readonly database: typeof db = db) {}
  async status(userId: string, submissionId: string, roundNumber: number, review: boolean) {
    return this.database.transaction(
      async (tx) => {
        const [set] = await tx
          .select({ id: submissionDocumentSets.id })
          .from(submissionDocumentSets)
          .innerJoin(submissionRounds, eq(submissionRounds.id, submissionDocumentSets.roundId))
          .where(
            and(
              eq(submissionDocumentSets.submissionId, submissionId),
              eq(submissionRounds.roundNumber, roundNumber),
            ),
          )
        const canRetry = review && (await permitted(tx, userId, submissionId))
        const jobs = set
          ? await tx
              .select({
                job: submissionDocumentJobs,
                expired: sql<boolean>`${submissionDocumentJobs.leaseUntil} <= clock_timestamp()`,
                due: sql<boolean>`${submissionDocumentJobs.nextAttemptAt} <= clock_timestamp()`,
              })
              .from(submissionDocumentJobs)
              .where(eq(submissionDocumentJobs.setId, set.id))
          : []
        const docs = set
          ? await tx
              .select({ format: submissionDocuments.format })
              .from(submissionDocuments)
              .where(eq(submissionDocuments.setId, set.id))
          : []
        return {
          enabled: true,
          documents: (['DOCX', 'PDF'] as const).map((format) => {
            const found = jobs.find((row) => row.job.format === format)
            const job = found?.job
            const attemptLimit = 3 + (job?.retryAllowance ?? 0)
            const running = job?.state === 'RUNNING' && !found?.expired
            const exhausted = !running && Boolean(job && job.attempts >= attemptLimit)
            const ready = docs.some((doc) => doc.format === format)
            return {
              format: format.toLowerCase() as 'docx' | 'pdf',
              state: ready
                ? 'READY'
                : running
                  ? 'RUNNING'
                  : exhausted
                    ? 'EXHAUSTED'
                    : !job
                      ? 'NOT_STARTED'
                      : 'WAITING',
              attempts: job?.attempts ?? 0,
              attemptLimit,
              attemptId: job?.attemptId ?? null,
              errorCode:
                job?.state === 'RUNNING' && found?.expired
                  ? 'LEASE_EXPIRED'
                  : (job?.errorCode ?? null),
              nextAttemptAt:
                job && !ready && !running && !exhausted && !found?.due
                  ? job.nextAttemptAt.toISOString()
                  : null,
              retryAllowed: Boolean(
                !ready && exhausted && canRetry && job && job.retryAllowance < 3,
              ),
              remainingAuthorizations: 3 - (job?.retryAllowance ?? 0),
            }
          }),
        }
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    )
  }
  async retry(
    userId: string,
    submissionId: string,
    roundNumber: number,
    format: RegistryFormat,
    input: DocumentRetryInput,
  ) {
    return this.database.transaction(async (tx) => {
      if (!(await permitted(tx, userId, submissionId)))
        throw new SubmissionError(
          403,
          'DOCUMENT_RETRY_FORBIDDEN',
          'Bạn chưa có quyền mở thêm lượt tạo tài liệu cho hồ sơ này.',
        )
      const [set] = await tx
        .select({ id: submissionDocumentSets.id })
        .from(submissionDocumentSets)
        .innerJoin(submissionRounds, eq(submissionRounds.id, submissionDocumentSets.roundId))
        .where(
          and(
            eq(submissionDocumentSets.submissionId, submissionId),
            eq(submissionRounds.roundNumber, roundNumber),
          ),
        )
        .for('update', { of: submissionDocumentSets })
      if (!set) throw conflict()
      const [found] = await tx
        .select({
          job: submissionDocumentJobs,
          expired: sql<boolean>`${submissionDocumentJobs.leaseUntil} <= clock_timestamp()`,
        })
        .from(submissionDocumentJobs)
        .where(
          and(eq(submissionDocumentJobs.setId, set.id), eq(submissionDocumentJobs.format, format)),
        )
        .for('update')
      if (!found) throw conflict()
      // Recheck after lock waits, including an idempotent replay.
      if (!(await permitted(tx, userId, submissionId)))
        throw new SubmissionError(
          403,
          'DOCUMENT_RETRY_FORBIDDEN',
          'Quyền mở lượt tạo tài liệu đã thay đổi. Hãy tải lại hồ sơ.',
        )
      const [prior] = await tx
        .select()
        .from(submissionDocumentRetries)
        .where(eq(submissionDocumentRetries.id, input.requestId))
      const job = found.job
      if (prior) {
        if (
          prior.jobId !== job.id ||
          prior.actorUserId !== userId ||
          prior.attemptId !== input.expectedAttemptId ||
          prior.reasonCode !== input.reasonCode
        )
          throw conflict()
        return { requestId: prior.id, attemptLimit: 3 + prior.allowance, alreadyApplied: true }
      }
      const errorCode = job.state === 'RUNNING' && found.expired ? 'LEASE_EXPIRED' : job.errorCode
      if (
        job.attempts !== 3 + job.retryAllowance ||
        job.retryAllowance >= 3 ||
        job.attemptId !== input.expectedAttemptId ||
        !(job.state === 'RETRYABLE' || (job.state === 'RUNNING' && found.expired)) ||
        !errorCode ||
        documentRetryReasons[errorCode as keyof typeof documentRetryReasons] !== input.reasonCode
      )
        throw conflict()
      await tx.insert(submissionDocumentRetries).values({
        id: input.requestId,
        jobId: job.id,
        attemptId: input.expectedAttemptId,
        attempts: job.attempts,
        allowance: job.retryAllowance + 1,
        actorUserId: userId,
        reasonCode: input.reasonCode,
      })
      return {
        requestId: input.requestId,
        attemptLimit: 4 + job.retryAllowance,
        alreadyApplied: false,
      }
    })
  }
}
export type SubmissionDocumentOperations = Pick<
  DrizzleSubmissionDocumentOperations,
  'status' | 'retry'
>
