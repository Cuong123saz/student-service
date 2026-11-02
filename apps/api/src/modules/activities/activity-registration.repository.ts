import type { Sql, TransactionSql } from 'postgres'
import { databaseClient } from '../../db/client.js'
import { SubmissionError, type SubmissionActor } from '../submissions/submission.types.js'
import {
  ActivityRepository,
  registrationView,
  type StudentRegistrationView,
} from './activity.repository.js'
import { cancelNoticeMs, type Activity, type RegistrationStatus } from './activity.types.js'

type Tx = TransactionSql
const fail = (n: number, code: string, msg: string) => new SubmissionError(n, code, msg)
const missing = () =>
  fail(404, 'ACTIVITY_NOT_FOUND', 'Không tìm thấy hoạt động trong phạm vi của bạn.')
const conflict = (msg = 'Đăng ký đã thay đổi hoặc thao tác không còn phù hợp. Hãy tải lại.') =>
  fail(409, 'ACTIVITY_REGISTRATION_CONFLICT', msg)
const iso = (c: string) => `to_char(${c} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`

interface RegistrationRow {
  id: string
  status: RegistrationStatus
  studentUserId: string
  revision: number
}
export interface RosterEntry {
  id: string
  studentUserId: string
  studentCode: string
  fullName: string
  classCode: string
  status: RegistrationStatus
  /** Derived (ADR 0031): ended activity, seat held, no approved attendance yet (11.4). */
  absent: boolean
  queuedAt: string
  waitlistPosition: number | null
  cancelReason: string | null
  cancelRequestedAt: string | null
  decisionNote: string | null
  autoAccepted: boolean
  excused: boolean
  revision: number
}

/** ADR 0031: registration, waitlist and cancellation requests. */
export class ActivityRegistrationRepository {
  private readonly activities: ActivityRepository
  constructor(private readonly db: Sql = databaseClient) {
    this.activities = new ActivityRepository(db)
  }

  /** Locks the activity row first so seat counting is serialised, then settles overdue requests. */
  private async lockActivity(tx: Tx, id: string) {
    const [a] = await tx<
      { status: Activity['status']; startsMs: number; endsMs: number; capacity: number | null }[]
    >`SELECT status,capacity,(extract(epoch from starts_at)*1000)::float8 AS "startsMs",(extract(epoch from ends_at)*1000)::float8 AS "endsMs"
      FROM activities WHERE id=${id} FOR UPDATE`
    if (!a) throw missing()
    await tx`SELECT activity_settle(${id}::uuid)`
    return a
  }
  private async mine(tx: Tx, user: string, activityId: string) {
    const [r] = await tx<RegistrationRow[]>`
      SELECT id,status,student_user_id AS "studentUserId",revision FROM activity_registrations
      WHERE activity_id=${activityId} AND student_user_id=${user} FOR UPDATE`
    return r
  }
  private async event(
    tx: Tx,
    registrationId: string,
    activityId: string,
    action: string,
    from: RegistrationStatus | null,
    to: RegistrationStatus,
    actor: string | null,
    reason: string | null = null,
  ) {
    await tx`INSERT INTO activity_registration_events(registration_id,activity_id,action,from_status,to_status,actor_user_id,reason)
      VALUES(${registrationId},${activityId},${action},${from},${to},${actor},${reason})`
  }
  private async view(tx: Tx, user: string, activityId: string) {
    const [v] = await tx<(StudentRegistrationView & { activityId: string })[]>`
      SELECT a.id AS "activityId",${tx.unsafe(registrationView)} FROM activities a
      LEFT JOIN activity_registrations r ON r.activity_id=a.id AND r.student_user_id=${user} WHERE a.id=${activityId}`
    return v!
  }

  async register(actor: SubmissionActor, activityId: string) {
    return this.db.begin(async (tx) => {
      const a = await this.lockActivity(tx, activityId)
      const [eligible] = await tx<
        { ok: boolean }[]
      >`SELECT activity_student_eligible(${actor.userId}::uuid,${activityId}::uuid) AS ok`
      // Students outside the audience never learn that the activity exists.
      if (!eligible?.ok || a.status === 'DRAFT') throw missing()
      if (a.status !== 'PUBLISHED' || Date.now() >= a.startsMs)
        throw conflict('Hoạt động không còn nhận đăng ký.')
      const existing = await this.mine(tx, actor.userId, activityId)
      if (existing && !['CANCELLED', 'WITHDRAWN'].includes(existing.status))
        throw conflict('Bạn đã đăng ký hoặc đang trong danh sách chờ của hoạt động này.')
      const [held] = await tx<
        { n: number; waiting: number }[]
      >`SELECT count(*) FILTER (WHERE status IN ('REGISTERED','CANCEL_REQUESTED'))::integer AS n,count(*) FILTER (WHERE status='WAITLISTED')::integer AS waiting
        FROM activity_registrations WHERE activity_id=${activityId}`
      // Free seats go to the queue first; a newcomer gets a seat only when nobody is waiting.
      const status: RegistrationStatus =
        held!.waiting === 0 && (a.capacity === null || held!.n < a.capacity)
          ? 'REGISTERED'
          : 'WAITLISTED'
      const [snapshot] = await tx<{ value: Record<string, unknown> }[]>`
        SELECT jsonb_build_object('classId',c.id,'facultyId',c.faculty_id,'cohortYear',sp.cohort_year,'studentCode',sp.student_code,
          'eligibility',a.eligibility,'activityRevision',a.revision) AS value
        FROM student_profiles sp JOIN academic_classes c ON c.id=sp.class_id JOIN activities a ON a.id=${activityId} WHERE sp.user_id=${actor.userId}`
      let id: string
      if (existing) {
        await tx`UPDATE activity_registrations SET status=${status},queued_at=clock_timestamp(),snapshot=${tx.json(snapshot!.value as never)},
          cancel_reason=NULL,cancel_requested_at=NULL,decided_by_user_id=NULL,decided_at=NULL,decision_note=NULL,auto_accepted=false,excused=false,
          promoted_at=NULL,promotion_seen_at=NULL,revision=revision+1,updated_at=clock_timestamp() WHERE id=${existing.id}`
        id = existing.id
      } else {
        const [row] = await tx<{ id: string }[]>`
          INSERT INTO activity_registrations(activity_id,student_user_id,status,snapshot) VALUES(${activityId},${actor.userId},${status},${tx.json(snapshot!.value as never)}) RETURNING id`
        id = row!.id
      }
      await this.event(tx, id, activityId, status, existing?.status ?? null, status, actor.userId)
      return this.view(tx, actor.userId, activityId)
    })
  }

  async requestCancel(actor: SubmissionActor, activityId: string, reason: string) {
    return this.db.begin(async (tx) => {
      const a = await this.lockActivity(tx, activityId)
      const r = await this.mine(tx, actor.userId, activityId)
      if (!r) throw missing()
      if (r.status !== 'REGISTERED') throw conflict()
      if (Date.now() > a.startsMs - cancelNoticeMs)
        throw fail(
          409,
          'ACTIVITY_CANCEL_TOO_LATE',
          'Chỉ gửi yêu cầu hủy trước giờ bắt đầu ít nhất 24 giờ.',
        )
      await tx`UPDATE activity_registrations SET status='CANCEL_REQUESTED',cancel_reason=${reason},cancel_requested_at=clock_timestamp(),
        revision=revision+1,updated_at=clock_timestamp() WHERE id=${r.id}`
      await this.event(
        tx,
        r.id,
        activityId,
        'CANCEL_REQUESTED',
        r.status,
        'CANCEL_REQUESTED',
        actor.userId,
        reason,
      )
      return this.view(tx, actor.userId, activityId)
    })
  }

  /** A waitlisted student leaves at once: it holds no seat (ADR 0031 assumption). */
  async withdraw(actor: SubmissionActor, activityId: string) {
    return this.db.begin(async (tx) => {
      await this.lockActivity(tx, activityId)
      const r = await this.mine(tx, actor.userId, activityId)
      if (!r) throw missing()
      if (r.status !== 'WAITLISTED') throw conflict()
      await tx`UPDATE activity_registrations SET status='WITHDRAWN',revision=revision+1,updated_at=clock_timestamp() WHERE id=${r.id}`
      await this.event(tx, r.id, activityId, 'WITHDRAWN', r.status, 'WITHDRAWN', actor.userId)
      return this.view(tx, actor.userId, activityId)
    })
  }

  async acknowledgePromotion(user: string, activityId: string) {
    return this.db.begin(async (tx) => {
      await tx`UPDATE activity_registrations SET promotion_seen_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp()
        WHERE activity_id=${activityId} AND student_user_id=${user} AND promoted_at IS NOT NULL AND promotion_seen_at IS NULL`
      return this.view(tx, user, activityId)
    })
  }

  /** The student's own registrations, newest activity first, with the derived absence state. */
  async history(user: string) {
    return this.db.begin('isolation level repeatable read, read only', async (tx) => {
      const rows = await tx<
        (StudentRegistrationView & {
          activityId: string
          title: string
          kind: Activity['kind']
          startsAt: string
          endsAt: string
          activityStatus: Activity['status']
          absent: boolean
          excused: boolean
        })[]
      >`SELECT a.id AS "activityId",a.title,a.kind,a.status AS "activityStatus",${tx.unsafe(iso('a.starts_at'))} AS "startsAt",${tx.unsafe(iso('a.ends_at'))} AS "endsAt",
          ${tx.unsafe(registrationView)},(a.ends_at<=clock_timestamp() AND r.status IN ('REGISTERED')) AS absent,
          (r.excused OR (r.status='CANCEL_REQUESTED' AND a.starts_at<=clock_timestamp())) AS excused
        FROM activity_registrations r JOIN activities a ON a.id=r.activity_id
        WHERE r.student_user_id=${user} ORDER BY a.starts_at DESC,a.id LIMIT 201`
      return { items: rows.slice(0, 200), truncated: rows.length > 200 }
    })
  }

  private async manager(tx: Tx, user: string, activityId: string) {
    const access = await this.activities.access(tx, user)
    const a = await this.activities.row(tx, activityId)
    if (!a || !this.activities.visible(access, a)) throw missing()
    const canDecide =
      this.activities.owns(access, a) ||
      (!!a.delegatedClub && access.leaderClubs.includes(a.delegatedClub.id))
    return { a, canDecide }
  }

  async roster(user: string, activityId: string) {
    return this.db.begin('isolation level repeatable read, read only', async (tx) => {
      const { a, canDecide } = await this.manager(tx, user, activityId)
      const items = await tx<RosterEntry[]>`
        SELECT r.id,r.student_user_id AS "studentUserId",sp.student_code AS "studentCode",u.full_name AS "fullName",c.code AS "classCode",
          CASE WHEN r.status='CANCEL_REQUESTED' AND a.starts_at<=clock_timestamp() THEN 'CANCELLED' ELSE r.status END AS status,
          (a.ends_at<=clock_timestamp() AND r.status='REGISTERED') AS absent,
          ${tx.unsafe(iso('r.queued_at'))} AS "queuedAt",
          CASE WHEN r.status='WAITLISTED' THEN (SELECT count(*)::integer+1 FROM activity_registrations x WHERE x.activity_id=r.activity_id AND x.status='WAITLISTED' AND (x.queued_at,x.id)<(r.queued_at,r.id)) END AS "waitlistPosition",
          r.cancel_reason AS "cancelReason",CASE WHEN r.cancel_requested_at IS NULL THEN NULL ELSE ${tx.unsafe(iso('r.cancel_requested_at'))} END AS "cancelRequestedAt",
          r.decision_note AS "decisionNote",(r.auto_accepted OR (r.status='CANCEL_REQUESTED' AND a.starts_at<=clock_timestamp())) AS "autoAccepted",
          (r.excused OR (r.status='CANCEL_REQUESTED' AND a.starts_at<=clock_timestamp())) AS excused,r.revision
        FROM activity_registrations r JOIN activities a ON a.id=r.activity_id JOIN users u ON u.id=r.student_user_id
        LEFT JOIN student_profiles sp ON sp.user_id=r.student_user_id LEFT JOIN academic_classes c ON c.id=sp.class_id
        WHERE r.activity_id=${activityId}
        ORDER BY CASE r.status WHEN 'CANCEL_REQUESTED' THEN 0 WHEN 'REGISTERED' THEN 1 WHEN 'WAITLISTED' THEN 2 ELSE 3 END,r.queued_at,r.id LIMIT 5001`
      const count = (s: RegistrationStatus[]) => items.filter((i) => s.includes(i.status)).length
      return {
        activity: {
          id: a.id,
          title: a.title,
          capacity: a.capacity,
          startsAt: a.startsAt,
          endsAt: a.endsAt,
        },
        canDecide,
        summary: {
          seats: count(['REGISTERED', 'CANCEL_REQUESTED']),
          waitlisted: count(['WAITLISTED']),
          pendingCancellations: count(['CANCEL_REQUESTED']),
          cancelled: count(['CANCELLED']),
          absent: items.filter((i) => i.absent).length,
        },
        items: items.slice(0, 5000),
        truncated: items.length > 5000,
      }
    })
  }

  async decide(
    actor: SubmissionActor,
    activityId: string,
    registrationId: string,
    expectedRevision: number,
    accept: boolean,
    note: string | null,
  ) {
    return this.db
      .begin(async (tx) => {
        await this.activities.lockRights(tx)
        await this.lockActivity(tx, activityId)
        const { canDecide } = await this.manager(tx, actor.userId, activityId)
        if (!canDecide)
          throw fail(
            403,
            'ACTIVITY_FORBIDDEN',
            'Chỉ chủ hoạt động hoặc CLB được giao xử lý yêu cầu hủy.',
          )
        const [r] = await tx<RegistrationRow[]>`
        SELECT id,status,student_user_id AS "studentUserId",revision FROM activity_registrations WHERE id=${registrationId} AND activity_id=${activityId} FOR UPDATE`
        if (!r) throw missing()
        if (r.studentUserId === actor.userId)
          throw fail(
            403,
            'ACTIVITY_SELF_DECISION',
            'Không được tự xử lý yêu cầu hủy của chính mình.',
          )
        if (r.revision !== expectedRevision || r.status !== 'CANCEL_REQUESTED') throw conflict()
        if (!accept && !note)
          throw fail(400, 'INVALID_ACTIVITY', 'Từ chối yêu cầu hủy phải ghi lý do.')
        const to: RegistrationStatus = accept ? 'CANCELLED' : 'REGISTERED'
        await tx`UPDATE activity_registrations SET status=${to},excused=${accept},decided_by_user_id=${actor.userId},decided_at=clock_timestamp(),
        decision_note=${note},revision=revision+1,updated_at=clock_timestamp() WHERE id=${r.id}`
        await this.event(
          tx,
          r.id,
          activityId,
          accept ? 'CANCEL_ACCEPTED' : 'CANCEL_REJECTED',
          r.status,
          to,
          actor.userId,
          note,
        )
        if (accept) await tx`SELECT activity_promote(${activityId}::uuid)`
        await tx`INSERT INTO audit_logs(actor_type,actor_user_id,actor_username,action,resource_type,resource_id,outcome,request_id,ip_address,user_agent,metadata)
        SELECT 'USER',id,username,${accept ? 'activity.registration.cancel_accepted' : 'activity.registration.cancel_rejected'},'activity_registration',${r.id},'SUCCESS',
          ${actor.requestId},${actor.ipAddress},${actor.userAgent},${tx.json({ activityId, registrationId: r.id })}
        FROM users WHERE id=${actor.userId}`
      })
      .then(() => this.roster(actor.userId, activityId))
  }
}
