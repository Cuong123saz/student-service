import type { Sql, TransactionSql } from 'postgres'
import { databaseClient } from '../../db/client.js'
import { SubmissionError, type SubmissionActor } from '../submissions/submission.types.js'
import {
  activityLimits,
  trackedFields,
  type Activity,
  type ActivityDetail,
  type ActivityEvent,
  type ActivityInput,
  type ActivityPermissions,
  type ActivityUpdate,
  type ClubRef,
  type Eligibility,
  type MandatoryOwner,
  type RegistrationStatus,
} from './activity.types.js'

type Tx = TransactionSql
const fail = (n: number, code: string, msg: string) => new SubmissionError(n, code, msg)
const forbidden = () =>
  fail(403, 'ACTIVITY_FORBIDDEN', 'Tài khoản không có quyền với hoạt động này.')
const missing = () =>
  fail(404, 'ACTIVITY_NOT_FOUND', 'Không tìm thấy hoạt động trong phạm vi của bạn.')
const conflict = () =>
  fail(
    409,
    'ACTIVITY_CONFLICT',
    'Hoạt động đã thay đổi hoặc thao tác không còn phù hợp. Hãy tải lại.',
  )
const invalid = (msg: string) => fail(400, 'INVALID_ACTIVITY', msg)
const iso = (c: string) => `to_char(${c} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`
const clubJson = (alias: string) =>
  `CASE WHEN ${alias}.id IS NULL THEN NULL ELSE jsonb_build_object('id',${alias}.id,'code',${alias}u.code,'name',${alias}u.name,'status',${alias}.status) END`
const columns = `a.id,a.kind,a.category,a.owner_type AS "ownerType",${clubJson('oc')} AS "ownerClub",${clubJson('dc')} AS "delegatedClub",
  a.title,a.description,a.location,${iso('a.starts_at')} AS "startsAt",${iso('a.ends_at')} AS "endsAt",a.capacity,a.eligibility,
  a.status,a.status_reason AS "statusReason",a.revision,CASE WHEN a.published_at IS NULL THEN NULL ELSE ${iso('a.published_at')} END AS "publishedAt",
  ${iso('a.created_at')} AS "createdAt"`
const from = `activities a
  LEFT JOIN clubs oc ON oc.id=a.owner_club_id LEFT JOIN organizational_units ocu ON ocu.id=oc.organizational_unit_id
  LEFT JOIN clubs dc ON dc.id=a.delegated_club_id LEFT JOIN organizational_units dcu ON dcu.id=dc.organizational_unit_id`

/** ADR 0031: the student's view of its own registration on an activity row aliased `a`/`r`. */
export const registrationView = `r.id AS "registrationId",
  CASE WHEN r.status='CANCEL_REQUESTED' AND a.starts_at<=clock_timestamp() THEN 'CANCELLED' ELSE r.status END AS "myStatus",
  (SELECT count(*)::integer FROM activity_registrations x WHERE x.activity_id=a.id AND x.status IN ('REGISTERED','CANCEL_REQUESTED')) AS "seatsTaken",
  CASE WHEN r.status='WAITLISTED' THEN (SELECT count(*)::integer+1 FROM activity_registrations x WHERE x.activity_id=a.id AND x.status='WAITLISTED' AND (x.queued_at,x.id)<(r.queued_at,r.id)) END AS "waitlistPosition",
  (r.promoted_at IS NOT NULL AND r.promotion_seen_at IS NULL AND r.status='REGISTERED') AS "promotionNotice",
  ${iso("(a.starts_at - interval '24 hours')")} AS "cancelDeadline"`
export interface StudentRegistrationView {
  registrationId: string | null
  myStatus: RegistrationStatus | null
  seatsTaken: number
  waitlistPosition: number | null
  promotionNotice: boolean
  cancelDeadline: string
}

export interface Access {
  read: boolean
  moderate: boolean
  /** Mandatory owners the actor may act for; Phòng ĐT may be limited to faculties. */
  owners: { STUDENT_AFFAIRS: boolean; TRAINING_OFFICE: boolean }
  trainingFaculties: string[] | 'ALL'
  leaderClubs: string[]
}
interface Row extends Activity {
  startsMs: number
  endsMs: number
}

/** ADR 0030: activities owned by CTSV / Phòng Đào tạo (mandatory) or by a club (voluntary). */
export class ActivityRepository {
  constructor(private readonly db: Sql = databaseClient) {}

  /** @internal shared with ActivityRegistrationRepository. */
  async access(tx: Tx, user: string): Promise<Access> {
    const [flags] = await tx<
      { read: boolean; moderate: boolean }[]
    >`SELECT club_staff_allowed(${user}::uuid,'activity.read') AS read,club_staff_allowed(${user}::uuid,'activity.moderate') AS moderate`
    const scopes = await tx<{ role: string; scopeType: string; facultyId: string | null }[]>`
      SELECT r.code AS role,s.scope_type AS "scopeType",s.faculty_id AS "facultyId"
      FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id AND r.code IN ('STUDENT_AFFAIRS','TRAINING_OFFICE')
      JOIN role_permissions rp ON rp.role_id=r.id JOIN permissions p ON p.id=rp.permission_id AND p.code='activity.mandatory.manage'
      JOIN user_role_scopes urs ON urs.user_id=u.id AND urs.role_id=r.id JOIN authorization_scopes s ON s.id=urs.scope_id
      WHERE u.id=${user} AND u.status='ACTIVE' AND NOT u.must_change_password`
    const sa = scopes.some((s) => s.role === 'STUDENT_AFFAIRS' && s.scopeType === 'GLOBAL')
    const to = scopes.filter((s) => s.role === 'TRAINING_OFFICE')
    const clubs = await tx<{ id: string }[]>`
      SELECT c.id FROM clubs c WHERE club_is_leader(${user}::uuid,c.id) AND EXISTS(
        SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id AND r.code='CLUB_LEADER' JOIN role_permissions rp ON rp.role_id=r.id
        JOIN permissions p ON p.id=rp.permission_id AND p.code='activity.club.manage' WHERE ur.user_id=${user})`
    return {
      read: !!flags?.read,
      moderate: !!flags?.moderate,
      owners: { STUDENT_AFFAIRS: sa, TRAINING_OFFICE: to.length > 0 },
      trainingFaculties: to.some((s) => s.scopeType === 'GLOBAL')
        ? 'ALL'
        : to.flatMap((s) => (s.facultyId ? [s.facultyId] : [])),
      leaderClubs: clubs.map((c) => c.id),
    }
  }
  /** @internal shared with ActivityRegistrationRepository. */
  async lockRights(tx: Tx) {
    await tx`LOCK TABLE users,roles,user_roles,role_permissions,permissions,user_role_scopes,authorization_scopes,club_leader_assignments IN SHARE MODE`
  }
  private withinTraining(access: Access, e: Eligibility) {
    if (access.trainingFaculties === 'ALL') return true
    const own = new Set(access.trainingFaculties)
    return e.facultyIds.length > 0 && e.facultyIds.every((f) => own.has(f))
  }
  /** The owner manages; a delegated club never edits mandatory activities. */
  /** @internal shared with ActivityRegistrationRepository. */
  owns(access: Access, a: Pick<Activity, 'ownerType' | 'ownerClub' | 'eligibility'>) {
    if (a.ownerType === 'CLUB') return !!a.ownerClub && access.leaderClubs.includes(a.ownerClub.id)
    if (a.ownerType === 'STUDENT_AFFAIRS') return access.owners.STUDENT_AFFAIRS
    return access.owners.TRAINING_OFFICE && this.withinTraining(access, a.eligibility)
  }
  /** @internal shared with ActivityRegistrationRepository. */
  visible(access: Access, a: Activity) {
    return (
      access.read ||
      this.owns(access, a) ||
      (!!a.ownerClub && access.leaderClubs.includes(a.ownerClub.id)) ||
      (!!a.delegatedClub && access.leaderClubs.includes(a.delegatedClub.id))
    )
  }
  private permissions(access: Access, a: Row): ActivityPermissions {
    const now = Date.now(),
      owner = this.owns(access, a),
      open = a.status !== 'CANCELLED',
      clubActive = a.ownerType !== 'CLUB' || a.ownerClub?.status === 'ACTIVE'
    return {
      canEdit: owner && open && now < a.startsMs,
      canPublish: owner && a.status === 'DRAFT' && now < a.startsMs && clubActive,
      canCancel: owner && open && now < a.endsMs,
      canDelegate: owner && a.kind === 'MANDATORY' && open && now < a.endsMs,
      canSuspend: access.moderate && a.status === 'PUBLISHED',
      canResume: access.moderate && a.status === 'SUSPENDED' && now < a.endsMs,
      canReview: owner || (!!a.delegatedClub && access.leaderClubs.includes(a.delegatedClub.id)),
      canConfigureCheckin: owner && open,
    }
  }
  /** @internal shared with ActivityRegistrationRepository. */
  async row(tx: Tx, id: string, lock = false) {
    const [a] = await tx<Row[]>`
      SELECT ${tx.unsafe(columns)},(extract(epoch from a.starts_at)*1000)::float8 AS "startsMs",(extract(epoch from a.ends_at)*1000)::float8 AS "endsMs"
      FROM ${tx.unsafe(from)} WHERE a.id=${id} ${lock ? tx`FOR UPDATE OF a` : tx``}`
    return a
  }
  private strip(a: Row): Activity {
    const { startsMs: _s, endsMs: _e, ...rest } = a
    return rest
  }
  private async validate(tx: Tx, input: Omit<ActivityUpdate, 'expectedRevision'>) {
    const starts = Date.parse(input.startsAt),
      ends = Date.parse(input.endsAt)
    if (!Number.isFinite(starts) || !Number.isFinite(ends) || ends <= starts)
      throw invalid('Giờ kết thúc phải sau giờ bắt đầu.')
    if (ends - starts > activityLimits.maxDurationMs)
      throw invalid('Một hoạt động kéo dài tối đa 14 ngày.')
    const e = input.eligibility
    for (const list of [e.facultyIds, e.classIds, e.cohortYears] as unknown[][])
      if (list.length > activityLimits.maxListItems || new Set(list).size !== list.length)
        throw invalid('Danh sách đối tượng tối đa 50 mục và không trùng lặp.')
    if (e.cohortYears.some((y) => y < activityLimits.minCohort || y > activityLimits.maxCohort))
      throw invalid('Niên khóa phải là năm vào học từ 2007 đến 2100.')
    if (e.facultyIds.length) {
      const [r] = await tx<
        { n: number }[]
      >`SELECT count(*)::integer AS n FROM faculties WHERE id=ANY(${e.facultyIds}::uuid[]) AND status='ACTIVE'`
      if (r!.n !== e.facultyIds.length) throw invalid('Có khoa không tồn tại hoặc đã ngừng.')
    }
    if (e.classIds.length) {
      const rows = await tx<
        { facultyId: string }[]
      >`SELECT faculty_id AS "facultyId" FROM academic_classes WHERE id=ANY(${e.classIds}::uuid[]) AND status='ACTIVE'`
      if (rows.length !== e.classIds.length) throw invalid('Có lớp không tồn tại hoặc đã ngừng.')
      if (e.facultyIds.length && rows.some((r) => !e.facultyIds.includes(r.facultyId)))
        throw invalid('Lớp đã chọn phải thuộc các khoa đã chọn.')
    }
    return {
      startsAt: new Date(starts).toISOString(),
      endsAt: new Date(ends).toISOString(),
      eligibility: {
        facultyIds: [...e.facultyIds].sort(),
        classIds: [...e.classIds].sort(),
        cohortYears: [...e.cohortYears].sort((a, b) => a - b),
      },
    }
  }
  private async record(
    tx: Tx,
    actor: SubmissionActor,
    activityId: string,
    revision: number,
    action: string,
    data: { reason?: string | null; before?: unknown; after?: unknown },
  ) {
    await tx`INSERT INTO activity_events(activity_id,revision,action,actor_user_id,reason,before,after)
      VALUES(${activityId},${revision},${action},${actor.userId},${data.reason ?? null},${data.before === undefined ? null : tx.json(data.before as never)},${data.after === undefined ? null : tx.json(data.after as never)})`
    await tx`INSERT INTO audit_logs(actor_type,actor_user_id,actor_username,action,resource_type,resource_id,outcome,request_id,ip_address,user_agent,metadata)
      SELECT 'USER',id,username,${'activity.' + action.toLowerCase()},'activity',${activityId},'SUCCESS',${actor.requestId},${actor.ipAddress},${actor.userAgent},
        ${tx.json({ activityId, revision, reason: data.reason ?? null })}
      FROM users WHERE id=${actor.userId}`
  }

  async options(user: string) {
    return this.db.begin('isolation level repeatable read, read only', async (tx) => {
      const access = await this.access(tx, user)
      const mandatory = access.owners.STUDENT_AFFAIRS || access.owners.TRAINING_OFFICE
      if (!mandatory && !access.leaderClubs.length && !access.read) throw forbidden()
      const faculties = await tx<{ id: string; code: string; name: string }[]>`
        SELECT id,code,name FROM faculties WHERE status='ACTIVE'
          AND (${access.trainingFaculties === 'ALL' || access.owners.STUDENT_AFFAIRS || !mandatory}::boolean OR id=ANY(${access.trainingFaculties === 'ALL' ? [] : access.trainingFaculties}::uuid[]))
        ORDER BY code LIMIT 500`
      const classes = await tx<{ id: string; code: string; name: string; facultyId: string }[]>`
        SELECT id,code,name,faculty_id AS "facultyId" FROM academic_classes WHERE status='ACTIVE' AND faculty_id=ANY(${faculties.map((f) => f.id)}::uuid[]) ORDER BY code LIMIT 3000`
      const clubs = await tx<(ClubRef & { isLeader: boolean })[]>`
        SELECT c.id,u.code,u.name,c.status,c.id=ANY(${access.leaderClubs}::uuid[]) AS "isLeader"
        FROM clubs c JOIN organizational_units u ON u.id=c.organizational_unit_id WHERE c.status='ACTIVE' ORDER BY u.code LIMIT 500`
      return {
        mandatoryOwners: (['STUDENT_AFFAIRS', 'TRAINING_OFFICE'] as const).filter(
          (o) => access.owners[o],
        ),
        trainingFacultyLimited:
          access.trainingFaculties !== 'ALL' && !access.owners.STUDENT_AFFAIRS,
        faculties,
        classes,
        leaderClubs: clubs.filter((c) => c.isLeader).map(({ isLeader: _l, ...c }) => c),
        delegationClubs: mandatory ? clubs.map(({ isLeader: _l, ...c }) => c) : [],
      }
    })
  }

  async list(user: string) {
    return this.db.begin('isolation level repeatable read, read only', async (tx) => {
      const access = await this.access(tx, user)
      const mandatory = access.owners.STUDENT_AFFAIRS || access.owners.TRAINING_OFFICE
      if (!access.read && !mandatory && !access.leaderClubs.length) throw forbidden()
      const rows = await tx<Row[]>`
        SELECT ${tx.unsafe(columns)},0::float8 AS "startsMs",0::float8 AS "endsMs" FROM ${tx.unsafe(from)}
        WHERE ${access.read || mandatory}::boolean OR a.owner_club_id=ANY(${access.leaderClubs}::uuid[]) OR a.delegated_club_id=ANY(${access.leaderClubs}::uuid[])
        ORDER BY a.starts_at DESC,a.id LIMIT 201`
      const items = rows.filter((r) => this.visible(access, r)).map((r) => this.strip(r))
      return { items: items.slice(0, 200), truncated: rows.length > 200 }
    })
  }

  async detail(user: string, id: string, tx?: Tx): Promise<ActivityDetail> {
    const run = async (q: Tx) => {
      const access = await this.access(q, user)
      const a = await this.row(q, id)
      if (!a || !this.visible(access, a)) throw missing()
      const events = await q<ActivityEvent[]>`
        SELECT e.id,e.revision,e.action,u.username AS actor,e.reason,e.before,e.after,${q.unsafe(iso('e.created_at'))} AS "createdAt"
        FROM activity_events e JOIN users u ON u.id=e.actor_user_id WHERE e.activity_id=${id} ORDER BY e.revision DESC LIMIT 200`
      return { ...this.strip(a), ...this.permissions(access, a), events }
    }
    return tx ? run(tx) : this.db.begin('isolation level repeatable read, read only', run)
  }

  async create(actor: SubmissionActor, input: ActivityInput) {
    return this.db.begin(async (tx) => {
      await this.lockRights(tx)
      const access = await this.access(tx, actor.userId)
      const clean = await this.validate(tx, input)
      let owner: MandatoryOwner | 'CLUB',
        clubId: string | null = null
      if (input.kind === 'MANDATORY') {
        const held = (['STUDENT_AFFAIRS', 'TRAINING_OFFICE'] as const).filter(
          (o) => access.owners[o],
        )
        owner = input.ownerType ?? held[0]!
        if (!held.length || !held.includes(owner)) throw forbidden()
        if (owner === 'TRAINING_OFFICE' && !this.withinTraining(access, clean.eligibility))
          throw invalid('Phòng Đào tạo theo khoa chỉ tạo hoạt động cho các khoa được giao.')
        if (input.clubId) throw invalid('Hoạt động bắt buộc giao CLB bằng thao tác riêng.')
      } else {
        if (input.ownerType) throw invalid('Hoạt động tự nguyện thuộc về CLB.')
        if (!input.clubId || !access.leaderClubs.includes(input.clubId)) throw forbidden()
        const [club] = await tx<
          { status: string }[]
        >`SELECT status FROM clubs WHERE id=${input.clubId} FOR SHARE`
        if (club?.status !== 'ACTIVE')
          throw fail(409, 'CLUB_NOT_ACTIVE', 'CLB đang tạm dừng hoặc đã giải thể.')
        owner = 'CLUB'
        clubId = input.clubId
      }
      const [created] = await tx<{ id: string }[]>`
        INSERT INTO activities(kind,category,owner_type,owner_club_id,title,description,location,starts_at,ends_at,capacity,eligibility,created_by_user_id)
        VALUES(${input.kind},${input.category},${owner},${clubId},${input.title},${input.description},${input.location},${clean.startsAt},${clean.endsAt},${input.capacity},${tx.json(clean.eligibility)},${actor.userId})
        RETURNING id`
      await this.record(tx, actor, created!.id, 0, 'CREATED', {
        after: { kind: input.kind, ownerType: owner, clubId },
      })
      return this.detail(actor.userId, created!.id, tx)
    })
  }

  /** Locks the activity and re-checks rights and revision inside the write transaction. */
  private async prepare(tx: Tx, actor: SubmissionActor, id: string, expectedRevision: number) {
    await this.lockRights(tx)
    const access = await this.access(tx, actor.userId)
    const a = await this.row(tx, id, true)
    if (!a || !this.visible(access, a)) throw missing()
    if (a.revision !== expectedRevision) throw conflict()
    return { access, a, can: this.permissions(access, a) }
  }

  async update(actor: SubmissionActor, id: string, input: ActivityUpdate) {
    return this.db.begin(async (tx) => {
      const { access, a, can } = await this.prepare(tx, actor, id, input.expectedRevision)
      if (!this.owns(access, a)) throw forbidden()
      if (!can.canEdit) throw conflict()
      const clean = await this.validate(tx, input)
      if (a.ownerType === 'TRAINING_OFFICE' && !this.withinTraining(access, clean.eligibility))
        throw invalid('Phòng Đào tạo theo khoa chỉ tạo hoạt động cho các khoa được giao.')
      if (Date.parse(clean.startsAt) <= Date.now() && a.status !== 'DRAFT')
        throw invalid('Hoạt động đã công bố phải bắt đầu ở tương lai.')
      const next = { ...input, ...clean }
      const before: Record<string, unknown> = {},
        after: Record<string, unknown> = {}
      // jsonb reorders object keys, so eligibility is compared by its three lists.
      const canon = (f: (typeof trackedFields)[number], v: unknown) =>
        f === 'eligibility'
          ? JSON.stringify([
              (v as Eligibility).facultyIds,
              (v as Eligibility).classIds,
              (v as Eligibility).cohortYears,
            ])
          : JSON.stringify(v)
      for (const f of trackedFields)
        if (canon(f, a[f]) !== canon(f, next[f])) {
          before[f] = a[f]
          after[f] = next[f]
        }
      if (!Object.keys(after).length) return this.detail(actor.userId, id, tx)
      // ADR 0031: capacity never drops below the seats already held.
      if (next.capacity !== null) {
        const [held] = await tx<
          { n: number }[]
        >`SELECT count(*)::integer AS n FROM activity_registrations WHERE activity_id=${id} AND status IN ('REGISTERED','CANCEL_REQUESTED')`
        if (held!.n > next.capacity)
          throw invalid('Sức chứa không được nhỏ hơn ' + held!.n + ' chỗ đã có người đăng ký.')
      }
      await tx`UPDATE activities SET category=${next.category},title=${next.title},description=${next.description},location=${next.location},
        starts_at=${next.startsAt},ends_at=${next.endsAt},capacity=${next.capacity},eligibility=${tx.json(next.eligibility)},
        revision=revision+1,updated_at=clock_timestamp() WHERE id=${id}`
      await this.record(tx, actor, id, a.revision + 1, 'UPDATED', { before, after })
      await tx`SELECT activity_promote(${id}::uuid)`
      return this.detail(actor.userId, id, tx)
    })
  }

  async transition(
    actor: SubmissionActor,
    id: string,
    action: 'PUBLISHED' | 'CANCELLED' | 'SUSPENDED' | 'RESUMED',
    expectedRevision: number,
    reason: string | null,
  ) {
    return this.db.begin(async (tx) => {
      const { access, a, can } = await this.prepare(tx, actor, id, expectedRevision)
      const allowed = {
        PUBLISHED: can.canPublish,
        CANCELLED: can.canCancel,
        SUSPENDED: can.canSuspend,
        RESUMED: can.canResume,
      }[action]
      // Wrong role → 403; right role but wrong state or time → 409.
      const holdsRole =
        action === 'SUSPENDED' || action === 'RESUMED' ? access.moderate : this.owns(access, a)
      if (!allowed) throw holdsRole ? conflict() : forbidden()
      if (action !== 'PUBLISHED' && !reason) throw invalid('Thao tác này bắt buộc ghi lý do.')
      if (action === 'PUBLISHED' && a.ownerClub) {
        const [club] = await tx<
          { status: string }[]
        >`SELECT status FROM clubs WHERE id=${a.ownerClub.id} FOR SHARE`
        if (club?.status !== 'ACTIVE')
          throw fail(409, 'CLUB_NOT_ACTIVE', 'CLB đang tạm dừng hoặc đã giải thể.')
      }
      const status = {
        PUBLISHED: 'PUBLISHED',
        CANCELLED: 'CANCELLED',
        SUSPENDED: 'SUSPENDED',
        RESUMED: 'PUBLISHED',
      }[action]
      await tx`UPDATE activities SET status=${status},status_reason=${reason},revision=revision+1,updated_at=clock_timestamp(),
        published_at=COALESCE(published_at,CASE WHEN ${status}='PUBLISHED' THEN clock_timestamp() END) WHERE id=${id}`
      await this.record(tx, actor, id, a.revision + 1, action, {
        reason,
        before: { status: a.status },
        after: { status },
      })
      if (status === 'PUBLISHED') await tx`SELECT activity_promote(${id}::uuid)`
      return this.detail(actor.userId, id, tx)
    })
  }

  async delegate(
    actor: SubmissionActor,
    id: string,
    expectedRevision: number,
    clubId: string | null,
    reason: string | null,
  ) {
    return this.db.begin(async (tx) => {
      const { a, can } = await this.prepare(tx, actor, id, expectedRevision)
      if (!can.canDelegate) throw a.kind === 'MANDATORY' && can.canEdit ? conflict() : forbidden()
      if ((a.delegatedClub?.id ?? null) === clubId) throw conflict()
      if (clubId) {
        const [club] = await tx<
          { status: string }[]
        >`SELECT status FROM clubs WHERE id=${clubId} FOR SHARE`
        if (club?.status !== 'ACTIVE')
          throw fail(409, 'CLUB_NOT_ACTIVE', 'Chỉ giao được cho CLB đang hoạt động.')
      }
      await tx`UPDATE activities SET delegated_club_id=${clubId},revision=revision+1,updated_at=clock_timestamp() WHERE id=${id}`
      await this.record(
        tx,
        actor,
        id,
        a.revision + 1,
        clubId ? 'DELEGATED' : 'DELEGATION_REVOKED',
        {
          reason,
          before: { clubId: a.delegatedClub?.id ?? null },
          after: { clubId },
        },
      )
      return this.detail(actor.userId, id, tx)
    })
  }

  /** Student view: published, not ended and eligible (server-side rule shared with 11.3–11.4). */
  async available(user: string) {
    return this.db.begin('isolation level repeatable read, read only', async (tx) => {
      // ADR 0031: the student's own registration, seats taken and queue position. A pending
      // cancellation already past the start is shown as accepted (activity_settle applies it on write).
      const rows = await tx<(Activity & StudentRegistrationView)[]>`
        SELECT ${tx.unsafe(columns)},${tx.unsafe(registrationView)}
        FROM ${tx.unsafe(from)} LEFT JOIN activity_registrations r ON r.activity_id=a.id AND r.student_user_id=${user}
        WHERE a.status='PUBLISHED' AND a.ends_at>clock_timestamp() AND activity_student_eligible(${user}::uuid,a.id)
        ORDER BY a.starts_at,a.id LIMIT 201`
      return {
        items: rows.slice(0, 200).map(({ eligibility: _e, statusReason: _r, ...a }) => a),
        truncated: rows.length > 200,
      }
    })
  }
}
