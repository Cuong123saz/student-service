import { newDeclarationTemplateBinding } from './submission-document-template.js'
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
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
import {
  submissions,
  submissionFiles,
  submissionRounds,
  submissionEvents,
} from './submission.schema.js'
import { completionIssues, validateAnswers } from './submission.validation.js'
import {
  reviewerAuthorities,
  reviewVisibility,
  type ReviewAuthority,
} from './submission.authorization.js'
import {
  SubmissionError,
  missingDraft,
  revisionConflict,
  reviewForbidden,
  type ReviewDetail,
  type SubmittedStatus,
  type ResolutionAction,
  type SubmissionEventAction,
  type RoundEvidence,
  type ReviewSummary,
  type ReviewQueueQuery,
  type ReviewQueuePage,
  type VerifySubmissionFiles,
  type DraftValues,
  type DraftView,
  type SubmissionActor,
  type StoredEvidence,
} from './submission.types.js'
import { queueFilters, queueFingerprint, queueCursor, queueSearch } from './submission-queue.js'
import { personalNotifications } from '../notifications/notification.schema.js'
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
  private async activeProcessingUnit(tx: Transaction, row: DraftRow) {
    if (!row.processingUnitId) return false
    const [unit] = await tx
      .select({ id: organizationalUnits.id })
      .from(organizationalUnits)
      .where(
        and(
          eq(organizationalUnits.id, row.processingUnitId),
          eq(organizationalUnits.status, 'ACTIVE'),
        ),
      )
      .limit(1)
    return Boolean(unit)
  }
  private evidenceView(file: RoundEvidence) {
    const { storageKey: _key, ...view } = file
    return view
  }
  private async history(tx: Transaction, row: DraftRow) {
    const rounds = await tx
      .select()
      .from(submissionRounds)
      .where(eq(submissionRounds.submissionId, row.id))
      .orderBy(asc(submissionRounds.roundNumber))
    const events = await tx
      .select({
        id: submissionEvents.id,
        roundNumber: submissionRounds.roundNumber,
        action: submissionEvents.action,
        actorName: submissionEvents.actorName,
        note: submissionEvents.note,
        createdAt: submissionEvents.createdAt,
        fromReviewerName: submissionEvents.fromReviewerName,
        toReviewerName: submissionEvents.toReviewerName,
      })
      .from(submissionEvents)
      .innerJoin(submissionRounds, eq(submissionRounds.id, submissionEvents.roundId))
      .where(eq(submissionEvents.submissionId, row.id))
      .orderBy(asc(submissionEvents.toRevision))
    return {
      roundNumber: row.roundNumber,
      lastSubmittedAt: row.lastSubmittedAt?.toISOString() ?? null,
      decisionAt: row.decisionAt?.toISOString() ?? null,
      rounds: rounds.map((round) => ({
        roundNumber: round.roundNumber,
        submittedAt: round.submittedAt.toISOString(),
        studentSnapshot: round.studentSnapshot,
        values: round.values,
        files: round.files.map((file) => this.evidenceView(file)),
        source: round.source,
        declarationTemplate: round.declarationTemplate,
      })),
      events: events.map(({ fromReviewerName, toReviewerName, ...event }) => ({
        ...event,
        createdAt: event.createdAt.toISOString(),
        reassignment:
          fromReviewerName && toReviewerName ? { fromReviewerName, toReviewerName } : null,
      })),
    }
  }
  private async round(tx: Transaction, row: DraftRow, roundNumber = row.roundNumber) {
    const [round] = await tx
      .select()
      .from(submissionRounds)
      .where(
        and(
          eq(submissionRounds.submissionId, row.id),
          eq(submissionRounds.roundNumber, roundNumber),
        ),
      )
      .limit(1)
    if (!round) throw missingDraft()
    return round
  }
  private async recordEvent(
    tx: Transaction,
    actor: SubmissionActor,
    row: DraftRow,
    fromRevision: number,
    action: SubmissionEventAction,
    note: string | null = null,
    reassignment?: {
      fromReviewerUserId: string
      toReviewerUserId: string
      fromReviewerName: string
      toReviewerName: string
    },
  ) {
    const round = await this.round(tx, row)
    const [user] = await tx
      .select({ name: users.fullName })
      .from(users)
      .where(eq(users.id, actor.userId))
      .limit(1)
    if (!user) throw missingDraft()
    const [event] = await tx
      .insert(submissionEvents)
      .values({
        submissionId: row.id,
        roundId: round.id,
        action,
        actorUserId: actor.userId,
        actorName: user.name,
        note,
        fromRevision,
        toRevision: row.revision,
        ...reassignment,
      })
      .returning({ id: submissionEvents.id })
    if (!event) throw new Error('Event was not recorded')
    const recipients: { recipientUserId: string; recipientKind: 'OWNER' | 'REVIEWER' }[] = []
    if (['SUPPLEMENT_REQUESTED', 'APPROVED', 'REJECTED', 'REASSIGNED'].includes(action))
      recipients.push({ recipientUserId: row.studentUserId, recipientKind: 'OWNER' })
    const reviewer =
      action === 'SUBMITTED'
        ? row.designatedReviewerId
        : ['CLAIMED', 'RESUBMITTED', 'REASSIGNED'].includes(action)
          ? row.reviewerUserId
          : null
    if (reviewer) recipients.push({ recipientUserId: reviewer, recipientKind: 'REVIEWER' })
    if (recipients.length)
      await tx
        .insert(personalNotifications)
        .values(
          recipients.map((recipient) => ({
            ...recipient,
            submissionId: row.id,
            eventId: event.id,
          })),
        )
        .onConflictDoNothing()
    return event.id
  }
  private async recordRound(
    tx: Transaction,
    row: DraftRow,
    files: (typeof submissionFiles.$inferSelect)[],
  ) {
    await tx.insert(submissionRounds).values({
      submissionId: row.id,
      roundNumber: row.roundNumber,
      submittedAt: row.lastSubmittedAt!,
      studentSnapshot: row.studentSnapshot!,
      values: row.values,
      files: files.map((file) => ({
        id: file.id,
        attachmentKey: file.attachmentKey,
        name: file.name,
        mimeType: file.mimeType,
        size: file.size,
        sha256: file.sha256,
        signatureStatus: file.signatureStatus,
        storageKey: file.storageKey,
      })),
      source: 'LIVE',
      declarationTemplate: newDeclarationTemplateBinding(),
    })
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
      row.status === 'NEEDS_SUPPLEMENT'
        ? await this.activeProcessingUnit(tx, row)
        : row.status === 'DRAFT' &&
          Boolean(await this.available(tx, row.serviceId, row.procedureVersionId))
    return {
      ...(await this.history(tx, row)),
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
          ? row.status === 'NEEDS_SUPPLEMENT'
            ? 'Đơn vị xử lý đang tạm ngừng. Bản làm việc hiện chỉ được xem.'
            : 'Hồ sơ đã gửi và chỉ được xem. Nội dung và minh chứng đã được chốt.'
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
          roundNumber: submissions.roundNumber,
          lastSubmittedAt: submissions.lastSubmittedAt,
          decisionAt: submissions.decisionAt,
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
        lastSubmittedAt: row.lastSubmittedAt?.toISOString() ?? null,
        decisionAt: row.decisionAt?.toISOString() ?? null,
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
    if (!['DRAFT', 'NEEDS_SUPPLEMENT'].includes(row.status))
      throw new SubmissionError(
        409,
        'SUBMISSION_READ_ONLY',
        'Hồ sơ đã gửi; không thể thay đổi nội dung hoặc minh chứng.',
      )
    if (row.revision !== revision) throw revisionConflict()
    if (row.status === 'NEEDS_SUPPLEMENT' && !(await this.activeProcessingUnit(tx, row)))
      throw new SubmissionError(409, 'ROUTING_UNAVAILABLE', 'Đơn vị xử lý đang tạm ngừng.')
    if (
      row.status === 'DRAFT' &&
      !(await this.available(tx, row.serviceId, row.procedureVersionId))
    )
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
      const supplement = row.status === 'NEEDS_SUPPLEMENT'
      if (row.status !== 'DRAFT' && !supplement) return this.view(tx, row)
      if (row.revision !== revision) throw revisionConflict()
      const active = supplement
        ? null
        : await this.available(tx, row.serviceId, row.procedureVersionId)
      if (!supplement && !active)
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
      // Recheck profile and pinned routing after storage I/O; never silently reassign.
      const current = supplement
        ? null
        : await this.available(tx, row.serviceId, row.procedureVersionId)
      if (!supplement && !current)
        throw new SubmissionError(
          409,
          'PROCEDURE_UNAVAILABLE',
          'Thủ tục hoặc đơn vị xử lý đang tạm ngừng.',
        )
      const processingUnitId = supplement
        ? row.processingUnitId!
        : current!.version.config.processingUnitId
      const designatedReviewerId = supplement
        ? row.designatedReviewerId
        : current!.version.config.processorUserId
      if (supplement && !(await this.activeProcessingUnit(tx, row)))
        throw new SubmissionError(409, 'ROUTING_UNAVAILABLE', 'Đơn vị xử lý đang tạm ngừng.')
      const eligibleUserId = supplement ? row.reviewerUserId : designatedReviewerId
      const eligible = await reviewerAuthorities(tx, {
        ...(eligibleUserId ? { userId: eligibleUserId } : {}),
        unitId: processingUnitId,
        excludeUserId: actor.userId,
      }).limit(1)
      if (!eligible.length || (supplement && !row.reviewerUserId))
        throw new SubmissionError(
          409,
          'ROUTING_UNAVAILABLE',
          'Cán bộ hoặc tuyến xử lý không còn hợp lệ. Vui lòng liên hệ đơn vị xử lý.',
        )
      const now = new Date()
      const [submitted] = await tx
        .update(submissions)
        .set({
          status: supplement ? 'IN_REVIEW' : 'SUBMITTED',
          revision: row.revision + 1,
          values,
          submittedAt: row.submittedAt ?? now,
          lastSubmittedAt: now,
          roundNumber: row.roundNumber + 1,
          processingUnitId,
          designatedReviewerId,
          studentSnapshot: currentProfile,
          updatedAt: new Date(),
        })
        .where(eq(submissions.id, id))
        .returning()
      if (!submitted) throw missingDraft()
      await this.recordRound(tx, submitted, files)
      await this.recordEvent(
        tx,
        actor,
        submitted,
        row.revision,
        supplement ? 'RESUBMITTED' : 'SUBMITTED',
      )
      await this.audit(
        tx,
        actor,
        supplement ? 'SUBMISSION_RESUBMIT' : 'SUBMISSION_SUBMIT',
        submitted,
      )
      return this.view(tx, submitted)
    })
  }
  private async reviewAuthority(tx: Transaction, userId: string) {
    const authority = await reviewerAuthorities(tx, { userId })
    if (!authority.length) throw reviewForbidden()
    return authority
  }
  private reviewVisibility(userId: string, authority: ReviewAuthority[]) {
    return reviewVisibility(userId, authority)
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
      roundNumber: row.roundNumber,
      lastSubmittedAt: row.lastSubmittedAt?.toISOString() ?? null,
      decisionAt: row.decisionAt?.toISOString() ?? null,
      processingUnitName: unit?.name ?? row.procedure.processingUnitName,
      student: {
        fullName: row.studentSnapshot.fullName,
        studentCode: row.studentSnapshot.studentCode,
      },
      reviewerName: reviewer?.name ?? null,
      canClaim: row.status === 'SUBMITTED',
    }
  }
  private async allowedActions(
    tx: Transaction,
    userId: string,
    row: DraftRow,
  ): Promise<ResolutionAction[]> {
    if (row.status !== 'IN_REVIEW' || row.reviewerUserId !== userId) return []
    const review = await reviewerAuthorities(tx, {
      userId,
      unitId: row.processingUnitId!,
      excludeUserId: row.studentUserId,
    })
    if (!review.length) return []
    const reject = await reviewerAuthorities(tx, {
      userId,
      unitId: row.processingUnitId!,
      requireReject: true,
      excludeUserId: row.studentUserId,
    })
    return reject.length ? ['REQUEST_SUPPLEMENT', 'APPROVE', 'REJECT'] : ['APPROVE']
  }
  private async reviewDetail(
    tx: Transaction,
    row: DraftRow,
    userId: string,
  ): Promise<ReviewDetail> {
    const round = await this.round(tx, row)
    return {
      ...(await this.reviewSummary(tx, row)),
      ...(await this.history(tx, row)),
      serviceId: row.serviceId,
      procedure: row.procedure,
      values: round.values,
      files: round.files.map((file) => this.evidenceView(file)),
      studentSnapshot: round.studentSnapshot,
      reviewStartedAt: row.reviewStartedAt?.toISOString() ?? null,
      allowedActions: await this.allowedActions(tx, userId, row),
      canReassign: await this.canReassign(tx, userId, row),
    }
  }
  private async canReassign(tx: Transaction, userId: string, row: DraftRow) {
    return (
      ['IN_REVIEW', 'NEEDS_SUPPLEMENT'].includes(row.status) &&
      !!row.reviewerUserId &&
      userId !== row.studentUserId &&
      (await this.activeProcessingUnit(tx, row)) &&
      (
        await reviewerAuthorities(tx, {
          userId,
          unitId: row.processingUnitId!,
          excludeUserId: row.studentUserId,
          requireAssign: true,
        })
      ).length > 0
    )
  }
  async assignees(userId: string, id: string) {
    return this.database.transaction(async (tx) => {
      const authority = await this.reviewAuthority(tx, userId)
      const [row] = await tx
        .select()
        .from(submissions)
        .where(and(eq(submissions.id, id), this.reviewVisibility(userId, authority)))
        .limit(1)
      if (!row) throw missingDraft()
      if (!(await this.canReassign(tx, userId, row))) throw reviewForbidden()
      const eligible = await reviewerAuthorities(tx, {
        unitId: row.processingUnitId!,
        excludeUserId: row.studentUserId,
      })
      const ids = [...new Set(eligible.map((a) => a.userId))].filter(
        (id) => id !== row.reviewerUserId,
      )
      return {
        candidates: ids.length
          ? await tx
              .select({ id: users.id, fullName: users.fullName })
              .from(users)
              .where(inArray(users.id, ids))
              .orderBy(asc(users.fullName), asc(users.id))
          : [],
      }
    })
  }
  async reassign(
    actor: SubmissionActor,
    id: string,
    revision: number,
    reviewerUserId: string,
    rawNote: unknown,
  ): Promise<ReviewDetail> {
    const note = typeof rawNote === 'string' ? rawNote.trim() : ''
    if (!note || note.length > 2000)
      throw new SubmissionError(
        422,
        'INVALID_REASSIGNMENT',
        'Nhập lý do bàn giao từ 1 đến 2000 ký tự.',
        [{ path: 'note', message: 'Nhập lý do từ 1 đến 2000 ký tự.' }],
      )
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
      const assign = await reviewerAuthorities(tx, {
        userId: actor.userId,
        unitId: row.processingUnitId!,
        excludeUserId: row.studentUserId,
        requireAssign: true,
      })
      if (!assign.length || !(await this.activeProcessingUnit(tx, row))) throw reviewForbidden()
      const [prior] = await tx
        .select()
        .from(submissionEvents)
        .where(
          and(eq(submissionEvents.submissionId, id), eq(submissionEvents.fromRevision, revision)),
        )
        .limit(1)
      if (prior) {
        if (
          prior.action === 'REASSIGNED' &&
          prior.actorUserId === actor.userId &&
          prior.toReviewerUserId === reviewerUserId &&
          prior.note === note
        )
          return this.reviewDetail(tx, row, actor.userId)
        throw revisionConflict()
      }
      if (
        row.revision !== revision ||
        !['IN_REVIEW', 'NEEDS_SUPPLEMENT'].includes(row.status) ||
        !row.reviewerUserId
      )
        throw revisionConflict()
      const eligible = await reviewerAuthorities(tx, {
        userId: reviewerUserId,
        unitId: row.processingUnitId!,
        excludeUserId: row.studentUserId,
      })
      if (!eligible.length || reviewerUserId === row.reviewerUserId)
        throw new SubmissionError(
          422,
          'INVALID_ASSIGNEE',
          'Chọn cán bộ mới đang hoạt động và đủ quyền xử lý.',
          [
            {
              path: 'reviewerUserId',
              message: 'Cán bộ được chọn không còn đủ điều kiện nhận hồ sơ.',
            },
          ],
        )
      const people = await tx
        .select({ id: users.id, name: users.fullName })
        .from(users)
        .where(inArray(users.id, [row.reviewerUserId, reviewerUserId]))
      const from = people.find((p) => p.id === row.reviewerUserId),
        to = people.find((p) => p.id === reviewerUserId)
      if (!from || !to) throw missingDraft()
      const [updated] = await tx
        .update(submissions)
        .set({ reviewerUserId, revision: row.revision + 1, updatedAt: new Date() })
        .where(eq(submissions.id, id))
        .returning()
      if (!updated) throw missingDraft()
      await this.recordEvent(tx, actor, updated, row.revision, 'REASSIGNED', note, {
        fromReviewerUserId: from.id,
        toReviewerUserId: to.id,
        fromReviewerName: from.name,
        toReviewerName: to.name,
      })
      await this.audit(tx, actor, 'SUBMISSION_REASSIGN', updated)
      return this.reviewDetail(tx, updated, actor.userId)
    })
  }
  async reviewList(userId: string, query: ReviewQueueQuery = {}): Promise<ReviewQueuePage> {
    const filters = queueFilters(query)
    const fingerprint = queueFingerprint(userId, filters)
    const cursor = queueCursor(query.cursor, fingerprint)
    return this.database.transaction(async (tx) => {
      const authority = await this.reviewAuthority(tx, userId)
      const search = filters.q ? queueSearch(filters.q) : null
      const rows = await tx
        .select({
          id: submissions.id,
          serviceName: submissions.serviceName,
          status: submissions.status,
          revision: submissions.revision,
          submittedAt: submissions.submittedAt,
          roundNumber: submissions.roundNumber,
          lastSubmittedAt: submissions.lastSubmittedAt,
          decisionAt: submissions.decisionAt,
          processingUnitName: organizationalUnits.name,
          fullName: sql<string>`${submissions.studentSnapshot}->>'fullName'`,
          studentCode: sql<string>`${submissions.studentSnapshot}->>'studentCode'`,
          reviewerName: users.fullName,
          cursorAt: sql<string>`to_char(${submissions.submittedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        })
        .from(submissions)
        .innerJoin(organizationalUnits, eq(organizationalUnits.id, submissions.processingUnitId))
        .leftJoin(users, eq(users.id, submissions.reviewerUserId))
        .where(
          and(
            this.reviewVisibility(userId, authority),
            filters.status ? eq(submissions.status, filters.status) : undefined,
            filters.assignment === 'MINE' ? eq(submissions.reviewerUserId, userId) : undefined,
            filters.assignment === 'UNASSIGNED' ? isNull(submissions.reviewerUserId) : undefined,
            search
              ? sql`(${submissions.studentSnapshot}->>'fullName' ILIKE ${search} OR ${submissions.studentSnapshot}->>'studentCode' ILIKE ${search} OR ${submissions.serviceName} ILIKE ${search})`
              : undefined,
            cursor
              ? sql`(${submissions.submittedAt},${submissions.id}) > (${cursor[0]}::timestamptz,${cursor[1]}::uuid)`
              : undefined,
          ),
        )
        .orderBy(asc(submissions.submittedAt), asc(submissions.id))
        .limit(21)
      const page = rows.slice(0, 20)
      const last = page.at(-1)
      return {
        items: page.map((row) => ({
          id: row.id,
          serviceName: row.serviceName,
          status: row.status as SubmittedStatus,
          revision: row.revision,
          submittedAt: row.submittedAt!.toISOString(),
          roundNumber: row.roundNumber,
          lastSubmittedAt: row.lastSubmittedAt?.toISOString() ?? null,
          decisionAt: row.decisionAt?.toISOString() ?? null,
          processingUnitName: row.processingUnitName,
          student: { fullName: row.fullName, studentCode: row.studentCode },
          reviewerName: row.reviewerName,
          canClaim: row.status === 'SUBMITTED',
        })),
        nextCursor:
          rows.length > 20 && last
            ? Buffer.from(JSON.stringify([last.cursorAt, last.id, fingerprint])).toString(
                'base64url',
              )
            : null,
      }
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
      return this.reviewDetail(tx, row, userId)
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
      if (row.status !== 'SUBMITTED') {
        if (row.reviewerUserId === actor.userId) return this.reviewDetail(tx, row, actor.userId)
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
      await this.recordEvent(tx, actor, updated, row.revision, 'CLAIMED')
      await this.audit(tx, actor, 'SUBMISSION_CLAIM', updated)
      return this.reviewDetail(tx, updated, actor.userId)
    })
  }
  async resolve(
    actor: SubmissionActor,
    id: string,
    revision: number,
    action: ResolutionAction,
    rawNote: string,
  ): Promise<ReviewDetail> {
    const note = typeof rawNote === 'string' ? rawNote.trim() : ''
    if (
      !['REQUEST_SUPPLEMENT', 'APPROVE', 'REJECT'].includes(action) ||
      !note ||
      note.length > 2000
    )
      throw new SubmissionError(422, 'INVALID_DECISION', 'Nhập lý do từ 1 đến 2000 ký tự.', [
        { path: 'note', message: 'Nhập lý do từ 1 đến 2000 ký tự.' },
      ])
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
      if (row.reviewerUserId !== actor.userId)
        throw new SubmissionError(
          403,
          'FORBIDDEN',
          'Chỉ cán bộ đã nhận hồ sơ được quyết định xử lý.',
        )
      // Re-authorize before even an idempotent retry. Reject and scope belong to the review role.
      const permitted = await reviewerAuthorities(tx, {
        userId: actor.userId,
        unitId: row.processingUnitId!,
        requireReject: action !== 'APPROVE',
        excludeUserId: row.studentUserId,
      })
      if (!permitted.length) throw reviewForbidden()
      const eventAction: SubmissionEventAction =
        action === 'REQUEST_SUPPLEMENT'
          ? 'SUPPLEMENT_REQUESTED'
          : action === 'APPROVE'
            ? 'APPROVED'
            : 'REJECTED'
      const [prior] = await tx
        .select()
        .from(submissionEvents)
        .where(
          and(eq(submissionEvents.submissionId, id), eq(submissionEvents.fromRevision, revision)),
        )
        .limit(1)
      if (prior) {
        if (
          prior.actorUserId === actor.userId &&
          prior.action === eventAction &&
          prior.note === note
        )
          return this.reviewDetail(tx, row, actor.userId)
        throw revisionConflict()
      }
      if (row.revision !== revision || row.status !== 'IN_REVIEW') throw revisionConflict()
      const now = new Date()
      const [updated] = await tx
        .update(submissions)
        .set({
          status:
            action === 'REQUEST_SUPPLEMENT'
              ? 'NEEDS_SUPPLEMENT'
              : action === 'APPROVE'
                ? 'APPROVED'
                : 'REJECTED',
          revision: row.revision + 1,
          decisionAt: action === 'REQUEST_SUPPLEMENT' ? null : now,
          updatedAt: now,
        })
        .where(eq(submissions.id, id))
        .returning()
      if (!updated) throw missingDraft()
      await this.recordEvent(tx, actor, updated, row.revision, eventAction, note)
      await this.audit(tx, actor, 'SUBMISSION_' + eventAction, updated)
      return this.reviewDetail(tx, updated, actor.userId)
    })
  }
  private storedRoundFile(files: RoundEvidence[], fileId: string) {
    const file = files.find((item) => item.id === fileId)
    if (!file) throw missingDraft()
    return {
      key: file.storageKey,
      name: file.name,
      mimeType: file.mimeType,
      size: file.size,
      sha256: file.sha256,
    }
  }
  async roundFile(userId: string, id: string, roundNumber: number, fileId: string) {
    return this.database.transaction(async (tx) => {
      await this.profile(tx, userId)
      const [row] = await tx
        .select()
        .from(submissions)
        .where(and(eq(submissions.id, id), eq(submissions.studentUserId, userId)))
        .limit(1)
      if (!row) throw missingDraft()
      return this.storedRoundFile((await this.round(tx, row, roundNumber)).files, fileId)
    })
  }
  async reviewRoundFile(userId: string, id: string, roundNumber: number | null, fileId: string) {
    return this.database.transaction(async (tx) => {
      const authority = await this.reviewAuthority(tx, userId)
      const [row] = await tx
        .select()
        .from(submissions)
        .where(and(eq(submissions.id, id), this.reviewVisibility(userId, authority)))
        .limit(1)
      if (!row) throw missingDraft()
      return this.storedRoundFile(
        (await this.round(tx, row, roundNumber ?? row.roundNumber)).files,
        fileId,
      )
    })
  }
  reviewFile(userId: string, id: string, fileId: string) {
    return this.reviewRoundFile(userId, id, null, fileId)
  }
}
