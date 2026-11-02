import type { Sql, TransactionSql } from 'postgres'
import { databaseClient } from '../../db/client.js'
import { SubmissionError, type SubmissionActor } from '../submissions/submission.types.js'
import type { Criterion } from '../training-points/training-points.types.js'
import {
  computeSuggestion,
  defaultSettings,
  validateSettings,
  type SuggestionFacts,
  type SuggestionSettings,
} from './activity-suggestion.js'
import { ActivityRepository } from './activity.repository.js'

type Tx = TransactionSql
const fail = (n: number, code: string, msg: string) => new SubmissionError(n, code, msg)
const iso = (c: string) => `to_char(${c} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`
/** ADR 0033 assumption: the committee can be edited until 30 days after the end. */
const organizerEditDays = 30

interface PeriodRow {
  id: string
  classId: string
  academicYear: string
  semester: '1' | '2' | 'SUMMER'
  criteria: Criterion[]
}
export interface Organizer {
  id: string
  studentUserId: string
  studentCode: string
  fullName: string
  addedBy: string
  addedAt: string
}

/** ADR 0033: suggestions computed on read from certificates; settings per period; committee. */
export class ActivitySuggestionRepository {
  private readonly activities: ActivityRepository
  constructor(private readonly db: Sql = databaseClient) {
    this.activities = new ActivityRepository(db)
  }

  private async period(tx: Tx, id: string) {
    const [p] = await tx<PeriodRow[]>`
      SELECT id,class_id AS "classId",academic_year AS "academicYear",semester,criteria FROM training_periods WHERE id=${id}`
    return p
  }
  private async settings(tx: Tx, p: PeriodRow) {
    const [row] = await tx<{ config: SuggestionSettings; revision: number }[]>`
      SELECT config,revision FROM training_activity_settings WHERE period_id=${p.id}`
    return row
      ? { settings: row.config, revision: row.revision, isDefault: false }
      : { settings: defaultSettings(p.academicYear, p.semester), revision: 0, isDefault: true }
  }
  private async facts(tx: Tx, student: string, s: SuggestionSettings): Promise<SuggestionFacts> {
    const { from, to } = s.window
    const mandatory = await tx<SuggestionFacts['mandatory']>`
      SELECT a.id AS "activityId",a.title,
        (SELECT c.code FROM activity_certificates c WHERE c.activity_id=a.id AND c.student_user_id=${student} AND c.status='ISSUED' LIMIT 1) AS "certificateCode",
        EXISTS(SELECT 1 FROM activity_registrations r WHERE r.activity_id=a.id AND r.student_user_id=${student}
          AND (r.excused OR (r.status='CANCEL_REQUESTED' AND a.starts_at<=clock_timestamp()))) AS excused
      FROM activities a
      WHERE a.kind='MANDATORY' AND a.category='SCHOOL' AND a.status='PUBLISHED' AND a.ends_at<=clock_timestamp()
        AND a.starts_at>=${from} AND a.starts_at<${to}
        AND (activity_student_eligible(${student}::uuid,a.id) OR EXISTS(SELECT 1 FROM activity_registrations r WHERE r.activity_id=a.id AND r.student_user_id=${student}))
      ORDER BY a.starts_at,a.id LIMIT 200`
    const certificates = await tx<SuggestionFacts['certificates']>`
      SELECT c.code,a.id AS "activityId",a.title,a.kind,a.category FROM activity_certificates c JOIN activities a ON a.id=c.activity_id
      WHERE c.student_user_id=${student} AND c.status='ISSUED' AND a.status<>'CANCELLED' AND a.starts_at>=${from} AND a.starts_at<${to}
      ORDER BY a.starts_at,c.code LIMIT 500`
    const organizer = await tx<SuggestionFacts['organizer']>`
      SELECT a.id AS "activityId",a.title FROM activity_organizers o JOIN activities a ON a.id=o.activity_id
      WHERE o.student_user_id=${student} AND o.removed_at IS NULL AND a.category='CLUB_ACADEMIC' AND a.status NOT IN ('DRAFT','CANCELLED')
        AND a.ends_at<=clock_timestamp() AND a.starts_at>=${from} AND a.starts_at<${to}
      ORDER BY a.starts_at,a.id LIMIT 200`
    return { mandatory, certificates, organizer }
  }
  private async compute(tx: Tx, student: string, periodId: string) {
    const p = (await this.period(tx, periodId))!
    const { settings } = await this.settings(tx, p)
    return computeSuggestion(settings, await this.facts(tx, student, settings), p.criteria)
  }

  /** The student's own declaration. */
  async forStudent(user: string, declarationId: string) {
    return this.db.begin('isolation level repeatable read, read only', async (tx) => {
      const [d] = await tx<{ periodId: string }[]>`
        SELECT period_id AS "periodId" FROM training_declarations WHERE id=${declarationId} AND student_user_id=${user}`
      if (!d) throw fail(404, 'TRAINING_NOT_FOUND', 'Không tìm thấy bản kê khai của bạn.')
      return this.compute(tx, user, d.periodId)
    })
  }

  /** Reviewers (advisor, faculty, class monitor) who may see the submitted declaration. */
  async forReview(user: string, declarationId: string) {
    return this.db.begin('isolation level repeatable read, read only', async (tx) => {
      const [d] = await tx<{ periodId: string; studentUserId: string }[]>`
        SELECT d.period_id AS "periodId",d.student_user_id AS "studentUserId" FROM training_declarations d JOIN training_periods p ON p.id=d.period_id
        WHERE d.id=${declarationId} AND d.state='SUBMITTED' AND d.student_user_id<>${user}
          AND (training_review_allowed(${user}::uuid,p.class_id,'ADVISOR') OR training_review_allowed(${user}::uuid,p.class_id,'FACULTY') OR training_review_allowed(${user}::uuid,p.class_id,'MONITOR'))`
      if (!d)
        throw fail(
          404,
          'TRAINING_REVIEW_NOT_FOUND',
          'Không tìm thấy bản đã nộp trong phạm vi của bạn.',
        )
      return this.compute(tx, d.studentUserId, d.periodId)
    })
  }

  private async manager(tx: Tx, user: string, periodId: string) {
    const p = await this.period(tx, periodId)
    if (!p) throw fail(404, 'TRAINING_NOT_FOUND', 'Không tìm thấy đợt.')
    const [ok] = await tx<
      { ok: boolean }[]
    >`SELECT training_can_manage(${user}::uuid,${p.classId}::uuid) AS ok`
    if (!ok?.ok)
      throw fail(
        403,
        'TRAINING_MANAGE_FORBIDDEN',
        'Bạn chưa có quyền quản lý đợt trong phạm vi này.',
      )
    return p
  }
  async getSettings(user: string, periodId: string) {
    return this.db.begin('isolation level repeatable read, read only', async (tx) => {
      const p = await this.manager(tx, user, periodId)
      return { ...(await this.settings(tx, p)), criteria: p.criteria }
    })
  }
  async saveSettings(
    user: string,
    periodId: string,
    expectedRevision: number,
    input: unknown,
    requestId: string | null,
  ) {
    return this.db.begin(async (tx) => {
      const p = await this.manager(tx, user, periodId)
      await tx`SELECT id FROM training_periods WHERE id=${periodId} FOR UPDATE`
      const current = await this.settings(tx, p)
      if (current.revision !== expectedRevision)
        throw fail(409, 'TRAINING_CONFLICT', 'Thiết lập đã thay đổi. Hãy tải lại.')
      const next = validateSettings(input, p.criteria)
      if (current.isDefault)
        await tx`INSERT INTO training_activity_settings(period_id,config,updated_by_user_id) VALUES(${periodId},${tx.json(next as never)},${user})`
      else
        await tx`UPDATE training_activity_settings SET config=${tx.json(next as never)},revision=revision+1,updated_by_user_id=${user},updated_at=clock_timestamp() WHERE period_id=${periodId}`
      await tx`INSERT INTO audit_logs(actor_type,actor_user_id,actor_username,action,resource_type,resource_id,outcome,request_id,metadata)
        SELECT 'USER',id,username,'training.activity_settings.updated','training_period',${periodId},'SUCCESS',${requestId},
          ${tx.json({ before: current.settings, after: next } as never)} FROM users WHERE id=${user}`
      return { ...(await this.settings(tx, p)), criteria: p.criteria }
    })
  }

  // Organising committee (ADR 0033).
  private async organizerAccess(tx: Tx, user: string, activityId: string) {
    const access = await this.activities.access(tx, user)
    const a = await this.activities.row(tx, activityId)
    if (!a || !this.activities.visible(access, a))
      throw fail(404, 'ACTIVITY_NOT_FOUND', 'Không tìm thấy hoạt động trong phạm vi của bạn.')
    const canEdit =
      (this.activities.owns(access, a) ||
        (!!a.delegatedClub && access.leaderClubs.includes(a.delegatedClub.id))) &&
      a.status !== 'DRAFT' &&
      a.status !== 'CANCELLED' &&
      Date.now() <= a.endsMs + organizerEditDays * 86400000
    return { canEdit }
  }
  private list(tx: Tx, activityId: string) {
    return tx<Organizer[]>`
      SELECT o.id,o.student_user_id AS "studentUserId",sp.student_code AS "studentCode",u.full_name AS "fullName",au.username AS "addedBy",${tx.unsafe(iso('o.added_at'))} AS "addedAt"
      FROM activity_organizers o JOIN users u ON u.id=o.student_user_id JOIN users au ON au.id=o.added_by_user_id
      LEFT JOIN student_profiles sp ON sp.user_id=o.student_user_id
      WHERE o.activity_id=${activityId} AND o.removed_at IS NULL ORDER BY o.added_at,o.id LIMIT 500`
  }
  async organizers(user: string, activityId: string) {
    return this.db.begin('isolation level repeatable read, read only', async (tx) => {
      const { canEdit } = await this.organizerAccess(tx, user, activityId)
      return { canEdit, items: await this.list(tx, activityId) }
    })
  }
  async addOrganizer(actor: SubmissionActor, activityId: string, studentCode: string) {
    return this.db.begin(async (tx) => {
      await this.activities.lockRights(tx)
      const { canEdit } = await this.organizerAccess(tx, actor.userId, activityId)
      if (!canEdit)
        throw fail(403, 'ACTIVITY_FORBIDDEN', 'Bạn không sửa được ban tổ chức của hoạt động này.')
      const [s] = await tx<{ id: string }[]>`
        SELECT u.id FROM student_profiles sp JOIN users u ON u.id=sp.user_id AND u.status='ACTIVE'
        JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id AND r.code='STUDENT' WHERE sp.student_code=${studentCode}`
      if (!s)
        throw fail(
          400,
          'INVALID_ACTIVITY_ORGANIZER',
          'Không tìm thấy sinh viên đang hoạt động với mã này.',
        )
      if (s.id === actor.userId)
        throw fail(403, 'ACTIVITY_SELF_DECISION', 'Không được tự thêm mình vào ban tổ chức.')
      const [exists] =
        await tx`SELECT 1 FROM activity_organizers WHERE activity_id=${activityId} AND student_user_id=${s.id} AND removed_at IS NULL`
      if (exists) throw fail(409, 'ACTIVITY_ORGANIZER_EXISTS', 'Sinh viên đã có trong ban tổ chức.')
      const [row] = await tx<{ id: string }[]>`
        INSERT INTO activity_organizers(activity_id,student_user_id,added_by_user_id) VALUES(${activityId},${s.id},${actor.userId}) RETURNING id`
      await this.auditOrganizer(tx, actor, 'activity.organizer.added', row!.id, activityId, s.id)
      return { canEdit, items: await this.list(tx, activityId) }
    })
  }
  async removeOrganizer(actor: SubmissionActor, activityId: string, organizerId: string) {
    return this.db.begin(async (tx) => {
      await this.activities.lockRights(tx)
      const { canEdit } = await this.organizerAccess(tx, actor.userId, activityId)
      if (!canEdit)
        throw fail(403, 'ACTIVITY_FORBIDDEN', 'Bạn không sửa được ban tổ chức của hoạt động này.')
      const [row] = await tx<{ studentUserId: string }[]>`
        UPDATE activity_organizers SET removed_at=clock_timestamp(),removed_by_user_id=${actor.userId}
        WHERE id=${organizerId} AND activity_id=${activityId} AND removed_at IS NULL RETURNING student_user_id AS "studentUserId"`
      if (!row)
        throw fail(409, 'ACTIVITY_ATTENDANCE_CONFLICT', 'Ban tổ chức đã thay đổi. Hãy tải lại.')
      await this.auditOrganizer(
        tx,
        actor,
        'activity.organizer.removed',
        organizerId,
        activityId,
        row.studentUserId,
      )
      return { canEdit, items: await this.list(tx, activityId) }
    })
  }
  private async auditOrganizer(
    tx: Tx,
    actor: SubmissionActor,
    action: string,
    id: string,
    activityId: string,
    studentUserId: string,
  ) {
    await tx`INSERT INTO audit_logs(actor_type,actor_user_id,actor_username,action,resource_type,resource_id,outcome,request_id,ip_address,user_agent,metadata)
      SELECT 'USER',id,username,${action},'activity_organizer',${id},'SUCCESS',${actor.requestId},${actor.ipAddress},${actor.userAgent},${tx.json({ activityId, studentUserId })}
      FROM users WHERE id=${actor.userId}`
  }
}
