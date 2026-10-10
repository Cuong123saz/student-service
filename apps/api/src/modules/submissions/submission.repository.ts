import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm'
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
import { reviewerAuthorities, type ReviewAuthority } from './submission.authorization.js'
import {
  SubmissionError,
  missingDraft,
  revisionConflict,
  reviewForbidden,
  type ReviewDetail,
  type ReviewSummary,
  type VerifySubmissionFiles,
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
          eq(users.mustChangePassword, false),
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
    const editable =
      row.status === 'DRAFT' &&
      Boolean(await this.available(tx, row.serviceId, row.procedureVersionId))
    return {
      id: row.id,
      serviceId: row.serviceId,
      serviceName: row.serviceName,
      revision: row.revision,
      status: row.status,
      submittedAt: row.submittedAt?.toISOString() ?? null,
      reviewStartedAt: row.reviewStartedAt?.toISOString() ?? null,
      procedure: row.procedure,
      values: row.values,
      files,
      issues: completionIssues(row.procedure, row.values, files),
      editable,
      readOnlyReason: editable
        ? null
        : row.status !== 'DRAFT'
          ? 'Hồ sơ đã gửi và chỉ được xem. Nội dung và minh chứng đã được chốt.'
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
          submittedAt: submissions.submittedAt,
          reviewStartedAt: submissions.reviewStartedAt,
          updatedAt: submissions.updatedAt,
        })
        .from(submissions)
        .where(eq(submissions.studentUserId, userId))
        .orderBy(desc(submissions.updatedAt))
        .limit(50)
      return rows.map((row) => ({
        ...row,
        submittedAt: row.submittedAt?.toISOString() ?? null,
        reviewStartedAt: row.reviewStartedAt?.toISOString() ?? null,
        updatedAt: row.updatedAt.toISOString(),
      }))
    })
  }
  private async lockOwned(tx: Transaction, userId: string, id: string) {
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
    return { row, profile }
  }
  private async writable(tx: Transaction, userId: string, id: string, revision: number) {
    const { row, profile } = await this.lockOwned(tx, userId, id)
    if (row.status !== 'DRAFT')
      throw new SubmissionError(
        409,
        'SUBMISSION_READ_ONLY',
        'Hồ sơ đã gửi; không thể thay đổi nội dung hoặc minh chứng.',
      )
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
          size: submissionFiles.size,
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

  async submit(
    actor: SubmissionActor,
    id: string,
    revision: number,
    verifyFiles: VerifySubmissionFiles,
  ) {
    return this.database.transaction(async (tx) => {
      const { row, profile } = await this.lockOwned(tx, actor.userId, id)
      if (row.status !== 'DRAFT') return this.view(tx, row)
      if (row.revision !== revision) throw revisionConflict()
      const active = await this.available(tx, row.serviceId, row.procedureVersionId)
      if (!active)
        throw new SubmissionError(
          409,
          'PROCEDURE_UNAVAILABLE',
          'Biểu mẫu không còn được tiếp nhận trực tuyến.',
        )
      const inputValues = Object.fromEntries(
        Object.entries(row.values).filter(
          ([key]) =>
            !row.procedure.fields.some((field) => field.key === key && field.source === 'PROFILE'),
        ),
      )
      let values = { ...inputValues, ...this.profileValues(row.procedure, profile) }
      const files = await tx
        .select()
        .from(submissionFiles)
        .where(and(eq(submissionFiles.submissionId, id), isNull(submissionFiles.removedAt)))
      const issues = [
        ...validateAnswers(row.procedure, values, true),
        ...completionIssues(row.procedure, values, files),
      ]
      for (const file of files) {
        const requirement = row.procedure.attachments.find(
          (item) => item.key === file.attachmentKey,
        )
        if (
          !requirement ||
          !requirement.mimeTypes.includes(
            file.mimeType as 'application/pdf' | 'image/png' | 'image/jpeg',
          ) ||
          file.size <= 0 ||
          file.size > requirement.maxBytes ||
          files.filter((item) => item.attachmentKey === file.attachmentKey).length >
            requirement.maxFiles
        )
          issues.push({
            path: 'attachments.' + file.attachmentKey,
            message: 'Minh chứng không đúng yêu cầu của biểu mẫu.',
          })
      }
      if (
        files.reduce((total, file) => total + file.size, 0) > row.procedure.maxTotalAttachmentBytes
      )
        issues.push({ path: 'attachments', message: 'Tổng dung lượng minh chứng vượt giới hạn.' })
      if (issues.length)
        throw new SubmissionError(
          422,
          'INCOMPLETE_SUBMISSION',
          'Hãy kiểm tra và bổ sung nội dung trước khi gửi.',
          issues,
        )
      await verifyFiles(
        files.map((file) => ({ key: file.storageKey, size: file.size, sha256: file.sha256 })),
      )
      const currentProfile = await this.profile(tx, actor.userId)
      values = { ...inputValues, ...this.profileValues(row.procedure, currentProfile) }
      const refreshedIssues = [
        ...validateAnswers(row.procedure, values, true),
        ...completionIssues(row.procedure, values, files),
      ]
      if (refreshedIssues.length)
        throw new SubmissionError(
          422,
          'INCOMPLETE_SUBMISSION',
          'Thông tin hồ sơ hiện tại chưa đầy đủ.',
          refreshedIssues,
        )
      // Recheck routing after storage I/O. Never silently reroute a designated submission.
      const current = await this.available(tx, row.serviceId, row.procedureVersionId)
      if (!current)
        throw new SubmissionError(
          409,
          'PROCEDURE_UNAVAILABLE',
          'Thủ tục hoặc đơn vị xử lý đang tạm ngừng.',
        )
      const config = current.version.config
      const eligible = await reviewerAuthorities(tx, {
        ...(config.processorUserId ? { userId: config.processorUserId } : {}),
        unitId: config.processingUnitId,
        excludeUserId: actor.userId,
      }).limit(1)
      if (!eligible.length)
        throw new SubmissionError(
          409,
          'ROUTING_UNAVAILABLE',
          'Chưa có cán bộ hợp lệ tiếp nhận hồ sơ. Vui lòng liên hệ đơn vị xử lý.',
        )
      const [submitted] = await tx
        .update(submissions)
        .set({
          status: 'SUBMITTED',
          revision: row.revision + 1,
          values,
          submittedAt: new Date(),
          processingUnitId: config.processingUnitId,
          designatedReviewerId: config.processorUserId,
          studentSnapshot: currentProfile,
          updatedAt: new Date(),
        })
        .where(eq(submissions.id, id))
        .returning()
      if (!submitted) throw missingDraft()
      await this.audit(tx, actor, 'SUBMISSION_SUBMIT', submitted)
      return this.view(tx, submitted)
    })
  }
  private async reviewAuthority(tx: Transaction, userId: string) {
    const authority = await reviewerAuthorities(tx, { userId })
    if (!authority.length) throw reviewForbidden()
    return authority
  }
  private reviewVisibility(userId: string, authority: ReviewAuthority[]) {
    const global = authority.some((scope) => scope.scopeType === 'GLOBAL')
    const units = authority.flatMap((scope) => (scope.unitId ? [scope.unitId] : []))
    return and(
      inArray(submissions.status, ['SUBMITTED', 'IN_REVIEW']),
      ne(submissions.studentUserId, userId),
      or(isNull(submissions.designatedReviewerId), eq(submissions.designatedReviewerId, userId)),
      global ? sql`true` : units.length ? inArray(submissions.processingUnitId, units) : sql`false`,
      sql`EXISTS (SELECT 1 FROM organizational_units intake_unit WHERE intake_unit.id = ${submissions.processingUnitId} AND intake_unit.status = 'ACTIVE')`,
    )
  }
  private async reviewSummary(tx: Transaction, row: DraftRow): Promise<ReviewSummary> {
    if (!row.studentSnapshot || !row.submittedAt || row.status === 'DRAFT')
      throw new Error('Invalid submitted state')
    const [unit] = await tx
      .select({ name: organizationalUnits.name })
      .from(organizationalUnits)
      .where(eq(organizationalUnits.id, row.processingUnitId!))
      .limit(1)
    const reviewer = row.reviewerUserId
      ? (
          await tx
            .select({ name: users.fullName })
            .from(users)
            .where(eq(users.id, row.reviewerUserId))
            .limit(1)
        )[0]
      : null
    return {
      id: row.id,
      serviceName: row.serviceName,
      status: row.status,
      revision: row.revision,
      submittedAt: row.submittedAt.toISOString(),
      processingUnitName: unit?.name ?? row.procedure.processingUnitName,
      student: {
        fullName: row.studentSnapshot.fullName,
        studentCode: row.studentSnapshot.studentCode,
      },
      reviewerName: reviewer?.name ?? null,
      canClaim: row.status === 'SUBMITTED',
    }
  }
  private async reviewDetail(tx: Transaction, row: DraftRow): Promise<ReviewDetail> {
    const view = await this.view(tx, row)
    return {
      ...(await this.reviewSummary(tx, row)),
      serviceId: row.serviceId,
      procedure: row.procedure,
      values: row.values,
      files: view.files,
      studentSnapshot: row.studentSnapshot!,
      reviewStartedAt: row.reviewStartedAt?.toISOString() ?? null,
    }
  }
  async reviewList(userId: string, status?: 'SUBMITTED' | 'IN_REVIEW'): Promise<ReviewSummary[]> {
    return this.database.transaction(async (tx) => {
      const authority = await this.reviewAuthority(tx, userId)
      const rows = await tx
        .select()
        .from(submissions)
        .where(
          and(
            this.reviewVisibility(userId, authority),
            status ? eq(submissions.status, status) : undefined,
          ),
        )
        .orderBy(asc(submissions.submittedAt), asc(submissions.id))
        .limit(50)
      const result: ReviewSummary[] = []
      for (const row of rows) result.push(await this.reviewSummary(tx, row))
      return result
    })
  }
  async reviewGet(userId: string, id: string): Promise<ReviewDetail> {
    return this.database.transaction(async (tx) => {
      const authority = await this.reviewAuthority(tx, userId)
      const [row] = await tx
        .select()
        .from(submissions)
        .where(and(eq(submissions.id, id), this.reviewVisibility(userId, authority)))
        .limit(1)
      if (!row) throw missingDraft()
      return this.reviewDetail(tx, row)
    })
  }
  async claim(actor: SubmissionActor, id: string, revision: number): Promise<ReviewDetail> {
    return this.database.transaction(async (tx) => {
      await this.reviewAuthority(tx, actor.userId)
      const [candidate] = await tx
        .select({ serviceId: submissions.serviceId })
        .from(submissions)
        .where(eq(submissions.id, id))
        .limit(1)
      if (!candidate) throw missingDraft()
      await tx
        .select({ id: services.id })
        .from(services)
        .where(eq(services.id, candidate.serviceId))
        .for('update')
      const authority = await this.reviewAuthority(tx, actor.userId)
      const [row] = await tx
        .select()
        .from(submissions)
        .where(and(eq(submissions.id, id), this.reviewVisibility(actor.userId, authority)))
        .for('update')
      if (!row) throw missingDraft()
      if (row.status === 'IN_REVIEW') {
        if (row.reviewerUserId === actor.userId) return this.reviewDetail(tx, row)
        throw new SubmissionError(409, 'ALREADY_CLAIMED', 'Hồ sơ đã được cán bộ khác nhận xử lý.')
      }
      if (row.revision !== revision) throw revisionConflict()
      const [updated] = await tx
        .update(submissions)
        .set({
          status: 'IN_REVIEW',
          revision: row.revision + 1,
          reviewerUserId: actor.userId,
          reviewStartedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(submissions.id, id))
        .returning()
      if (!updated) throw missingDraft()
      await this.audit(tx, actor, 'SUBMISSION_CLAIM', updated)
      return this.reviewDetail(tx, updated)
    })
  }
  async reviewFile(userId: string, id: string, fileId: string) {
    return this.database.transaction(async (tx) => {
      const authority = await this.reviewAuthority(tx, userId)
      const [file] = await tx
        .select({
          key: submissionFiles.storageKey,
          name: submissionFiles.name,
          mimeType: submissionFiles.mimeType,
          size: submissionFiles.size,
          sha256: submissionFiles.sha256,
        })
        .from(submissionFiles)
        .innerJoin(submissions, eq(submissions.id, submissionFiles.submissionId))
        .where(
          and(
            eq(submissions.id, id),
            eq(submissionFiles.id, fileId),
            isNull(submissionFiles.removedAt),
            this.reviewVisibility(userId, authority),
          ),
        )
        .limit(1)
      if (!file) throw missingDraft()
      return file
    })
  }
}
