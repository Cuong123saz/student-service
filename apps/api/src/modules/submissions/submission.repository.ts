import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { services } from '../../db/schema.js'
import { auditLogs } from '../audit/audit.schema.js'
import { users, roles, userRoles } from '../auth/auth.schema.js'
import {
  academicClasses,
  faculties,
  organizationalUnits,
  studentProfiles,
} from '../organizations/organization.schema.js'
import { procedureVersions } from '../procedures/procedure.schema.js'
import type { PublicProcedure } from '../procedures/procedure.contract.js'
import { submissions, submissionFiles } from './submission.schema.js'
import { completionIssues, validateAnswers } from './submission.validation.js'
import {
  SubmissionError,
  missingDraft,
  revisionConflict,
  type DraftValues,
  type DraftView,
  type SubmissionActor,
  type StoredEvidence,
} from './submission.types.js'
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
type DraftRow = typeof submissions.$inferSelect
export class DrizzleSubmissionRepository {
  constructor(private readonly database: typeof db = db) {}
  private async profile(tx: Transaction, userId: string) {
    const [profile] = await tx
      .select({
        studentCode: studentProfiles.studentCode,
        fullName: users.fullName,
        classCode: academicClasses.code,
        facultyCode: faculties.code,
      })
      .from(users)
      .innerJoin(userRoles, eq(users.id, userRoles.userId))
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .innerJoin(studentProfiles, eq(users.id, studentProfiles.userId))
      .innerJoin(academicClasses, eq(studentProfiles.classId, academicClasses.id))
      .innerJoin(faculties, eq(academicClasses.facultyId, faculties.id))
      .where(
        and(
          eq(users.id, userId),
          eq(users.status, 'ACTIVE'),
          eq(roles.code, 'STUDENT'),
          eq(academicClasses.status, 'ACTIVE'),
          eq(faculties.status, 'ACTIVE'),
        ),
      )
      .limit(1)
    if (!profile)
      throw new SubmissionError(
        403,
        'STUDENT_UNAVAILABLE',
        'Tài khoản hoặc hồ sơ sinh viên hiện không đủ điều kiện sử dụng.',
      )
    return profile
  }
  private async available(tx: Transaction, serviceId: number, versionId: string) {
    const [row] = await tx
      .select({ service: services, version: procedureVersions })
      .from(services)
      .innerJoin(procedureVersions, eq(procedureVersions.serviceId, services.id))
      .where(and(eq(services.id, serviceId), eq(procedureVersions.id, versionId)))
      .limit(1)
    if (
      !row ||
      row.service.status !== 'ACTIVE' ||
      row.version.status !== 'PUBLISHED' ||
      row.version.config.processingMode === 'OFFLINE'
    )
      return null
    const units = await tx
      .select()
      .from(organizationalUnits)
      .where(eq(organizationalUnits.id, row.version.config.processingUnitId))
      .limit(1)
    const owners = await tx
      .select()
      .from(organizationalUnits)
      .where(eq(organizationalUnits.id, row.version.ownerUnitId))
      .limit(1)
    if (units[0]?.status !== 'ACTIVE' || owners[0]?.status !== 'ACTIVE') return null
    return { ...row, unitName: units[0].name }
  }
  private async view(tx: Transaction, row: DraftRow): Promise<DraftView> {
    const files = await tx
      .select({
        id: submissionFiles.id,
        attachmentKey: submissionFiles.attachmentKey,
        name: submissionFiles.name,
        mimeType: submissionFiles.mimeType,
        size: submissionFiles.size,
        sha256: submissionFiles.sha256,
        signatureStatus: submissionFiles.signatureStatus,
      })
      .from(submissionFiles)
      .where(and(eq(submissionFiles.submissionId, row.id), isNull(submissionFiles.removedAt)))
      .orderBy(submissionFiles.createdAt)
    const editable = Boolean(await this.available(tx, row.serviceId, row.procedureVersionId))
    return {
      id: row.id,
      serviceId: row.serviceId,
      serviceName: row.serviceName,
      revision: row.revision,
      status: row.status,
      procedure: row.procedure,
      values: row.values,
      files,
      issues: completionIssues(row.procedure, row.values, files),
      editable,
      readOnlyReason: editable
        ? null
        : 'Biểu mẫu đã cập nhật hoặc thủ tục đang tạm ngừng. Bản nháp này chỉ được xem; hãy kiểm tra trang dịch vụ để bắt đầu với biểu mẫu hiện hành.',
      updatedAt: row.updatedAt.toISOString(),
    }
  }
  private async audit(
    tx: Transaction,
    actor: SubmissionActor,
    action: string,
    row: DraftRow,
    fileId: string | null = null,
  ) {
    await tx.insert(auditLogs).values({
      actorType: 'USER',
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action,
      resourceType: 'submission',
      resourceId: row.id,
      outcome: 'SUCCESS',
      requestId: actor.requestId,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      metadata: {
        revision: row.revision,
        serviceId: row.serviceId,
        procedureVersionId: row.procedureVersionId,
        fileId,
      },
    })
  }
  private profileValues(
    procedure: PublicProcedure,
    profile: Awaited<ReturnType<DrizzleSubmissionRepository['profile']>>,
  ) {
    return Object.fromEntries(
      procedure.fields
        .filter((f) => f.source === 'PROFILE' && f.profileKey)
        .map((f) => [f.key, profile[f.profileKey!]]),
    ) as DraftValues
  }
  async create(actor: SubmissionActor, serviceId: number, versionId: string): Promise<DraftView> {
    return this.database.transaction(async (tx) => {
      await tx
        .select({ id: services.id })
        .from(services)
        .where(eq(services.id, serviceId))
        .for('update')
      const profile = await this.profile(tx, actor.userId)
      const active = await this.available(tx, serviceId, versionId)
      if (!active)
        throw new SubmissionError(
          409,
          'PROCEDURE_UNAVAILABLE',
          'Biểu mẫu không còn được tiếp nhận trực tuyến. Hãy xem hướng dẫn trên trang dịch vụ.',
        )
      const [existing] = await tx
        .select()
        .from(submissions)
        .where(
          and(
            eq(submissions.studentUserId, actor.userId),
            eq(submissions.procedureVersionId, versionId),
          ),
        )
        .limit(1)
      if (existing) return this.view(tx, existing)
      const config = active.version.config
      const procedure: PublicProcedure = {
        versionId,
        versionNumber: active.version.versionNumber,
        processingMode: config.processingMode,
        processingUnitName: active.unitName,
        contactInstructions: config.contactInstructions,
        fields: config.fields,
        attachments: config.attachments,
        maxTotalAttachmentBytes: config.maxTotalAttachmentBytes,
      }
      const [created] = await tx
        .insert(submissions)
        .values({
          studentUserId: actor.userId,
          serviceId,
          procedureVersionId: versionId,
          serviceName: active.service.name,
          procedure,
          values: this.profileValues(procedure, profile),
        })
        .returning()
      if (!created) throw new Error('Draft insert returned no row')
      await this.audit(tx, actor, 'SUBMISSION_DRAFT_CREATE', created)
      return this.view(tx, created)
    })
  }
  async get(userId: string, id: string): Promise<DraftView> {
    return this.database.transaction(async (tx) => {
      await this.profile(tx, userId)
      const [row] = await tx
        .select()
        .from(submissions)
        .where(and(eq(submissions.id, id), eq(submissions.studentUserId, userId)))
        .limit(1)
      if (!row) throw missingDraft()
      return this.view(tx, row)
    })
  }
  async list(userId: string) {
    return this.database.transaction(async (tx) => {
      await this.profile(tx, userId)
      const rows = await tx
        .select({
          id: submissions.id,
          serviceName: submissions.serviceName,
          status: submissions.status,
          revision: submissions.revision,
          updatedAt: submissions.updatedAt,
        })
        .from(submissions)
        .where(eq(submissions.studentUserId, userId))
        .orderBy(desc(submissions.updatedAt))
        .limit(50)
      return rows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }))
    })
  }
  private async writable(tx: Transaction, userId: string, id: string, revision: number) {
    // Lock service before draft, matching procedure publication's lock order.
    const [candidate] = await tx
      .select({ serviceId: submissions.serviceId })
      .from(submissions)
      .where(and(eq(submissions.id, id), eq(submissions.studentUserId, userId)))
      .limit(1)
    if (!candidate) {
      await this.profile(tx, userId)
      throw missingDraft()
    }
    await tx
      .select({ id: services.id })
      .from(services)
      .where(eq(services.id, candidate.serviceId))
      .for('update')
    const profile = await this.profile(tx, userId)
    const [row] = await tx
      .select()
      .from(submissions)
      .where(and(eq(submissions.id, id), eq(submissions.studentUserId, userId)))
      .for('update')
    if (!row) throw missingDraft()
    if (row.revision !== revision) throw revisionConflict()
    if (!(await this.available(tx, row.serviceId, row.procedureVersionId)))
      throw new SubmissionError(
        409,
        'PROCEDURE_UNAVAILABLE',
        'Bản nháp chỉ được xem vì biểu mẫu đã cập nhật hoặc thủ tục đang tạm ngừng.',
      )
    return { row, profile }
  }
  private async touch(tx: Transaction, row: DraftRow, values = row.values) {
    const [updated] = await tx
      .update(submissions)
      .set({ revision: row.revision + 1, values, updatedAt: new Date() })
      .where(eq(submissions.id, row.id))
      .returning()
    if (!updated) throw missingDraft()
    return updated
  }
  async save(actor: SubmissionActor, id: string, revision: number, values: DraftValues) {
    return this.database.transaction(async (tx) => {
      const { row, profile } = await this.writable(tx, actor.userId, id, revision)
      const issues = validateAnswers(row.procedure, values)
      if (issues.length)
        throw new SubmissionError(
          422,
          'INVALID_ANSWERS',
          'Hãy kiểm tra các trường được đánh dấu.',
          issues,
        )
      const updated = await this.touch(tx, row, {
        ...values,
        ...this.profileValues(row.procedure, profile),
      })
      await this.audit(tx, actor, 'SUBMISSION_DRAFT_SAVE', updated)
      return this.view(tx, updated)
    })
  }
  // Resolve uncertain commit outcomes before removing a newly written storage object.
  async hasStoredFile(key: string) {
    return this.database.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '3s'`)
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}::text, 0))`)
      const rows = await tx
        .select({ id: submissionFiles.id })
        .from(submissionFiles)
        .where(eq(submissionFiles.storageKey, key))
        .limit(1)
      return rows.length > 0
    })
  }
  async addFile(
    actor: SubmissionActor,
    id: string,
    revision: number,
    attachmentKey: string,
    file: StoredEvidence,
  ) {
    return this.database.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${file.key}::text, 0))`)
      const { row } = await this.writable(tx, actor.userId, id, revision)
      const requirement = row.procedure.attachments.find((a) => a.key === attachmentKey)
      if (!requirement)
        throw new SubmissionError(422, 'ATTACHMENT_KEY', 'Minh chứng không có trong biểu mẫu.')
      const current = await tx
        .select()
        .from(submissionFiles)
        .where(and(eq(submissionFiles.submissionId, id), isNull(submissionFiles.removedAt)))
      if (
        !requirement.mimeTypes.some((type) => type === file.mimeType) ||
        file.size > requirement.maxBytes ||
        current.filter((f) => f.attachmentKey === attachmentKey).length >= requirement.maxFiles ||
        current.reduce((total, f) => total + f.size, 0) + file.size >
          row.procedure.maxTotalAttachmentBytes
      )
        throw new SubmissionError(
          422,
          'ATTACHMENT_LIMIT',
          'Tệp vượt giới hạn số lượng, dung lượng hoặc định dạng của minh chứng.',
        )
      const [inserted] = await tx
        .insert(submissionFiles)
        .values({
          submissionId: id,
          attachmentKey,
          name: file.name,
          mimeType: file.mimeType,
          size: file.size,
          sha256: file.sha256,
          storageKey: file.key,
        })
        .returning({ id: submissionFiles.id })
      if (!inserted) throw new Error('Evidence insert returned no row')
      const updated = await this.touch(tx, row)
      await this.audit(tx, actor, 'SUBMISSION_EVIDENCE_ADD', updated, inserted.id)
      return this.view(tx, updated)
    })
  }
  async removeFile(actor: SubmissionActor, id: string, revision: number, fileId: string) {
    return this.database.transaction(async (tx) => {
      const { row } = await this.writable(tx, actor.userId, id, revision)
      const removed = await tx
        .update(submissionFiles)
        .set({ removedAt: new Date() })
        .where(
          and(
            eq(submissionFiles.id, fileId),
            eq(submissionFiles.submissionId, id),
            isNull(submissionFiles.removedAt),
          ),
        )
        .returning({ id: submissionFiles.id })
      if (!removed.length) throw missingDraft()
      const updated = await this.touch(tx, row)
      await this.audit(tx, actor, 'SUBMISSION_EVIDENCE_REMOVE', updated, fileId)
      return this.view(tx, updated)
    })
  }
  async file(userId: string, id: string, fileId: string) {
    return this.database.transaction(async (tx) => {
      await this.profile(tx, userId)
      const [file] = await tx
        .select({
          key: submissionFiles.storageKey,
          name: submissionFiles.name,
          mimeType: submissionFiles.mimeType,
          sha256: submissionFiles.sha256,
        })
        .from(submissionFiles)
        .innerJoin(submissions, eq(submissions.id, submissionFiles.submissionId))
        .where(
          and(
            eq(submissions.studentUserId, userId),
            eq(submissions.id, id),
            eq(submissionFiles.id, fileId),
            isNull(submissionFiles.removedAt),
          ),
        )
        .limit(1)
      if (!file) throw missingDraft()
      return file
    })
  }
}
