import { and, eq, desc, sql } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { submissions, submissionRounds } from '../submissions/submission.schema.js'
import {
  submissionDocuments,
  submissionDocumentSets,
} from '../submissions/submission-document-registry.schema.js'
import type { DocumentVault } from '../submissions/submission-document-vault.js'
import { SubmissionError } from '../submissions/submission.types.js'
import { mockSignatureReceipts, mockSignatureChecks } from './mock-signing.schema.js'
import {
  MockSignatureProvider,
  mockReceiptSha256,
  mockSignatureNotice,
  type SignatureProvider,
  type SignatureVerification,
} from './signature-provider.js'
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
export interface MockSignInput {
  requestId: string
  expectedRevision: number
}
export interface MockVerifyInput {
  requestId: string
  receiptId: string
}
const conflict = () =>
  new SubmissionError(
    409,
    'MOCK_SIGNATURE_CONFLICT',
    'Thông tin đã đổi hoặc yêu cầu trùng mục tiêu khác. Hãy kiểm tra lại trạng thái.',
  )
const forbidden = () =>
  new SubmissionError(
    403,
    'MOCK_SIGNATURE_FORBIDDEN',
    'Bạn chưa được phân công hoặc chưa có quyền ký mô phỏng hồ sơ này.',
  )
async function locks(tx: Transaction, id: string) {
  // Short final transaction only; never hold these locks across filesystem/provider I/O.
  await tx.execute(
    sql`LOCK TABLE users,roles,user_roles,role_permissions,permissions,user_role_scopes,authorization_scopes,organizational_units,services,student_profiles,academic_classes,faculties IN SHARE MODE`,
  )
  await tx
    .select({ id: submissions.id })
    .from(submissions)
    .where(eq(submissions.id, id))
    .for('update')
}
async function allowed(tx: Transaction, userId: string, id: string, sign = false) {
  const rows = await tx.execute<{ allowed: boolean }>(
    sign
      ? sql`SELECT mock_signature_can_sign(${userId}::uuid,${id}::uuid) AS allowed`
      : sql`SELECT mock_signature_can_view(${userId}::uuid,${id}::uuid) AS allowed`,
  )
  return rows[0]?.allowed === true
}
export class DrizzleMockSigning {
  private active = 0
  private readonly provider: SignatureProvider
  constructor(
    private readonly vault: Pick<DocumentVault, 'read'>,
    options: { fakeDataOnly: true; environment: 'test' },
    private readonly database: typeof db = db,
    provider?: SignatureProvider,
  ) {
    if (
      options?.fakeDataOnly !== true ||
      options.environment !== 'test' ||
      process.env.APP_ENV !== 'test'
    )
      throw new Error('MOCK_WORKFLOW_REQUIRES_ISOLATED_TEST')
    this.provider = provider ?? new MockSignatureProvider({ fakeDataOnly: true })
  }
  private document(tx: Transaction, id: string, round: number, format: 'DOCX' | 'PDF') {
    return tx
      .select({
        document: submissionDocuments,
        roundId: submissionRounds.id,
        revision: submissions.revision,
      })
      .from(submissionDocuments)
      .innerJoin(submissionDocumentSets, eq(submissionDocumentSets.id, submissionDocuments.setId))
      .innerJoin(submissionRounds, eq(submissionRounds.id, submissionDocumentSets.roundId))
      .innerJoin(submissions, eq(submissions.id, submissionDocumentSets.submissionId))
      .where(
        and(
          eq(submissions.id, id),
          eq(submissionRounds.roundNumber, round),
          eq(submissionDocuments.format, format),
        ),
      )
      .limit(1)
  }
  async status(userId: string, id: string, round: number, review: boolean) {
    userId = userId.toLowerCase()
    id = id.toLowerCase()
    return this.database.transaction(
      async (tx) => {
        if (!(await allowed(tx, userId, id)))
          throw new SubmissionError(404, 'NOT_FOUND', 'Không tìm thấy hồ sơ.')
        const items = []
        for (const format of ['DOCX', 'PDF'] as const) {
          const [row] = await this.document(tx, id, round, format)
          const [receipt] = row
            ? await tx
                .select()
                .from(mockSignatureReceipts)
                .where(eq(mockSignatureReceipts.documentId, row.document.id))
            : []
          const checks = receipt
            ? await tx
                .select({
                  id: mockSignatureChecks.id,
                  result: mockSignatureChecks.result,
                  checkedAt: mockSignatureChecks.createdAt,
                })
                .from(mockSignatureChecks)
                .where(eq(mockSignatureChecks.receiptId, receipt.id))
                .orderBy(desc(mockSignatureChecks.createdAt), desc(mockSignatureChecks.id))
                .limit(101)
            : []
          items.push({
            format: format.toLowerCase() as 'docx' | 'pdf',
            stored: Boolean(row),
            expectedRevision: row?.revision ?? null,
            canSign: Boolean(
              review && row && !receipt && (await allowed(tx, userId, row.document.id, true)),
            ),
            receipt: receipt
              ? {
                  id: receipt.id,
                  actorId: receipt.actorUserId,
                  simulatedAt: receipt.receipt.simulatedAt,
                  document: receipt.receipt.document,
                  notice: mockSignatureNotice,
                  technicalSignatureStatus: 'NOT_VERIFIED' as const,
                  legalEffect: false as const,
                }
              : null,
            checks: checks
              .slice(0, 100)
              .reverse()
              .map((c) => ({ ...c, checkedAt: c.checkedAt.toISOString() })),
            historyTruncated: checks.length > 100,
          })
        }
        return {
          enabled: true,
          notice: mockSignatureNotice,
          workflow: 'APPROVED_REVIEWER_MOCK' as const,
          documents: items,
        }
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    )
  }
  async sign(
    userId: string,
    id: string,
    round: number,
    format: 'DOCX' | 'PDF',
    input: MockSignInput,
  ) {
    userId = userId.toLowerCase()
    id = id.toLowerCase()
    input = { ...input, requestId: input.requestId.toLowerCase() }
    if (this.active >= 2)
      throw new SubmissionError(
        503,
        'MOCK_SIGNATURE_BUSY',
        'Đang xử lý mô phỏng. Vui lòng thử lại.',
      )
    this.active++
    try {
      const preflight = await this.database.transaction(async (tx) => {
        const [row] = await this.document(tx, id, round, format)
        if (!row || !(await allowed(tx, userId, row.document.id, true))) throw forbidden()
        if (row.revision !== input.expectedRevision) throw conflict()
        const [existing] = await tx
          .select()
          .from(mockSignatureReceipts)
          .where(eq(mockSignatureReceipts.id, input.requestId))
        if (
          existing &&
          (existing.documentId !== row.document.id ||
            existing.actorUserId !== userId ||
            existing.submissionRevision !== input.expectedRevision)
        )
          throw conflict()
        return { row, existing }
      })
      const { row, existing } = preflight
      const bytes = await this.vault.read(row.document.storageKey, {
        size: row.document.size,
        sha256: row.document.sha256,
      })
      const binding = {
        documentId: row.document.id,
        submissionId: id,
        roundId: row.roundId,
        format,
        size: row.document.size,
        sha256: row.document.sha256,
      }
      const receipt =
        existing?.receipt ??
        (await this.provider.sign({ document: binding, actorId: userId, bytes }))
      if (existing && mockReceiptSha256(receipt) !== existing.receiptSha256) throw conflict()
      return await this.database.transaction(async (tx) => {
        await locks(tx, id)
        const [current] = await this.document(tx, id, round, format)
        if (!current || !(await allowed(tx, userId, current.document.id, true))) throw forbidden()
        if (current.revision !== input.expectedRevision || current.document.id !== row.document.id)
          throw conflict()
        const [replay] = await tx
          .select()
          .from(mockSignatureReceipts)
          .where(eq(mockSignatureReceipts.id, input.requestId))
        if (replay) {
          if (
            replay.documentId !== row.document.id ||
            replay.actorUserId !== userId ||
            replay.submissionRevision !== input.expectedRevision
          )
            throw conflict()
          return {
            id: replay.id,
            notice: mockSignatureNotice,
            replayed: true,
            technicalSignatureStatus: 'NOT_VERIFIED',
            legalEffect: false,
          }
        }
        const [signed] = await tx
          .select({ id: mockSignatureReceipts.id })
          .from(mockSignatureReceipts)
          .where(eq(mockSignatureReceipts.documentId, row.document.id))
        if (signed) throw conflict()
        await tx.insert(mockSignatureReceipts).values({
          id: input.requestId,
          documentId: row.document.id,
          actorUserId: userId,
          submissionRevision: input.expectedRevision,
          receipt,
          receiptSha256: mockReceiptSha256(receipt),
        })
        return {
          id: input.requestId,
          notice: mockSignatureNotice,
          replayed: false,
          technicalSignatureStatus: 'NOT_VERIFIED',
          legalEffect: false,
        }
      })
    } finally {
      this.active--
    }
  }
  async verify(
    userId: string,
    id: string,
    round: number,
    format: 'DOCX' | 'PDF',
    input: MockVerifyInput,
  ) {
    userId = userId.toLowerCase()
    id = id.toLowerCase()
    input = {
      ...input,
      requestId: input.requestId.toLowerCase(),
      receiptId: input.receiptId.toLowerCase(),
    }
    if (this.active >= 2)
      throw new SubmissionError(
        503,
        'MOCK_SIGNATURE_BUSY',
        'Đang xử lý mô phỏng. Vui lòng thử lại.',
      )
    this.active++
    try {
      const preflight = await this.database.transaction(async (tx) => {
        if (!(await allowed(tx, userId, id)))
          throw new SubmissionError(404, 'NOT_FOUND', 'Không tìm thấy hồ sơ.')
        const [row] = await this.document(tx, id, round, format)
        const [receipt] = await tx
          .select()
          .from(mockSignatureReceipts)
          .where(eq(mockSignatureReceipts.id, input.receiptId))
        if (!row || !receipt || receipt.documentId !== row.document.id)
          throw new SubmissionError(404, 'NOT_FOUND', 'Không tìm thấy kết quả mô phỏng.')
        return { row, receipt }
      })
      const { row, receipt } = preflight
      let result: SignatureVerification
      try {
        const bytes = await this.vault.read(row.document.storageKey, {
          size: row.document.size,
          sha256: row.document.sha256,
        })
        result = await this.provider.verify(
          receipt.receipt,
          {
            document: {
              documentId: row.document.id,
              submissionId: id,
              roundId: row.roundId,
              format,
              size: row.document.size,
              sha256: row.document.sha256,
            },
            actorId: receipt.actorUserId,
            bytes,
          },
          receipt.receiptSha256,
        )
      } catch (error) {
        if (!(error instanceof SubmissionError) || error.code !== 'DOCUMENT_INTEGRITY') throw error
        result = {
          outcome: 'SIMULATION_MISMATCH',
          reason: 'DOCUMENT_CHANGED',
          technicalSignatureStatus: 'NOT_VERIFIED',
          legalEffect: false,
          notice: mockSignatureNotice,
        }
      }
      return await this.database.transaction(async (tx) => {
        await locks(tx, id)
        if (!(await allowed(tx, userId, id)))
          throw new SubmissionError(404, 'NOT_FOUND', 'Không tìm thấy hồ sơ.')
        const [existing] = await tx
          .select()
          .from(mockSignatureChecks)
          .where(eq(mockSignatureChecks.id, input.requestId))
        if (existing) {
          if (existing.receiptId !== receipt.id || existing.actorUserId !== userId) throw conflict()
          return { id: existing.id, ...existing.result, replayed: true }
        }
        await tx
          .insert(mockSignatureChecks)
          .values({ id: input.requestId, receiptId: receipt.id, actorUserId: userId, result })
        return { id: input.requestId, ...result, replayed: false }
      })
    } finally {
      this.active--
    }
  }
}
export type MockSigningOperations = Pick<DrizzleMockSigning, 'status' | 'sign' | 'verify'>
