import { and, eq, sql } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { submissionRounds } from './submission.schema.js'
import { SubmissionError } from './submission.types.js'
import {
  submissionDocumentSets,
  submissionDocumentJobs,
  submissionDocuments,
  type RegistryFormat,
  type RendererProvenance,
  type ConverterProvenance,
} from './submission-document-registry.schema.js'
export type RegisteredDocument = typeof submissionDocuments.$inferSelect
export interface DocumentLease {
  jobId: string
  setId: string
  format: RegistryFormat
  attemptId: string
}
export type DocumentClaim =
  | { state: 'READY'; document: RegisteredDocument }
  | { state: 'CLAIMED'; lease: DocumentLease }
  | { state: 'BUSY' | 'RETRY_LATER' | 'EXHAUSTED' | 'WORD_REQUIRED' }
export type DocumentFailure =
  'RENDER_FAILED' | 'CONVERT_FAILED' | 'STORAGE_FAILED' | 'LEASE_EXPIRED'
export interface PublishDocument {
  size: number
  sha256: string
  template: typeof submissionDocumentSets.$inferSelect.template
  renderer: RendererProvenance
  converter: ConverterProvenance | null
  sourceDocxSha256: string | null
}
export class DrizzleSubmissionDocumentRegistry {
  constructor(
    private readonly database: typeof db = db,
    private readonly leaseSeconds = 180,
    private readonly retrySeconds = 3,
  ) {
    if (
      !Number.isInteger(leaseSeconds) ||
      leaseSeconds < 1 ||
      leaseSeconds > 180 ||
      !Number.isInteger(retrySeconds) ||
      retrySeconds < 0 ||
      retrySeconds > 60
    )
      throw new Error('INVALID_DOCUMENT_LEASE_CONFIG')
  }
  async ensureSet(submissionId: string, roundNumber: number) {
    return this.database.transaction(async (tx) => {
      const [round] = await tx
        .select()
        .from(submissionRounds)
        .where(
          and(
            eq(submissionRounds.submissionId, submissionId),
            eq(submissionRounds.roundNumber, roundNumber),
          ),
        )
      if (!round) throw new SubmissionError(404, 'NOT_FOUND', 'Không tìm thấy lần gửi hồ sơ.')
      await tx
        .insert(submissionDocumentSets)
        .values({
          submissionId,
          roundId: round.id,
          kind: 'DECLARATION',
          template: round.declarationTemplate,
        })
        .onConflictDoNothing()
      const [set] = await tx
        .select()
        .from(submissionDocumentSets)
        .where(
          and(
            eq(submissionDocumentSets.roundId, round.id),
            eq(submissionDocumentSets.kind, 'DECLARATION'),
          ),
        )
      if (!set) throw new Error('DOCUMENT_SET_UNAVAILABLE')
      return set
    })
  }
  async get(setId: string, format: RegistryFormat) {
    const [document] = await this.database
      .select()
      .from(submissionDocuments)
      .where(and(eq(submissionDocuments.setId, setId), eq(submissionDocuments.format, format)))
    return document
  }
  async claim(setId: string, format: RegistryFormat): Promise<DocumentClaim> {
    const found = await this.get(setId, format)
    if (found) return { state: 'READY', document: found }
    return this.database.transaction(async (tx): Promise<DocumentClaim> => {
      // Shared across API instances. Serializes short claims, never conversion or file I/O.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(17911001, 1)`)
      const [set] = await tx
        .select()
        .from(submissionDocumentSets)
        .where(eq(submissionDocumentSets.id, setId))
        .for('update')
      if (!set) throw new Error('DOCUMENT_SET_UNAVAILABLE')
      const [ready] = await tx
        .select()
        .from(submissionDocuments)
        .where(and(eq(submissionDocuments.setId, setId), eq(submissionDocuments.format, format)))
      if (ready) return { state: 'READY', document: ready }
      if (format === 'PDF') {
        const [word] = await tx
          .select({ id: submissionDocuments.id })
          .from(submissionDocuments)
          .where(and(eq(submissionDocuments.setId, setId), eq(submissionDocuments.format, 'DOCX')))
        if (!word) return { state: 'WORD_REQUIRED' }
      }
      await tx.insert(submissionDocumentJobs).values({ setId, format }).onConflictDoNothing()
      const [job] = await tx
        .select({
          id: submissionDocumentJobs.id,
          state: submissionDocumentJobs.state,
          attempts: submissionDocumentJobs.attempts,
          expired: sql<boolean>`${submissionDocumentJobs.leaseUntil} <= clock_timestamp()`,
          due: sql<boolean>`${submissionDocumentJobs.nextAttemptAt} <= clock_timestamp()`,
        })
        .from(submissionDocumentJobs)
        .where(
          and(eq(submissionDocumentJobs.setId, setId), eq(submissionDocumentJobs.format, format)),
        )
        .for('update')
      if (!job || job.state === 'COMPLETE') throw new Error('DOCUMENT_JOB_INCONSISTENT')
      if (job.state === 'RUNNING' && !job.expired) return { state: 'BUSY' }
      if (job.attempts >= 3) {
        if (job.state === 'RUNNING')
          await tx
            .update(submissionDocumentJobs)
            .set({ state: 'RETRYABLE', leaseUntil: null, errorCode: 'LEASE_EXPIRED' })
            .where(eq(submissionDocumentJobs.id, job.id))
        return { state: 'EXHAUSTED' }
      }
      if (!job.due) return { state: 'RETRY_LATER' }
      const [capacity] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(submissionDocumentJobs)
        .where(
          and(
            eq(submissionDocumentJobs.state, 'RUNNING'),
            sql`${submissionDocumentJobs.leaseUntil} > clock_timestamp()`,
          ),
        )
      if ((capacity?.count ?? 2) >= 2) return { state: 'BUSY' }
      const [claimed] = await tx
        .update(submissionDocumentJobs)
        .set({
          state: 'RUNNING',
          attempts: job.attempts + 1,
          attemptId: sql`gen_random_uuid()`,
          leaseUntil: sql`clock_timestamp() + make_interval(secs => ${this.leaseSeconds})`,
          errorCode: null,
        })
        .where(eq(submissionDocumentJobs.id, job.id))
        .returning()
      if (!claimed?.attemptId) throw new Error('DOCUMENT_JOB_UNAVAILABLE')
      return {
        state: 'CLAIMED',
        lease: { jobId: claimed.id, setId, format, attemptId: claimed.attemptId },
      }
    })
  }
  async publish(lease: DocumentLease, metadata: PublishDocument) {
    return this.database.transaction(async (tx) => {
      await tx
        .select({ id: submissionDocumentSets.id })
        .from(submissionDocumentSets)
        .where(eq(submissionDocumentSets.id, lease.setId))
        .for('update')
      const [job] = await tx
        .select({ id: submissionDocumentJobs.id })
        .from(submissionDocumentJobs)
        .where(
          and(
            eq(submissionDocumentJobs.id, lease.jobId),
            eq(submissionDocumentJobs.setId, lease.setId),
            eq(submissionDocumentJobs.format, lease.format),
            eq(submissionDocumentJobs.attemptId, lease.attemptId),
          ),
        )
        .for('update')
      if (!job)
        throw new SubmissionError(
          503,
          'DOCUMENT_LEASE_LOST',
          'Tác vụ tạo tài liệu đã hết quyền công bố. Vui lòng thử lại.',
        )
      const [document] = await tx
        .insert(submissionDocuments)
        .values({
          ...metadata,
          setId: lease.setId,
          format: lease.format,
          attemptId: lease.attemptId,
          storageKey: lease.attemptId,
          status: 'UNSIGNED_DECLARATION',
        })
        .returning()
      if (!document) throw new Error('DOCUMENT_PUBLISH_UNAVAILABLE')
      return document
    })
  }
  async fail(lease: DocumentLease, code: DocumentFailure) {
    return this.database.transaction(async (tx) => {
      await tx
        .select({ id: submissionDocumentSets.id })
        .from(submissionDocumentSets)
        .where(eq(submissionDocumentSets.id, lease.setId))
        .for('update')
      const rows = await tx
        .update(submissionDocumentJobs)
        .set({
          state: 'RETRYABLE',
          leaseUntil: null,
          errorCode: code,
          nextAttemptAt: sql`clock_timestamp() + make_interval(secs => ${this.retrySeconds})`,
        })
        .where(
          and(
            eq(submissionDocumentJobs.id, lease.jobId),
            eq(submissionDocumentJobs.setId, lease.setId),
            eq(submissionDocumentJobs.format, lease.format),
            eq(submissionDocumentJobs.attemptId, lease.attemptId),
            eq(submissionDocumentJobs.state, 'RUNNING'),
          ),
        )
        .returning({ id: submissionDocumentJobs.id })
      return rows.length === 1
    })
  }
}
