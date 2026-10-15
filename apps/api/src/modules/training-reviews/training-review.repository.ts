import { randomUUID } from 'node:crypto'
import type { Sql, TransactionSql } from 'postgres'
import { databaseClient } from '../../db/client.js'
import { SubmissionError } from '../submissions/submission.types.js'
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
}
export class TrainingReviewRepository {
  constructor(private readonly db: Sql = databaseClient) {}
  private async locks(tx: Tx) {
    await tx`LOCK TABLE users,roles,user_roles,role_permissions,permissions,user_role_scopes,authorization_scopes,student_profiles,academic_classes,faculties,academic_advisor_assignments IN SHARE MODE`
  }
  private async staff(tx: Tx, user: string) {
    const [r] = await tx<
      { ok: boolean }[]
    >`SELECT EXISTS(SELECT 1 FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id JOIN role_permissions rp ON rp.role_id=r.id JOIN permissions p ON p.id=rp.permission_id WHERE u.id=${user} AND u.status='ACTIVE' AND NOT u.must_change_password AND ((r.code='ACADEMIC_ADVISOR' AND p.code='training_point.review') OR (r.code='FACULTY_REVIEWER' AND p.code='training_point.faculty_approve'))) AS ok`
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
    >`SELECT d.*,to_char(d.submitted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS submitted_at,training_declaration_hash(d.id) AS hash,training_review_allowed(${user}::uuid,p.class_id,'ADVISOR') AS advisor,training_review_allowed(${user}::uuid,p.class_id,'FACULTY') AS faculty FROM training_declarations d JOIN training_periods p ON p.id=d.period_id WHERE d.id=${id} AND d.state='SUBMITTED' AND ((${owner}::boolean AND (d.student_user_id=${user} AND EXISTS(SELECT 1 FROM users u JOIN student_profiles sp ON sp.user_id=u.id JOIN academic_classes c ON c.id=sp.class_id AND c.status='ACTIVE' JOIN faculties f ON f.id=c.faculty_id AND f.status='ACTIVE' WHERE u.id=${user} AND u.status='ACTIVE' AND NOT u.must_change_password AND EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id AND r.code='STUDENT')))) OR (NOT ${owner}::boolean AND (training_review_allowed(${user}::uuid,p.class_id,'ADVISOR') OR training_review_allowed(${user}::uuid,p.class_id,'FACULTY'))))`
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
      state = reviewState(last?.action)
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
    }
  }
  async detail(user: string, id: string, owner = false) {
    return this.db.begin((tx) => this.load(tx, user, id, owner))
  }
  async periods(user: string) {
    return this.db.begin(async (tx) => {
      await this.staff(tx, user)
      const items = await tx<
        ReviewPeriod[]
      >`SELECT p.id,p.name,p.academic_year AS "academicYear",p.semester,p.status,c.code AS "classCode",c.name AS "className",f.name AS "facultyName" FROM training_periods p JOIN academic_classes c ON c.id=p.class_id JOIN faculties f ON f.id=c.faculty_id WHERE p.status<>'DRAFT' AND (training_review_allowed(${user}::uuid,p.class_id,'ADVISOR') OR training_review_allowed(${user}::uuid,p.class_id,'FACULTY')) ORDER BY p.created_at DESC,p.id LIMIT 201`
      return { items: items.slice(0, 200), truncated: items.length > 200 }
    })
  }
  async queue(user: string, periodId: string, cursor?: string, state?: ReviewState) {
    return this.db.begin(async (tx) => {
      await this.staff(tx, user)
      const [period] = await tx<
        ReviewQueuePeriod[]
      >`SELECT p.id,p.name,c.code AS "classCode",p.academic_year AS "academicYear",p.semester,p.status FROM training_periods p JOIN academic_classes c ON c.id=p.class_id WHERE p.id=${periodId} AND p.status<>'DRAFT' AND (training_review_allowed(${user}::uuid,p.class_id,'ADVISOR') OR training_review_allowed(${user}::uuid,p.class_id,'FACULTY'))`
      if (!period) throw missing()
      const rows = await tx<
        ReviewQueueRow[]
      >`SELECT d.id,d.student_snapshot AS student,d.total_points AS "selfPoints",r.total_points AS "reviewPoints",COALESCE(r.revision,0) AS revision,CASE r.action WHEN 'ADVISOR_SIGNED' THEN 'WAITING_FACULTY' WHEN 'FACULTY_RETURNED' THEN 'RETURNED_TO_ADVISOR' WHEN 'FACULTY_APPROVED' THEN 'APPROVED' ELSE 'WAITING_ADVISOR' END AS state FROM training_declarations d JOIN training_periods p ON p.id=d.period_id LEFT JOIN LATERAL(SELECT action,total_points,revision FROM training_review_decisions WHERE declaration_id=d.id ORDER BY revision DESC LIMIT 1) r ON true WHERE d.period_id=${periodId} AND d.state='SUBMITTED' AND (training_review_allowed(${user}::uuid,p.class_id,'ADVISOR') OR training_review_allowed(${user}::uuid,p.class_id,'FACULTY')) AND (${cursor ?? null}::uuid IS NULL OR d.id>${cursor ?? null}::uuid) AND (${state ?? null}::text IS NULL OR CASE r.action WHEN 'ADVISOR_SIGNED' THEN 'WAITING_FACULTY' WHEN 'FACULTY_RETURNED' THEN 'RETURNED_TO_ADVISOR' WHEN 'FACULTY_APPROVED' THEN 'APPROVED' ELSE 'WAITING_ADVISOR' END=${state ?? null}) ORDER BY d.id LIMIT 26`
      const [summary] = await tx<
        ReviewSummary[]
      >`SELECT count(*)::integer AS submitted,count(*) FILTER(WHERE r.action IS NULL)::integer AS "waitingAdvisor",count(*) FILTER(WHERE r.action='ADVISOR_SIGNED')::integer AS "waitingFaculty",count(*) FILTER(WHERE r.action='FACULTY_RETURNED')::integer AS "returnedToAdvisor",count(*) FILTER(WHERE r.action='FACULTY_APPROVED')::integer AS approved,COALESCE(sum(r.total_points) FILTER(WHERE r.action='FACULTY_APPROVED'),0)::integer AS "approvedTotalPoints",round(avg(r.total_points) FILTER(WHERE r.action='FACULTY_APPROVED'),2)::float AS "approvedAveragePoints" FROM training_declarations d JOIN training_periods p ON p.id=d.period_id LEFT JOIN LATERAL(SELECT action,total_points FROM training_review_decisions WHERE declaration_id=d.id ORDER BY revision DESC LIMIT 1) r ON true WHERE d.period_id=${periodId} AND d.state='SUBMITTED' AND (training_review_allowed(${user}::uuid,p.class_id,'ADVISOR') OR training_review_allowed(${user}::uuid,p.class_id,'FACULTY'))`
      if (!summary) throw missing()
      return {
        period,
        summary,
        items: rows.slice(0, 25),
        nextCursor: rows.length > 25 ? rows[24]!.id : null,
      }
    })
  }
  async file(user: string, id: string, fileId: string) {
    return this.db.begin(async (tx) => {
      const detail = await this.load(tx, user, id)
      if (!detail.files.some((f) => f.id === fileId)) throw missing()
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
      >`SELECT training_review_allowed(${user}::uuid,class_id,${action === 'ADVISOR_SIGNED' ? 'ADVISOR' : 'FACULTY'}) AS ok FROM training_periods WHERE id=${d.periodId}`
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
      if (
        input.expectedRevision !== d.revision ||
        (action === 'ADVISOR_SIGNED' ? !d.canAdvisorSign : !d.canFacultyDecide)
      )
        throw conflict()
      const answers = action === 'ADVISOR_SIGNED' ? input.answers : d.decisions.at(-1)?.answers
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
        parent = action === 'ADVISOR_SIGNED' ? null : d.decisions.at(-1)!.id
      const [who] = await tx<
        { actor: ReviewDecision['actor']; time: string }[]
      >`SELECT jsonb_build_object('userId',id,'username',username,'fullName',full_name,'roleCode',${action === 'ADVISOR_SIGNED' ? 'ACADEMIC_ADVISOR' : 'FACULTY_REVIEWER'}::text) AS actor,to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS time FROM users WHERE id=${user}`
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
