import {
  trainingExportAuditActions,
  trainingExportMaxRows,
  type TrainingExportAuditReceipt,
  type TrainingExportSnapshot,
  type TrainingExportRow,
} from './training-export.types.js'
import { randomUUID } from 'node:crypto'
import { provisionalClassification } from './training-classification.js'
import type { Sql, TransactionSql } from 'postgres'
import { databaseClient } from '../../db/client.js'
import { SubmissionError, type SubmissionActor } from '../submissions/submission.types.js'
import { validateAnswers } from '../training-points/training-points.validation.js'
import type { Answers } from '../training-points/training-points.types.js'
import {
  reviewState,
  type ReviewInput,
  type ReviewAction,
  type ReviewDetail,
  type ReviewDecision,
  type ReviewState,
  type ReviewPeriod,
  type ReviewQueueRow,
  type ReviewSummary,
  type ReviewQueuePeriod,
} from './training-review.types.js'
type Tx = TransactionSql
const fail = (n: number, code: string, msg: string) => new SubmissionError(n, code, msg)
const missing = () =>
  fail(404, 'TRAINING_REVIEW_NOT_FOUND', 'Không tìm thấy bản đã nộp trong phạm vi của bạn.')
const conflict = () =>
  fail(
    409,
    'TRAINING_REVIEW_CONFLICT',
    'Kết quả đã thay đổi hoặc yêu cầu không còn phù hợp. Hãy tải lại.',
  )
interface DecisionRow {
  id: string
  declaration_id: string
  revision: number
  action: ReviewAction
  actor_user_id: string
  actor_snapshot: ReviewDecision['actor']
  assessed_answers: Answers
  total_points: number
  comment: string
  declaration_sha256: string
  parent_decision_id: string | null
  request_id: string
  input_revision: number
  payload_sha256: string
  created_at: string
}
const decisionView = (d: DecisionRow): ReviewDecision => ({
  id: d.id,
  revision: d.revision,
  action: d.action,
  actor: d.actor_snapshot,
  answers: d.assessed_answers,
  totalPoints: d.total_points,
  comment: d.comment,
  declarationSha256: d.declaration_sha256,
  parentDecisionId: d.parent_decision_id,
  requestId: d.request_id,
  inputRevision: d.input_revision,
  payloadSha256: d.payload_sha256,
  confirmedAt: d.created_at,
  technicalSignatureStatus: 'NOT_VERIFIED',
  legalEffect: false,
})
interface DeclarationRow {
  period_id: string
  student_user_id: string
  period_snapshot: ReviewDetail['period']
  student_snapshot: ReviewDetail['student']
  answers: Answers
  total_points: number
  submitted_at: string
  evidence_snapshot: ReviewDetail['files']
  hash: string
  advisor: boolean
  faculty: boolean
  monitor: boolean
  student_monitor: boolean
}
const stageOf = (action: ReviewAction) =>
  action === 'MONITOR_CONFIRMED'
    ? 'MONITOR'
    : action === 'ADVISOR_SIGNED' || action === 'MONITOR_BYPASSED'
      ? 'ADVISOR'
      : 'FACULTY'
const roleOf = (action: ReviewAction) =>
  ({ MONITOR: 'CLASS_MONITOR', ADVISOR: 'ACADEMIC_ADVISOR', FACULTY: 'FACULTY_REVIEWER' })[
    stageOf(action)
  ]
/** ADR 0028: the only export formats a class monitor may produce. */
const monitorExportFormats = new Set<TrainingExportAuditReceipt['format']>(['CLASS_SHEET', 'FORM'])
export interface RosterStudent {
  userId: string
  studentCode: string
  fullName: string
  email: string | null
  cohortYear: number | null
  dateOfBirth: string | null
  declarationState: 'NONE' | 'DRAFT' | 'SUBMITTED'
  declarationId: string | null
  isMonitor: boolean
}
export class TrainingReviewRepository {
  constructor(private readonly db: Sql = databaseClient) {}
  private async locks(tx: Tx) {
    await tx`LOCK TABLE users,roles,user_roles,role_permissions,permissions,user_role_scopes,authorization_scopes,student_profiles,academic_classes,faculties,academic_advisor_assignments,class_monitor_assignments IN SHARE MODE`
  }
  private async staff(tx: Tx, user: string) {
    const [r] = await tx<
      { ok: boolean }[]
    >`SELECT EXISTS(SELECT 1 FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id JOIN role_permissions rp ON rp.role_id=r.id JOIN permissions p ON p.id=rp.permission_id WHERE u.id=${user} AND u.status='ACTIVE' AND NOT u.must_change_password AND ((r.code='ACADEMIC_ADVISOR' AND p.code='training_point.review') OR (r.code='FACULTY_REVIEWER' AND p.code='training_point.faculty_approve') OR (r.code='CLASS_MONITOR' AND p.code='training_point.monitor_confirm'))) AS ok`
    if (!r?.ok)
      throw fail(
        403,
        'TRAINING_REVIEW_FORBIDDEN',
        'Bạn chưa có vai trò và quyền xét duyệt hiện tại.',
      )
  }
  private async load(
    tx: Tx,
    user: string,
    id: string,
    owner = false,
    lock = false,
  ): Promise<ReviewDetail> {
    if (!owner) await this.staff(tx, user)
    const [row] = await tx<
      DeclarationRow[]
    >`SELECT d.*,to_char(d.submitted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS submitted_at,training_declaration_hash(d.id) AS hash,training_review_allowed(${user}::uuid,p.class_id,'ADVISOR') AS advisor,training_review_allowed(${user}::uuid,p.class_id,'FACULTY') AS faculty,training_review_allowed(${user}::uuid,p.class_id,'MONITOR') AS monitor,training_is_class_monitor(d.student_user_id,p.class_id) AS student_monitor FROM training_declarations d JOIN training_periods p ON p.id=d.period_id WHERE d.id=${id} AND d.state='SUBMITTED' AND ((${owner}::boolean AND (d.student_user_id=${user} AND EXISTS(SELECT 1 FROM users u JOIN student_profiles sp ON sp.user_id=u.id JOIN academic_classes c ON c.id=sp.class_id AND c.status='ACTIVE' JOIN faculties f ON f.id=c.faculty_id AND f.status='ACTIVE' WHERE u.id=${user} AND u.status='ACTIVE' AND NOT u.must_change_password AND EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id AND r.code='STUDENT')))) OR (NOT ${owner}::boolean AND (training_review_allowed(${user}::uuid,p.class_id,'ADVISOR') OR training_review_allowed(${user}::uuid,p.class_id,'FACULTY') OR training_review_allowed(${user}::uuid,p.class_id,'MONITOR'))))`
    if (!row) throw missing()
    if (lock) {
      await tx`SELECT id FROM training_periods WHERE id=${row.period_id} FOR UPDATE`
      await tx`SELECT id FROM training_declarations WHERE id=${id} FOR UPDATE`
    }
    const events = await tx<
      { data: DecisionRow }[]
    >`SELECT to_jsonb(r) AS data FROM training_review_decisions r WHERE declaration_id=${id} ORDER BY revision DESC LIMIT 101`
    const decisions = events
        .slice(0, 100)
        .reverse()
        .map((e) => decisionView(e.data)),
      last = decisions.at(-1),
      state = reviewState(last?.action, row.student_monitor)
    return {
      id,
      periodId: row.period_id,
      period: row.period_snapshot,
      student: row.student_snapshot,
      answers: row.answers,
      totalPoints: row.total_points,
      submittedAt: row.submitted_at,
      files: row.evidence_snapshot,
      declarationSha256: row.hash,
      state,
      revision: last?.revision ?? 0,
      decisions,
      historyTruncated: events.length > 100,
      canAdvisorSign:
        !owner &&
        row.student_user_id !== user &&
        row.advisor &&
        (state === 'WAITING_ADVISOR' || state === 'RETURNED_TO_ADVISOR'),
      canFacultyDecide:
        !owner &&
        row.student_user_id !== user &&
        row.faculty &&
        state === 'WAITING_FACULTY' &&
        last?.actor.userId !== user,
      canMonitorConfirm:
        !owner && row.student_user_id !== user && row.monitor && state === 'WAITING_MONITOR',
      canAdvisorBypass:
        !owner && row.student_user_id !== user && row.advisor && state === 'WAITING_MONITOR',
    }
  }
  async detail(user: string, id: string, owner = false) {
    return this.db.begin(async (tx) => {
      const detail = await this.load(tx, user, id, owner)
      if (!owner)
        await this.auditMonitorView(
          tx,
          user,
          detail.periodId,
          'training.monitor.declaration_viewed',
          {
            declarationId: id,
          },
        )
      return detail
    })
  }
  /**
   * ADR 0028: every read by someone acting only as class monitor is audited with the class id so
   * the class advisor can review it. Advisors and faculty are not audited for reads here.
   */
  private async auditMonitorView(
    tx: Tx,
    user: string,
    periodId: string,
    action: string,
    metadata: Record<string, string>,
  ) {
    await tx`INSERT INTO audit_logs(actor_type,actor_user_id,actor_username,action,resource_type,resource_id,outcome,metadata)
      SELECT 'USER',u.id,u.username,${action},'training_period',p.id::text,'SUCCESS',
        ${JSON.stringify(metadata)}::text::jsonb || jsonb_build_object('classId',p.class_id::text)
      FROM training_periods p JOIN users u ON u.id=${user}
      WHERE p.id=${periodId} AND training_review_allowed(${user}::uuid,p.class_id,'MONITOR')
        AND NOT training_review_allowed(${user}::uuid,p.class_id,'ADVISOR')
        AND NOT training_review_allowed(${user}::uuid,p.class_id,'FACULTY')`
  }
  /** Class roster for the advisor, faculty or class monitor of the period's class (ADR 0028). */
  async roster(user: string, periodId: string) {
    return this.db.begin(async (tx) => {
      await this.staff(tx, user)
      const [period] = await tx<
        {
          id: string
          classId: string
          classCode: string
          name: string
          canAppoint: boolean
          faculty: boolean
        }[]
      >`SELECT p.id,p.class_id AS "classId",c.code AS "classCode",p.name,training_review_allowed(${user}::uuid,p.class_id,'ADVISOR') AS "canAppoint",training_review_allowed(${user}::uuid,p.class_id,'FACULTY') AS faculty
        FROM training_periods p JOIN academic_classes c ON c.id=p.class_id
        WHERE p.id=${periodId} AND p.status<>'DRAFT' AND (training_review_allowed(${user}::uuid,p.class_id,'ADVISOR') OR training_review_allowed(${user}::uuid,p.class_id,'FACULTY') OR training_review_allowed(${user}::uuid,p.class_id,'MONITOR'))`
      if (!period) throw missing()
      const students = await tx<RosterStudent[]>`
        SELECT u.id AS "userId",sp.student_code AS "studentCode",u.full_name AS "fullName",u.email,
          sp.cohort_year::integer AS "cohortYear",sp.date_of_birth::text AS "dateOfBirth",
          COALESCE(d.state,'NONE') AS "declarationState",d.id AS "declarationId",
          training_is_class_monitor(u.id,${period.classId}::uuid) AS "isMonitor"
        FROM student_profiles sp JOIN users u ON u.id=sp.user_id
        LEFT JOIN training_declarations d ON d.period_id=${periodId} AND d.student_user_id=u.id
        WHERE sp.class_id=${period.classId} ORDER BY sp.student_code COLLATE "C",u.id LIMIT 1001`
      const [monitor] = await tx<
        { userId: string; fullName: string; validFrom: string; validTo: string | null }[]
      >`SELECT m.monitor_user_id AS "userId",u.full_name AS "fullName",
          to_char(m.valid_from AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "validFrom",
          to_char(m.valid_to AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "validTo"
        FROM class_monitor_assignments m JOIN users u ON u.id=m.monitor_user_id
        WHERE m.class_id=${period.classId} AND m.status='ACTIVE' AND m.valid_from<=clock_timestamp() AND (m.valid_to IS NULL OR m.valid_to>clock_timestamp())
        ORDER BY m.valid_from DESC LIMIT 1`
      await this.auditMonitorView(tx, user, periodId, 'training.monitor.roster_viewed', {})
      return {
        period: { id: period.id, classCode: period.classCode, name: period.name },
        canAppointMonitor: period.canAppoint,
        // ADR 0028: lets the UI offer only the exports this viewer may produce.
        viewerRole: period.canAppoint ? 'ADVISOR' : period.faculty ? 'FACULTY' : 'MONITOR',
        monitor: monitor ?? null,
        students: students.slice(0, 1000),
        truncated: students.length > 1000,
      }
    })
  }
  /**
   * ADR 0028: the class advisor appoints or replaces the class monitor. The previous active term
   * ends now; the new monitor must be an active student of the period's class.
   */
  async appointMonitor(actor: SubmissionActor, periodId: string, studentUserId: string | null) {
    return this.db.begin(async (tx) => {
      await this.locks(tx)
      const [period] = await tx<
        { classId: string }[]
      >`SELECT class_id AS "classId" FROM training_periods WHERE id=${periodId} AND status<>'DRAFT' AND training_review_allowed(${actor.userId}::uuid,class_id,'ADVISOR')`
      if (!period)
        throw fail(403, 'TRAINING_REVIEW_FORBIDDEN', 'Chỉ cố vấn của lớp được bổ nhiệm lớp trưởng.')
      if (studentUserId !== null) {
        const [student] = await tx<
          { ok: boolean }[]
        >`SELECT EXISTS(SELECT 1 FROM users u JOIN student_profiles sp ON sp.user_id=u.id JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id AND r.code='STUDENT' WHERE u.id=${studentUserId} AND u.status='ACTIVE' AND sp.class_id=${period.classId}) AS ok`
        if (!student?.ok)
          throw fail(
            400,
            'INVALID_CLASS_MONITOR',
            'Lớp trưởng phải là sinh viên đang hoạt động của lớp.',
          )
      }
      const ended = await tx<
        { id: string }[]
      >`UPDATE class_monitor_assignments SET status='INACTIVE',valid_to=GREATEST(valid_from+interval '1 millisecond',clock_timestamp()),updated_at=clock_timestamp()
        WHERE class_id=${period.classId} AND status='ACTIVE' AND (valid_to IS NULL OR valid_to>clock_timestamp()) RETURNING id`
      if (studentUserId !== null) {
        await tx`INSERT INTO class_monitor_assignments(monitor_user_id,class_id,valid_from,assigned_by_user_id) VALUES(${studentUserId},${period.classId},clock_timestamp(),${actor.userId})`
        await tx`INSERT INTO user_roles(user_id,role_id) SELECT ${studentUserId},id FROM roles WHERE code='CLASS_MONITOR' ON CONFLICT DO NOTHING`
      }
      await tx`INSERT INTO audit_logs(actor_type,actor_user_id,actor_username,action,resource_type,resource_id,outcome,request_id,ip_address,user_agent,metadata)
        SELECT 'USER',id,username,${studentUserId ? 'training.monitor.appointed' : 'training.monitor.ended'},'academic_class',${period.classId},'SUCCESS',${actor.requestId},${actor.ipAddress},${actor.userAgent},
          jsonb_build_object('classId',${period.classId}::text,'monitorUserId',${studentUserId}::text,'endedAssignments',${ended.length}::integer)
        FROM users WHERE id=${actor.userId}`
    })
  }
  /** ADR 0028: the class advisor reviews what the class monitor did on the class. */
  async monitorAudit(user: string, periodId: string) {
    return this.db.begin(async (tx) => {
      const [period] = await tx<
        { classId: string }[]
      >`SELECT class_id AS "classId" FROM training_periods WHERE id=${periodId} AND training_review_allowed(${user}::uuid,class_id,'ADVISOR')`
      if (!period)
        throw fail(
          403,
          'TRAINING_REVIEW_FORBIDDEN',
          'Chỉ cố vấn của lớp xem được nhật ký lớp trưởng.',
        )
      const items = await tx<
        {
          id: string
          occurredAt: string
          actor: string
          action: string
          metadata: Record<string, unknown>
        }[]
      >`SELECT a.id,to_char(a.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "occurredAt",a.actor_username AS actor,a.action,a.metadata
        FROM audit_logs a
        WHERE (a.action LIKE 'training.monitor.%' AND a.metadata->>'classId'=${period.classId}::text)
          OR (a.action IN ('training.review.monitor_confirmed','training.review.monitor_bypassed') AND (a.metadata->>'declarationId') IN (SELECT d.id::text FROM training_declarations d JOIN training_periods p ON p.id=d.period_id WHERE p.class_id=${period.classId}))
          OR (a.action LIKE 'training.export.%' AND a.resource_id IN (SELECT p.id::text FROM training_periods p WHERE p.class_id=${period.classId}) AND a.actor_user_id IN (SELECT m.monitor_user_id FROM class_monitor_assignments m WHERE m.class_id=${period.classId}))
        ORDER BY a.occurred_at DESC,a.id LIMIT 200`
      return { items }
    })
  }
  async periods(user: string) {
    return this.db.begin(async (tx) => {
      await this.staff(tx, user)
      const items = await tx<
        ReviewPeriod[]
      >`SELECT p.id,p.name,p.academic_year AS "academicYear",p.semester,p.status,c.code AS "classCode",c.name AS "className",f.name AS "facultyName" FROM training_periods p JOIN academic_classes c ON c.id=p.class_id JOIN faculties f ON f.id=c.faculty_id WHERE p.status<>'DRAFT' AND (training_review_allowed(${user}::uuid,p.class_id,'ADVISOR') OR training_review_allowed(${user}::uuid,p.class_id,'FACULTY') OR training_review_allowed(${user}::uuid,p.class_id,'MONITOR')) ORDER BY p.created_at DESC,p.id LIMIT 201`
      return { items: items.slice(0, 200), truncated: items.length > 200 }
    })
  }
  async queue(user: string, periodId: string, cursor?: string, state?: ReviewState) {
    return this.db.begin('isolation level repeatable read, read only', async (tx) => {
      await this.staff(tx, user)
      const [period] = await tx<
        ReviewQueuePeriod[]
      >`SELECT p.id,p.name,c.code AS "classCode",p.academic_year AS "academicYear",p.semester,p.status FROM training_periods p JOIN academic_classes c ON c.id=p.class_id WHERE p.id=${periodId} AND p.status<>'DRAFT' AND (training_review_allowed(${user}::uuid,p.class_id,'ADVISOR') OR training_review_allowed(${user}::uuid,p.class_id,'FACULTY'))`
      if (!period) throw missing()
      const rows = await tx<
        ReviewQueueRow[]
      >`SELECT d.id,d.student_snapshot AS student,d.total_points AS "selfPoints",r.total_points AS "reviewPoints",COALESCE(r.revision,0) AS revision,CASE WHEN r.action IS NULL AND NOT training_is_class_monitor(d.student_user_id,p.class_id) THEN 'WAITING_MONITOR' WHEN r.action IS NULL OR r.action IN ('MONITOR_CONFIRMED','MONITOR_BYPASSED') THEN 'WAITING_ADVISOR' WHEN r.action='ADVISOR_SIGNED' THEN 'WAITING_FACULTY' WHEN r.action='FACULTY_RETURNED' THEN 'RETURNED_TO_ADVISOR' WHEN r.action='FACULTY_APPROVED' THEN 'APPROVED' END AS state FROM training_declarations d JOIN training_periods p ON p.id=d.period_id LEFT JOIN LATERAL(SELECT action,total_points,revision FROM training_review_decisions WHERE declaration_id=d.id ORDER BY revision DESC LIMIT 1) r ON true WHERE d.period_id=${periodId} AND d.state='SUBMITTED' AND (training_review_allowed(${user}::uuid,p.class_id,'ADVISOR') OR training_review_allowed(${user}::uuid,p.class_id,'FACULTY') OR training_review_allowed(${user}::uuid,p.class_id,'MONITOR')) AND (${cursor ?? null}::uuid IS NULL OR d.id>${cursor ?? null}::uuid) AND (${state ?? null}::text IS NULL OR CASE WHEN r.action IS NULL AND NOT training_is_class_monitor(d.student_user_id,p.class_id) THEN 'WAITING_MONITOR' WHEN r.action IS NULL OR r.action IN ('MONITOR_CONFIRMED','MONITOR_BYPASSED') THEN 'WAITING_ADVISOR' WHEN r.action='ADVISOR_SIGNED' THEN 'WAITING_FACULTY' WHEN r.action='FACULTY_RETURNED' THEN 'RETURNED_TO_ADVISOR' WHEN r.action='FACULTY_APPROVED' THEN 'APPROVED' END=${state ?? null}) ORDER BY d.id LIMIT 26`
      const [summary] = await tx<
        ReviewSummary[]
      >`SELECT count(*)::integer AS submitted,count(*) FILTER(WHERE r.action IS NULL AND NOT training_is_class_monitor(d.student_user_id,p.class_id))::integer AS "waitingMonitor",count(*) FILTER(WHERE (r.action IS NULL AND training_is_class_monitor(d.student_user_id,p.class_id)) OR r.action IN ('MONITOR_CONFIRMED','MONITOR_BYPASSED'))::integer AS "waitingAdvisor",count(*) FILTER(WHERE r.action='ADVISOR_SIGNED')::integer AS "waitingFaculty",count(*) FILTER(WHERE r.action='FACULTY_RETURNED')::integer AS "returnedToAdvisor",count(*) FILTER(WHERE r.action='FACULTY_APPROVED')::integer AS approved,COALESCE(sum(r.total_points) FILTER(WHERE r.action='FACULTY_APPROVED'),0)::integer AS "approvedTotalPoints",round(avg(r.total_points) FILTER(WHERE r.action='FACULTY_APPROVED'),2)::float AS "approvedAveragePoints" FROM training_declarations d JOIN training_periods p ON p.id=d.period_id LEFT JOIN LATERAL(SELECT action,total_points FROM training_review_decisions WHERE declaration_id=d.id ORDER BY revision DESC LIMIT 1) r ON true WHERE d.period_id=${periodId} AND d.state='SUBMITTED' AND (training_review_allowed(${user}::uuid,p.class_id,'ADVISOR') OR training_review_allowed(${user}::uuid,p.class_id,'FACULTY') OR training_review_allowed(${user}::uuid,p.class_id,'MONITOR'))`
      if (!summary) throw missing()
      return {
        period,
        summary,
        items: rows.slice(0, 25),
        nextCursor: rows.length > 25 ? rows[24]!.id : null,
      }
    })
  }
  /** ADR 0028: only the class sheet and printed forms pass allowMonitor; other exports stay staff-only. */
  private async exportContext(tx: Tx, user: string, periodId: string, allowMonitor = false) {
    await this.staff(tx, user)
    const [context] = await tx<
      Pick<TrainingExportSnapshot, 'capturedAt' | 'exportedBy' | 'period'>[]
    >`
      SELECT to_char(transaction_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "capturedAt",
        jsonb_build_object('userId',u.id,'username',u.username,'fullName',u.full_name) AS "exportedBy",
        jsonb_build_object('id',p.id,'classId',p.class_id,'classCode',c.code,'className',c.name,
          'facultyCode',f.code,'facultyName',f.name,'name',p.name,'academicYear',p.academic_year,
          'semester',p.semester,'status',p.status,'policyLabel',p.policy_label,'criteria',p.criteria) AS period
      FROM training_periods p JOIN academic_classes c ON c.id=p.class_id
      JOIN faculties f ON f.id=c.faculty_id JOIN users u ON u.id=${user}
      WHERE p.id=${periodId} AND p.status<>'DRAFT'
        AND (training_review_allowed(${user}::uuid,p.class_id,'ADVISOR')
          OR training_review_allowed(${user}::uuid,p.class_id,'FACULTY')
          OR (${allowMonitor}::boolean AND training_review_allowed(${user}::uuid,p.class_id,'MONITOR')))`
    if (!context) throw missing()
    return context
  }
  async recordExport(
    actor: SubmissionActor,
    periodId: string,
    receipt: TrainingExportAuditReceipt,
  ): Promise<void> {
    const action = trainingExportAuditActions[receipt.format]
    await this.db.begin(async (tx) => {
      await this.locks(tx)
      const context = await this.exportContext(
        tx,
        actor.userId,
        periodId,
        monitorExportFormats.has(receipt.format),
      )
      // jsonb_strip_nulls keeps the XLSX metadata contract at exactly its five original keys.
      await tx`INSERT INTO audit_logs(actor_type,actor_user_id,actor_username,action,resource_type,resource_id,outcome,request_id,ip_address,user_agent,metadata)
        VALUES('USER',${actor.userId},${context.exportedBy.username},${action},'training_period',${periodId},'SUCCESS',${actor.requestId},${actor.ipAddress},${actor.userAgent},
          jsonb_strip_nulls(jsonb_build_object('snapshotId',${receipt.snapshotId}::text,'rowCount',${receipt.rowCount}::integer,'sha256',${receipt.sha256}::text,'size',${receipt.size}::integer,'format',${receipt.format}::text,
            'templateVersion',${receipt.templateVersion ?? null}::text,'sourceDocxSha256',${receipt.sourceDocxSha256 ?? null}::text,'manifestSha256',${receipt.manifestSha256 ?? null}::text,'declarationId',${receipt.declarationId ?? null}::text)))`
    })
  }

  async assertExportAccess(user: string, periodId: string, allowMonitor = false): Promise<void> {
    await this.db.begin(async (tx) => {
      await this.exportContext(tx, user, periodId, allowMonitor)
    })
  }
  async exportSnapshot(
    user: string,
    periodId: string,
    allowMonitor = false,
  ): Promise<TrainingExportSnapshot> {
    return this.db.begin('isolation level repeatable read, read only', async (tx) => {
      await tx`SET LOCAL statement_timeout='10s'`
      const context = await this.exportContext(tx, user, periodId, allowMonitor)
      const rows = await tx<TrainingExportRow[]>`
        SELECT d.id AS "declarationId",r.declaration_sha256 AS "declarationSha256",
          d.student_snapshot AS student,d.total_points AS "selfPoints",
          r.assessed_answers AS "approvedAnswers",r.total_points AS "approvedPoints",
          jsonb_build_object('id',a.id,'revision',a.revision,'actor',a.actor_snapshot,
            'confirmedAt',to_char(a.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'payloadSha256',a.payload_sha256) AS advisor,
          jsonb_build_object('id',r.id,'revision',r.revision,'actor',r.actor_snapshot,
            'confirmedAt',to_char(r.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'payloadSha256',r.payload_sha256) AS faculty,
          sp.date_of_birth::text AS "dateOfBirth",
          d.answers AS "selfAnswers",sp.cohort_year::integer AS "cohortYear",
          CASE WHEN mon.id IS NULL THEN NULL ELSE jsonb_build_object('id',mon.id,'revision',mon.revision,'actor',mon.actor_snapshot,
            'confirmedAt',to_char(mon.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'payloadSha256',mon.payload_sha256,'action',mon.action) END AS monitor
        FROM training_declarations d
        LEFT JOIN student_profiles sp ON sp.user_id=d.student_user_id
        JOIN LATERAL (SELECT * FROM training_review_decisions WHERE declaration_id=d.id ORDER BY revision DESC LIMIT 1) r ON r.action='FACULTY_APPROVED'
        JOIN training_review_decisions a ON a.id=r.parent_decision_id AND a.declaration_id=d.id AND a.action='ADVISOR_SIGNED'
        LEFT JOIN LATERAL (SELECT * FROM training_review_decisions m WHERE m.declaration_id=d.id AND m.action IN ('MONITOR_CONFIRMED','MONITOR_BYPASSED') AND m.revision<a.revision ORDER BY m.revision DESC LIMIT 1) mon ON true
        WHERE d.period_id=${periodId} AND d.state='SUBMITTED'
        ORDER BY (d.student_snapshot->>'studentCode') COLLATE "C",d.id
        LIMIT ${trainingExportMaxRows + 1}`
      if (rows.length > trainingExportMaxRows)
        throw fail(
          422,
          'TRAINING_EXPORT_TOO_LARGE',
          'Một lần xuất tối đa 1.000 bản đã duyệt. Hãy liên hệ người phụ trách.',
        )
      const [summary] = await tx<ReviewSummary[]>`
        SELECT count(*)::integer AS submitted,count(*) FILTER(WHERE r.action IS NULL AND NOT training_is_class_monitor(d.student_user_id,p.class_id))::integer AS "waitingMonitor",count(*) FILTER(WHERE (r.action IS NULL AND training_is_class_monitor(d.student_user_id,p.class_id)) OR r.action IN ('MONITOR_CONFIRMED','MONITOR_BYPASSED'))::integer AS "waitingAdvisor",
          count(*) FILTER(WHERE r.action='ADVISOR_SIGNED')::integer AS "waitingFaculty",
          count(*) FILTER(WHERE r.action='FACULTY_RETURNED')::integer AS "returnedToAdvisor",
          count(*) FILTER(WHERE r.action='FACULTY_APPROVED')::integer AS approved,
          COALESCE(sum(r.total_points) FILTER(WHERE r.action='FACULTY_APPROVED'),0)::integer AS "approvedTotalPoints",
          round(avg(r.total_points) FILTER(WHERE r.action='FACULTY_APPROVED'),2)::float AS "approvedAveragePoints"
        FROM training_declarations d JOIN training_periods p ON p.id=d.period_id
        LEFT JOIN LATERAL (SELECT action,total_points FROM training_review_decisions WHERE declaration_id=d.id ORDER BY revision DESC LIMIT 1) r ON true
        WHERE d.period_id=${periodId} AND d.state='SUBMITTED'`
      if (!summary || summary.approved !== rows.length)
        throw fail(
          409,
          'TRAINING_EXPORT_INTEGRITY',
          'Dữ liệu xét duyệt không nhất quán. Chưa thể xuất.',
        )
      return {
        schemaVersion: 1,
        snapshotId: randomUUID(),
        ...context,
        summary,
        rows: Array.from(rows),
        classification: provisionalClassification,
        technicalSignatureStatus: 'NOT_VERIFIED',
        legalEffect: false,
        notice: 'DỮ LIỆU THỬ NGHIỆM — CHƯA PHẢI BIỂU MẪU CHÍNH THỨC',
      }
    })
  }

  /** `audit` is false for the integrity re-read that precedes a decision (not a user download). */
  async file(user: string, id: string, fileId: string, audit = true) {
    return this.db.begin(async (tx) => {
      const detail = await this.load(tx, user, id)
      if (!detail.files.some((f) => f.id === fileId)) throw missing()
      if (audit)
        await this.auditMonitorView(
          tx,
          user,
          detail.periodId,
          'training.monitor.evidence_downloaded',
          {
            declarationId: id,
            fileId,
          },
        )
      const [f] = await tx<
        { storage_key: string; name: string; mime_type: string; sha256: string; size: number }[]
      >`SELECT * FROM training_evidence WHERE id=${fileId} AND declaration_id=${id} AND removed_at IS NULL`
      const frozen = detail.files.find((x) => x.id === fileId)
      if (!f || f.sha256 !== frozen?.sha256 || f.size !== frozen?.size) throw conflict()
      return {
        storageKey: f.storage_key,
        name: f.name,
        mimeType: f.mime_type,
        sha256: f.sha256,
        size: f.size,
      }
    })
  }
  async act(user: string, id: string, action: ReviewAction, input: ReviewInput) {
    return this.db.begin(async (tx) => {
      await this.locks(tx)
      const d = await this.load(tx, user, id, false, true)
      if (
        input.confirmed !== true ||
        !Number.isInteger(input.expectedRevision) ||
        input.expectedRevision < 0 ||
        input.expectedRevision >= 2147483647 ||
        typeof input.comment !== 'string' ||
        !input.comment.trim() ||
        input.comment.length > 2000 ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.requestId)
      )
        throw fail(400, 'INVALID_TRAINING_REVIEW', 'Kiểm tra xác nhận, nhận xét và lần cập nhật.')
      const [access] = await tx<
        { ok: boolean }[]
      >`SELECT training_review_allowed(${user}::uuid,class_id,${stageOf(action)}) AS ok FROM training_periods WHERE id=${d.periodId}`
      if (!access?.ok)
        throw fail(
          403,
          'TRAINING_REVIEW_FORBIDDEN',
          'Vai trò, phạm vi hoặc phân công hiện tại không cho phép thao tác.',
        )
      const comment = input.comment.trim(),
        requestId = input.requestId.toLowerCase()
      const [retry] = await tx<
        { data: DecisionRow }[]
      >`SELECT to_jsonb(r) AS data FROM training_review_decisions r WHERE request_id=${requestId}`
      if (retry) {
        const r = retry.data
        const [same] = await tx<
          { ok: boolean }[]
        >`SELECT ${r.declaration_id === id && r.actor_user_id === user && r.action === action && r.input_revision === input.expectedRevision && r.comment === comment}::boolean AND (${action !== 'ADVISOR_SIGNED'}::boolean OR ${JSON.stringify(r.assessed_answers)}::text::jsonb=${JSON.stringify(input.answers ?? {})}::text::jsonb) AS ok`
        if (!same?.ok) throw conflict()
        return this.load(tx, user, id)
      }
      const allowed =
        action === 'ADVISOR_SIGNED'
          ? d.canAdvisorSign
          : action === 'MONITOR_CONFIRMED'
            ? d.canMonitorConfirm
            : action === 'MONITOR_BYPASSED'
              ? d.canAdvisorBypass
              : d.canFacultyDecide
      if (input.expectedRevision !== d.revision || !allowed) throw conflict()
      // ADR 0028: the monitor step never changes scores; it carries the student's own answers.
      const answers =
        action === 'ADVISOR_SIGNED'
          ? input.answers
          : action === 'MONITOR_CONFIRMED' || action === 'MONITOR_BYPASSED'
            ? d.answers
            : d.decisions.at(-1)?.answers
      if (!answers) throw fail(400, 'INVALID_TRAINING_REVIEW', 'Cần nhập đủ điểm xét duyệt A–E.')
      validateAnswers(answers, d.period.criteria, true)
      const evidenceIssues = d.period.criteria
        .filter(
          (c) =>
            c.evidenceRequired &&
            (answers[c.code]?.points ?? 0) > 0 &&
            !d.files.some((f) => f.criterion === c.code),
        )
        .map((c) => ({
          path: c.code,
          message: 'Điểm xét duyệt dương cần minh chứng bắt buộc trong bản nộp gốc.',
        }))
      if (evidenceIssues.length)
        throw new SubmissionError(
          400,
          'INVALID_TRAINING_REVIEW',
          'Kiểm tra minh chứng của nhóm được đánh dấu.',
          evidenceIssues,
        )
      if (
        action === 'ADVISOR_SIGNED' &&
        Object.entries(answers).some(
          ([g, a]) => a.points !== d.answers[g]?.points && !a.note.trim(),
        )
      )
        throw fail(400, 'INVALID_TRAINING_REVIEW', 'Giải trình từng nhóm có điều chỉnh điểm.')
      const total = Object.values(answers).reduce((n, a) => n + (a.points ?? 0), 0),
        parent = action.startsWith('FACULTY_') ? d.decisions.at(-1)!.id : null
      const [who] = await tx<
        { actor: ReviewDecision['actor']; time: string }[]
      >`SELECT jsonb_build_object('userId',id,'username',username,'fullName',full_name,'roleCode',${roleOf(action)}::text) AS actor,to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS time FROM users WHERE id=${user}`
      const payload = {
          declarationId: id,
          revision: d.revision + 1,
          action,
          actor: who!.actor,
          assessedAnswers: answers,
          totalPoints: total,
          comment,
          declarationSha256: d.declarationSha256,
          parentDecisionId: parent,
          requestId,
          inputRevision: input.expectedRevision,
          confirmedAt: who!.time,
        },
        serialized = JSON.stringify(payload),
        decisionId = randomUUID()
      await tx`INSERT INTO training_review_decisions(id,declaration_id,revision,action,actor_user_id,actor_snapshot,assessed_answers,total_points,comment,declaration_sha256,parent_decision_id,request_id,input_revision,payload,payload_sha256,created_at) VALUES(${decisionId},${id},${d.revision + 1},${action},${user},${JSON.stringify(who!.actor)}::text::jsonb,${JSON.stringify(answers)}::text::jsonb,${total},${comment},${d.declarationSha256},${parent},${requestId},${input.expectedRevision},${serialized}::text::jsonb,encode(sha256(convert_to((${serialized}::text::jsonb)::text,'UTF8')),'hex'),${who!.time}::timestamptz)`
      await tx`INSERT INTO audit_logs(actor_type,actor_user_id,actor_username,action,resource_type,resource_id,outcome,metadata) SELECT 'USER',id,username,${'training.review.' + action.toLowerCase()},'training_review',${decisionId},'SUCCESS',jsonb_build_object('declarationId',${id}::text,'revision',${d.revision + 1}::integer) FROM users WHERE id=${user}`
      return this.load(tx, user, id)
    })
  }
}
