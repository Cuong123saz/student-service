import { randomUUID } from 'node:crypto'
import type { Sql, TransactionSql } from 'postgres'
import { databaseClient } from '../../db/client.js'
import { SubmissionError } from '../submissions/submission.types.js'
import { validatePeriod, validateAnswers } from './training-points.validation.js'
import type { PeriodInput, Criterion, Answers, Group } from './training-points.types.js'
type Tx = TransactionSql
interface Period {
  id: string
  class_id: string
  academic_year: string
  semester: '1' | '2' | 'SUMMER'
  name: string
  policy_label: string
  starts_at: string
  ends_at: string
  status: 'DRAFT' | 'OPEN' | 'CLOSED'
  revision: number
  criteria: Criterion[]
}
interface Declaration {
  id: string
  period_id: string
  student_user_id: string
  state: 'DRAFT' | 'SUBMITTED'
  revision: number
  answers: Answers
  student_snapshot: unknown
  period_snapshot: unknown
  evidence_snapshot: unknown
  total_points: number | null
  submit_request_id: string | null
  submitted_at: string | null
}
export interface TrainingFile {
  id: string
  declaration_id: string
  criterion: Group
  storage_key: string
  name: string
  mime_type: string
  size: number
  sha256: string
  signature_status: 'NOT_CHECKED'
  input_revision: number
  removed_at: string | null
}
interface Profile {
  classId: string
  fullName: string
  studentCode: string
  classCode: string
  facultyCode: string
}
export interface FileInput {
  requestId: string
  criterion: Group
  expectedRevision: number
  storageKey: string
  name: string
  mimeType: string
  size: number
  sha256: string
}
const fail = (status: number, code: string, message: string) =>
  new SubmissionError(status, code, message)
const missing = () => fail(404, 'TRAINING_NOT_FOUND', 'Không tìm thấy đợt hoặc bản kê khai.')
const conflict = () =>
  fail(
    409,
    'TRAINING_CONFLICT',
    'Thông tin đã thay đổi hoặc yêu cầu đã được xử lý. Hãy tải lại trạng thái.',
  )
const periodView = (p: Period) => ({
  id: p.id,
  classId: p.class_id,
  name: p.name,
  academicYear: p.academic_year,
  semester: p.semester,
  policyLabel: p.policy_label,
  startsAt: p.starts_at,
  endsAt: p.ends_at,
  status: p.status,
  revision: p.revision,
  criteria: p.criteria,
})
// Bind serialized JSON as text first: raw postgres and Drizzle clients use different JSON serializers.
export class TrainingPointRepository {
  constructor(private readonly database: Sql = databaseClient) {}
  private async locks(tx: Tx) {
    await tx`LOCK TABLE users,roles,user_roles,role_permissions,permissions,user_role_scopes,authorization_scopes,student_profiles,academic_classes,faculties IN SHARE MODE`
  }
  private async profile(tx: Tx, user: string) {
    const [row] = await tx<
      { data: Profile }[]
    >`SELECT jsonb_build_object('classId',c.id,'fullName',u.full_name,'studentCode',s.student_code,'classCode',c.code,'facultyCode',f.code) AS data FROM users u JOIN student_profiles s ON s.user_id=u.id JOIN academic_classes c ON c.id=s.class_id AND c.status='ACTIVE' JOIN faculties f ON f.id=c.faculty_id AND f.status='ACTIVE' WHERE u.id=${user} AND u.status='ACTIVE' AND NOT u.must_change_password AND EXISTS(SELECT 1 FROM user_roles ur JOIN roles role ON role.id=ur.role_id WHERE ur.user_id=u.id AND role.code='STUDENT')`
    if (!row)
      throw fail(
        403,
        'TRAINING_STUDENT_UNAVAILABLE',
        'Tài khoản hoặc hồ sơ sinh viên chưa đủ điều kiện sử dụng.',
      )
    return row.data
  }
  private async manager(tx: Tx, user: string, classId?: string) {
    const [row] = classId
      ? await tx<
          { ok: boolean }[]
        >`SELECT training_can_manage(${user}::uuid,${classId}::uuid) AS ok`
      : await tx<
          { ok: boolean }[]
        >`SELECT EXISTS(SELECT 1 FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN role_permissions rp ON rp.role_id=ur.role_id JOIN permissions p ON p.id=rp.permission_id AND p.code='training_point.period.manage' JOIN user_role_scopes urs ON urs.user_id=ur.user_id AND urs.role_id=ur.role_id WHERE u.id=${user} AND u.status='ACTIVE' AND NOT u.must_change_password AND EXISTS(SELECT 1 FROM user_roles admin JOIN roles role ON role.id=admin.role_id WHERE admin.user_id=u.id AND role.code IN ('ADMIN','SYSTEM_ADMIN'))) AS ok`
    if (!row?.ok)
      throw fail(
        403,
        'TRAINING_MANAGE_FORBIDDEN',
        'Bạn chưa có quyền quản lý đợt trong phạm vi này.',
      )
  }
  private async period(tx: Tx, id: string, lock = false) {
    const rows = lock
      ? await tx<
          { data: Period }[]
        >`SELECT to_jsonb(p) AS data FROM training_periods p WHERE id=${id} FOR UPDATE`
      : await tx<
          { data: Period }[]
        >`SELECT to_jsonb(p) AS data FROM training_periods p WHERE id=${id}`
    if (!rows[0]) throw missing()
    return rows[0].data
  }
  private async owned(tx: Tx, user: string, id: string, lock = false) {
    await this.profile(tx, user)
    const rows = await tx<
      { data: Declaration }[]
    >`SELECT to_jsonb(d) AS data FROM training_declarations d WHERE id=${id} AND student_user_id=${user}`
    if (!rows[0]) throw missing()
    const period = await this.period(tx, rows[0].data.period_id, lock)
    const current = lock
      ? await tx<
          { data: Declaration }[]
        >`SELECT to_jsonb(d) AS data FROM training_declarations d WHERE id=${id} AND student_user_id=${user} FOR UPDATE`
      : rows
    if (!current[0]) throw missing()
    return { row: current[0].data, period }
  }
  private async editable(tx: Tx, user: string, p: Period, row?: Declaration) {
    const profile = await this.profile(tx, user)
    const [time] = await tx<
      { ok: boolean }[]
    >`SELECT clock_timestamp()>=${p.starts_at}::timestamptz AND clock_timestamp()<${p.ends_at}::timestamptz AS ok`
    if (
      profile.classId !== p.class_id ||
      p.status !== 'OPEN' ||
      !time?.ok ||
      (row && row.state !== 'DRAFT')
    )
      throw fail(
        409,
        'TRAINING_NOT_EDITABLE',
        'Đợt chưa mở, đã hết hạn hoặc bản kê khai đã nộp. Chỉ được xem lịch sử.',
      )
    return profile
  }
  private async audit(tx: Tx, user: string, action: string, id: string, revision: number) {
    await tx`INSERT INTO audit_logs(actor_type,actor_user_id,actor_username,action,resource_type,resource_id,outcome,metadata) SELECT 'USER',id,username,${'training.' + action},'training_points',${id},'SUCCESS',jsonb_build_object('revision',${revision}::integer) FROM users WHERE id=${user}`
  }
  private async event(
    tx: Tx,
    user: string,
    row: Declaration,
    action: string,
    metadata: object = {},
  ) {
    await tx`INSERT INTO training_events(id,declaration_id,actor_user_id,action,revision,metadata) VALUES(${randomUUID()},${row.id},${user},${action},${row.revision},${JSON.stringify(metadata)}::text::jsonb)`
    await this.audit(tx, user, action.toLowerCase(), row.id, row.revision)
  }
  private async files(tx: Tx, id: string) {
    return tx<
      TrainingFile[]
    >`SELECT * FROM training_evidence WHERE declaration_id=${id} AND removed_at IS NULL ORDER BY id`
  }
  private async view(tx: Tx, user: string, row: Declaration, p: Period) {
    const profile = await this.profile(tx, user),
      files = await this.files(tx, row.id)
    const [time] = await tx<
      { ok: boolean }[]
    >`SELECT clock_timestamp()>=${p.starts_at}::timestamptz AND clock_timestamp()<${p.ends_at}::timestamptz AS ok`
    const history = await tx<
      { id: string; action: string; revision: number; createdAt: string }[]
    >`SELECT id,action,revision,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt" FROM training_events WHERE declaration_id=${row.id} ORDER BY revision DESC LIMIT 101`
    return {
      id: row.id,
      period: periodView(p),
      state: row.state,
      revision: row.revision,
      answers: row.answers,
      editable:
        row.state === 'DRAFT' &&
        p.status === 'OPEN' &&
        Boolean(time?.ok) &&
        profile.classId === p.class_id,
      student: row.student_snapshot ?? {
        fullName: profile.fullName,
        studentCode: profile.studentCode,
        classCode: profile.classCode,
        facultyCode: profile.facultyCode,
      },
      totalPoints:
        row.total_points ?? Object.values(row.answers).reduce((n, a) => n + (a.points ?? 0), 0),
      submittedAt: row.submitted_at,
      files: files.map((f) => ({
        id: f.id,
        criterion: f.criterion,
        name: f.name,
        mimeType: f.mime_type,
        size: f.size,
        sha256: f.sha256,
        signatureStatus: f.signature_status,
      })),
      history: history.slice(0, 100).reverse(),
      historyTruncated: history.length > 100,
      scoreStatus: 'SELF_DECLARED_NOT_REVIEWED' as const,
    }
  }
  async catalog(user: string) {
    return this.database.begin(async (tx) => {
      await this.manager(tx, user)
      const classes = await tx<
        { id: string; name: string; code: string; facultyName: string }[]
      >`SELECT c.id,c.name,c.code,f.name AS "facultyName" FROM academic_classes c JOIN faculties f ON f.id=c.faculty_id WHERE training_can_manage(${user}::uuid,c.id) ORDER BY c.code LIMIT 501`
      return { classes: classes.slice(0, 500), truncated: classes.length > 500 }
    })
  }
  async periods(user: string, admin = false) {
    return this.database.begin(async (tx) => {
      if (admin) await this.manager(tx, user)
      else await this.profile(tx, user)
      const rows = admin
        ? await tx<
            { data: Period; declarationId: string | null; declarationState: string | null }[]
          >`SELECT to_jsonb(p) AS data,NULL::text AS "declarationId",NULL::text AS "declarationState" FROM training_periods p WHERE training_can_manage(${user}::uuid,p.class_id) ORDER BY p.created_at DESC,p.id DESC LIMIT 201`
        : await tx<
            { data: Period; declarationId: string | null; declarationState: string | null }[]
          >`SELECT to_jsonb(p) AS data,d.id AS "declarationId",d.state AS "declarationState" FROM training_periods p LEFT JOIN training_declarations d ON d.period_id=p.id AND d.student_user_id=${user} WHERE d.id IS NOT NULL OR (p.status<>'DRAFT' AND p.class_id=(SELECT class_id FROM student_profiles WHERE user_id=${user})) ORDER BY p.created_at DESC,p.id DESC LIMIT 201`
      return {
        items: rows.slice(0, 200).map((r) => ({
          ...periodView(r.data),
          declarationId: r.declarationId,
          declarationState: r.declarationState,
        })),
        truncated: rows.length > 200,
      }
    })
  }
  async periodDetail(user: string, id: string) {
    return this.database.begin(async (tx) => {
      const p = await this.period(tx, id)
      await this.manager(tx, user, p.class_id)
      return periodView(p)
    })
  }
  async createPeriod(user: string, input: PeriodInput) {
    validatePeriod(input)
    try {
      return await this.database.begin(async (tx) => {
        await this.locks(tx)
        await this.manager(tx, user, input.classId)
        const id = randomUUID()
        await tx`INSERT INTO training_periods(id,class_id,academic_year,semester,name,policy_label,starts_at,ends_at,criteria,created_by,updated_by) VALUES(${id},${input.classId},${input.academicYear},${input.semester},${input.name.trim()},${input.policyLabel.trim()},${input.startsAt},${input.endsAt},${JSON.stringify([...input.criteria].sort((a, b) => a.code.localeCompare(b.code)))}::text::jsonb,${user},${user})`
        const p = await this.period(tx, id)
        await this.audit(tx, user, 'period_created', id, p.revision)
        return periodView(p)
      })
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw conflict()
      throw e
    }
  }
  async changePeriod(
    user: string,
    id: string,
    expectedRevision: number,
    action: 'SAVE' | 'OPEN' | 'CLOSE',
    input?: PeriodInput,
  ) {
    if (input) validatePeriod(input)
    return this.database.begin(async (tx) => {
      await this.locks(tx)
      const p = await this.period(tx, id, true)
      await this.manager(tx, user, p.class_id)
      if (
        p.revision !== expectedRevision ||
        (action === 'CLOSE' && p.status !== 'OPEN') ||
        (action !== 'CLOSE' && p.status !== 'DRAFT')
      )
        throw conflict()
      if (action === 'SAVE') {
        if (
          !input ||
          input.classId !== p.class_id ||
          input.academicYear !== p.academic_year ||
          input.semester !== p.semester
        )
          throw conflict()
        await tx`UPDATE training_periods SET name=${input.name.trim()},policy_label=${input.policyLabel.trim()},starts_at=${input.startsAt},ends_at=${input.endsAt},criteria=${JSON.stringify([...input.criteria].sort((a, b) => a.code.localeCompare(b.code)))}::text::jsonb,revision=revision+1,updated_by=${user},updated_at=now() WHERE id=${id}`
      } else
        await tx`UPDATE training_periods SET status=${action === 'OPEN' ? 'OPEN' : 'CLOSED'},revision=revision+1,updated_by=${user},updated_at=now() WHERE id=${id}`
      const next = await this.period(tx, id)
      await this.audit(tx, user, 'period_' + action.toLowerCase(), id, next.revision)
      return periodView(next)
    })
  }
  async start(user: string, periodId: string) {
    return this.database.begin(async (tx) => {
      await this.locks(tx)
      await this.profile(tx, user)
      const p = await this.period(tx, periodId, true)
      const [existing] = await tx<
        { data: Declaration }[]
      >`SELECT to_jsonb(d) AS data FROM training_declarations d WHERE period_id=${p.id} AND student_user_id=${user}`
      if (existing) return this.view(tx, user, existing.data, p)
      await this.editable(tx, user, p)
      const id = randomUUID()
      await tx`INSERT INTO training_declarations(id,period_id,student_user_id) VALUES(${id},${periodId},${user})`
      const { row } = await this.owned(tx, user, id)
      await this.event(tx, user, row, 'CREATED')
      return this.view(tx, user, row, p)
    })
  }
  async detail(user: string, id: string) {
    return this.database.begin(async (tx) => {
      const { row, period } = await this.owned(tx, user, id)
      return this.view(tx, user, row, period)
    })
  }
  async save(user: string, id: string, expectedRevision: number, answers: Answers) {
    return this.database.begin(async (tx) => {
      await this.locks(tx)
      const { row, period } = await this.owned(tx, user, id, true)
      await this.editable(tx, user, period, row)
      if (row.revision !== expectedRevision) throw conflict()
      validateAnswers(answers, period.criteria)
      await tx`UPDATE training_declarations SET answers=${JSON.stringify(answers)}::text::jsonb,revision=revision+1,updated_at=now() WHERE id=${id}`
      const { row: next } = await this.owned(tx, user, id)
      await this.event(tx, user, next, 'SAVED')
      return this.view(tx, user, next, period)
    })
  }
  async submit(user: string, id: string, expectedRevision: number, requestId: string) {
    try {
      return await this.database.begin(async (tx) => {
        await this.locks(tx)
        const { row, period } = await this.owned(tx, user, id, true)
        if (row.state === 'SUBMITTED') {
          if (
            row.submit_request_id === requestId.toLowerCase() &&
            row.revision === expectedRevision + 1
          )
            return this.view(tx, user, row, period)
          throw conflict()
        }
        const profile = await this.editable(tx, user, period, row)
        if (row.revision !== expectedRevision) throw conflict()
        validateAnswers(row.answers, period.criteria, true)
        const files = await this.files(tx, id),
          missingFiles = period.criteria.filter(
            (c) =>
              c.evidenceRequired &&
              (row.answers[c.code]?.points ?? 0) > 0 &&
              !files.some((f) => f.criterion === c.code),
          )
        if (missingFiles.length)
          throw new SubmissionError(
            400,
            'TRAINING_EVIDENCE_REQUIRED',
            'Cần bổ sung minh chứng cho nhóm được đánh dấu.',
            missingFiles.map((c) => ({ path: c.code, message: 'Thiếu minh chứng.' })),
          )
        const total = Object.values(row.answers).reduce((n, a) => n + (a.points ?? 0), 0)
        const student = {
          fullName: profile.fullName,
          studentCode: profile.studentCode,
          classCode: profile.classCode,
          facultyCode: profile.facultyCode,
        }
        const snapshot = {
          name: period.name,
          academicYear: period.academic_year,
          semester: period.semester,
          policyLabel: period.policy_label,
          criteria: period.criteria,
        }
        await tx`UPDATE training_declarations SET state='SUBMITTED',revision=revision+1,student_snapshot=${JSON.stringify(student)}::text::jsonb,period_snapshot=${JSON.stringify(snapshot)}::text::jsonb,evidence_snapshot=training_file_snapshot(id),total_points=${total},submit_request_id=${requestId},submitted_at=now(),updated_at=now() WHERE id=${id}`
        const { row: next } = await this.owned(tx, user, id)
        await this.event(tx, user, next, 'SUBMITTED', { totalPoints: total })
        return this.view(tx, user, next, period)
      })
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw conflict()
      throw e
    }
  }
  async addFile(user: string, id: string, input: FileInput) {
    return this.database.begin(async (tx) => {
      await this.locks(tx)
      const { row, period } = await this.owned(tx, user, id, true)
      const [existing] = await tx<
        TrainingFile[]
      >`SELECT * FROM training_evidence WHERE id=${input.requestId}`
      if (existing) {
        if (
          existing.declaration_id !== id ||
          existing.criterion !== input.criterion ||
          existing.input_revision !== input.expectedRevision ||
          existing.sha256 !== input.sha256 ||
          existing.name !== input.name ||
          existing.mime_type !== input.mimeType ||
          existing.size !== input.size ||
          existing.removed_at
        )
          throw conflict()
        return { view: await this.view(tx, user, row, period), usedKey: existing.storage_key }
      }
      await this.editable(tx, user, period, row)
      if (row.revision !== input.expectedRevision) throw conflict()
      const files = await this.files(tx, id)
      if (
        files.length >= 10 ||
        files.filter((f) => f.criterion === input.criterion).length >= 3 ||
        files.reduce((n, f) => n + f.size, 0) + input.size > 20 * 1024 * 1024
      )
        throw fail(413, 'TRAINING_FILE_LIMIT', 'Tối đa 3 tệp/nhóm, 10 tệp và 20 MiB/bản kê khai.')
      await tx`INSERT INTO training_evidence(id,declaration_id,criterion,storage_key,name,mime_type,size,sha256,input_revision) VALUES(${input.requestId},${id},${input.criterion},${input.storageKey},${input.name},${input.mimeType},${input.size},${input.sha256},${input.expectedRevision})`
      await tx`UPDATE training_declarations SET revision=revision+1,updated_at=now() WHERE id=${id}`
      const { row: next } = await this.owned(tx, user, id)
      await this.event(tx, user, next, 'FILE_ADDED', {
        fileId: input.requestId,
        criterion: input.criterion,
      })
      return { view: await this.view(tx, user, next, period), usedKey: input.storageKey }
    })
  }
  async removeFile(user: string, id: string, fileId: string, expectedRevision: number) {
    return this.database.begin(async (tx) => {
      await this.locks(tx)
      const { row, period } = await this.owned(tx, user, id, true)
      await this.editable(tx, user, period, row)
      if (row.revision !== expectedRevision) throw conflict()
      const [file] = await tx<
        TrainingFile[]
      >`SELECT * FROM training_evidence WHERE id=${fileId} AND declaration_id=${id} AND removed_at IS NULL`
      if (!file) throw missing()
      await tx`UPDATE training_evidence SET removed_at=now() WHERE id=${fileId}`
      await tx`UPDATE training_declarations SET revision=revision+1,updated_at=now() WHERE id=${id}`
      const { row: next } = await this.owned(tx, user, id)
      await this.event(tx, user, next, 'FILE_REMOVED', { fileId })
      return this.view(tx, user, next, period)
    })
  }
  async file(user: string, id: string, fileId: string) {
    return this.database.begin(async (tx) => {
      await this.owned(tx, user, id)
      const [f] = await tx<
        TrainingFile[]
      >`SELECT * FROM training_evidence WHERE declaration_id=${id} AND id=${fileId} AND removed_at IS NULL`
      if (!f) throw missing()
      return f
    })
  }
}
