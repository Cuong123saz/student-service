import type { Sql, TransactionSql } from 'postgres'
import { databaseClient } from '../../db/client.js'
import { SubmissionError, type SubmissionActor } from '../submissions/submission.types.js'
import {
  clubStatusAuditActions,
  clubTransitions,
  type ClubDetail,
  type ClubInput,
  type ClubLeader,
  type ClubList,
  type ClubStatusInput,
  type ClubSummary,
  type ClubUpdateInput,
} from './club.types.js'

type Tx = TransactionSql
const fail = (n: number, code: string, msg: string) => new SubmissionError(n, code, msg)
const forbidden = () =>
  fail(403, 'CLUB_FORBIDDEN', 'Tài khoản không có quyền quản lý CLB trong phạm vi này.')
const missing = () => fail(404, 'CLUB_NOT_FOUND', 'Không tìm thấy CLB trong phạm vi của bạn.')
const conflict = () =>
  fail(409, 'CLUB_CONFLICT', 'CLB đã thay đổi hoặc thao tác không còn phù hợp. Hãy tải lại.')
const iso = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`
const summaryColumns = `c.id,u.code,u.name,c.description,c.status,c.status_reason AS "statusReason",c.revision,
  (SELECT count(*)::integer FROM club_leader_assignments a WHERE a.club_id=c.id AND a.status='ACTIVE' AND (a.valid_to IS NULL OR a.valid_to>clock_timestamp())) AS "activeLeaders"`

/** ADR 0029: CTSV manages clubs; Phòng Đào tạo reads them; a leader sees its own clubs. */
export class ClubRepository {
  constructor(private readonly db: Sql = databaseClient) {}

  private async access(tx: Tx, user: string) {
    const [row] = await tx<
      { manage: boolean; read: boolean }[]
    >`SELECT club_staff_allowed(${user}::uuid,'club.manage') AS manage,club_staff_allowed(${user}::uuid,'club.read') AS read`
    return row ?? { manage: false, read: false }
  }
  private async manager(tx: Tx, user: string) {
    await tx`LOCK TABLE users,roles,user_roles,role_permissions,permissions,user_role_scopes,authorization_scopes IN SHARE MODE`
    if (!(await this.access(tx, user)).manage) throw forbidden()
  }
  private async locked(tx: Tx, id: string) {
    const [row] = await tx<
      {
        status: ClubSummary['status']
        revision: number
        unitId: string
        name: string
        description: string
      }[]
    >`SELECT c.status,c.revision,c.organizational_unit_id AS "unitId",u.name,c.description FROM clubs c JOIN organizational_units u ON u.id=c.organizational_unit_id WHERE c.id=${id} FOR UPDATE OF c`
    if (!row) throw missing()
    return row
  }
  private async audit(
    tx: Tx,
    actor: SubmissionActor,
    action: string,
    clubId: string,
    metadata: Record<string, unknown>,
  ) {
    await tx`INSERT INTO audit_logs(actor_type,actor_user_id,actor_username,action,resource_type,resource_id,outcome,request_id,ip_address,user_agent,metadata)
      SELECT 'USER',id,username,${action},'club',${clubId},'SUCCESS',${actor.requestId},${actor.ipAddress},${actor.userAgent},${tx.json({ clubId, ...metadata })}
      FROM users WHERE id=${actor.userId}`
  }

  async list(user: string): Promise<ClubList> {
    return this.db.begin('isolation level repeatable read, read only', async (tx) => {
      const access = await this.access(tx, user)
      const rows = await tx<(ClubSummary & { isLeader: boolean })[]>`
        SELECT ${tx.unsafe(summaryColumns)},club_is_leader(${user}::uuid,c.id) AS "isLeader"
        FROM clubs c JOIN organizational_units u ON u.id=c.organizational_unit_id
        WHERE ${access.read}::boolean OR club_is_leader(${user}::uuid,c.id)
        ORDER BY (c.status='DISSOLVED'),u.code,c.id LIMIT 501`
      if (!access.read && !rows.length) throw forbidden()
      return { canManage: access.manage, items: rows.slice(0, 500), truncated: rows.length > 500 }
    })
  }

  async detail(user: string, id: string, tx?: Tx): Promise<ClubDetail> {
    const run = async (q: Tx) => {
      const access = await this.access(q, user)
      const [club] = await q<
        (ClubSummary & { createdAt: string; dissolvedAt: string | null; isLeader: boolean })[]
      >`SELECT ${q.unsafe(summaryColumns)},club_is_leader(${user}::uuid,c.id) AS "isLeader",
          ${q.unsafe(iso('c.created_at'))} AS "createdAt",
          CASE WHEN c.dissolved_at IS NULL THEN NULL ELSE ${q.unsafe(iso('c.dissolved_at'))} END AS "dissolvedAt"
        FROM clubs c JOIN organizational_units u ON u.id=c.organizational_unit_id WHERE c.id=${id}`
      if (!club || (!access.read && !club.isLeader)) throw missing()
      const leaders = await q<ClubLeader[]>`
        SELECT a.id,a.leader_user_id AS "userId",lu.username,lu.full_name AS "fullName",
          ${q.unsafe(iso('a.valid_from'))} AS "validFrom",
          CASE WHEN a.valid_to IS NULL THEN NULL ELSE ${q.unsafe(iso('a.valid_to'))} END AS "validTo",
          CASE WHEN a.status='ACTIVE' AND (a.valid_to IS NULL OR a.valid_to>clock_timestamp()) THEN 'ACTIVE' ELSE 'INACTIVE' END AS status,
          a.end_reason AS "endReason"
        FROM club_leader_assignments a JOIN users lu ON lu.id=a.leader_user_id
        WHERE a.club_id=${id} ORDER BY (a.status='ACTIVE') DESC,a.valid_from DESC,a.id LIMIT 100`
      return { ...club, canManage: access.manage, leaders }
    }
    return tx ? run(tx) : this.db.begin('isolation level repeatable read, read only', run)
  }

  async create(actor: SubmissionActor, input: ClubInput) {
    return this.db.begin(async (tx) => {
      await this.manager(tx, actor.userId)
      const [taken] = await tx`SELECT 1 FROM organizational_units WHERE code=${input.code}`
      if (taken) throw fail(409, 'CLUB_CODE_TAKEN', 'Mã CLB đã được dùng cho một đơn vị khác.')
      const [unit] = await tx<
        { id: string }[]
      >`INSERT INTO organizational_units(code,name) VALUES(${input.code},${input.name}) RETURNING id`
      const [club] = await tx<
        { id: string }[]
      >`INSERT INTO clubs(organizational_unit_id,description,created_by_user_id) VALUES(${unit!.id},${input.description},${actor.userId}) RETURNING id`
      await this.audit(tx, actor, 'club.created', club!.id, {
        code: input.code,
        name: input.name,
      })
      return this.detail(actor.userId, club!.id, tx)
    })
  }

  async update(actor: SubmissionActor, id: string, input: ClubUpdateInput) {
    return this.db.begin(async (tx) => {
      await this.manager(tx, actor.userId)
      const club = await this.locked(tx, id)
      if (club.status === 'DISSOLVED' || club.revision !== input.expectedRevision) throw conflict()
      await tx`UPDATE organizational_units SET name=${input.name},updated_at=clock_timestamp() WHERE id=${club.unitId}`
      await tx`UPDATE clubs SET description=${input.description},revision=revision+1,updated_at=clock_timestamp() WHERE id=${id}`
      await this.audit(tx, actor, 'club.updated', id, {
        before: { name: club.name, description: club.description },
        after: { name: input.name, description: input.description },
      })
      return this.detail(actor.userId, id, tx)
    })
  }

  async changeStatus(actor: SubmissionActor, id: string, input: ClubStatusInput) {
    return this.db.begin(async (tx) => {
      await this.manager(tx, actor.userId)
      const club = await this.locked(tx, id)
      if (
        club.revision !== input.expectedRevision ||
        !clubTransitions[club.status].includes(input.status)
      )
        throw conflict()
      const dissolve = input.status === 'DISSOLVED'
      await tx`UPDATE clubs SET status=${input.status},status_reason=${input.reason},revision=revision+1,updated_at=clock_timestamp(),
        dissolved_at=CASE WHEN ${dissolve}::boolean THEN clock_timestamp() ELSE NULL END WHERE id=${id}`
      let endedLeaders = 0
      if (dissolve) {
        await tx`UPDATE organizational_units SET status='INACTIVE',updated_at=clock_timestamp() WHERE id=${club.unitId}`
        endedLeaders = (await this.endTerms(tx, actor, id, null, 'Giải thể CLB')).length
      }
      await this.audit(tx, actor, clubStatusAuditActions[input.status], id, {
        before: club.status,
        after: input.status,
        reason: input.reason,
        endedLeaders,
      })
      return this.detail(actor.userId, id, tx)
    })
  }

  private endTerms(
    tx: Tx,
    actor: SubmissionActor,
    clubId: string,
    assignmentId: string | null,
    reason: string,
  ) {
    return tx<{ id: string; userId: string }[]>`
      UPDATE club_leader_assignments SET status='INACTIVE',valid_to=GREATEST(valid_from+interval '1 millisecond',clock_timestamp()),
        ended_by_user_id=${actor.userId},end_reason=${reason},updated_at=clock_timestamp()
      WHERE club_id=${clubId} AND status='ACTIVE' AND (${assignmentId}::uuid IS NULL OR id=${assignmentId}::uuid)
      RETURNING id,leader_user_id AS "userId"`
  }

  async assignLeader(actor: SubmissionActor, id: string, username: string) {
    return this.db.begin(async (tx) => {
      await this.manager(tx, actor.userId)
      const club = await this.locked(tx, id)
      if (club.status === 'DISSOLVED') throw conflict()
      const [leader] = await tx<
        { id: string }[]
      >`SELECT id FROM users WHERE lower(username)=lower(${username}) AND status='ACTIVE'`
      if (!leader)
        throw fail(
          400,
          'INVALID_CLUB_LEADER',
          'Người phụ trách phải là tài khoản người dùng đang hoạt động.',
        )
      // Ended or expired terms are closed first so the partial unique index holds one live term.
      await tx`UPDATE club_leader_assignments SET status='INACTIVE',updated_at=clock_timestamp() WHERE club_id=${id} AND leader_user_id=${leader.id} AND status='ACTIVE' AND valid_to IS NOT NULL AND valid_to<=clock_timestamp()`
      const [exists] =
        await tx`SELECT 1 FROM club_leader_assignments WHERE club_id=${id} AND leader_user_id=${leader.id} AND status='ACTIVE'`
      if (exists)
        throw fail(409, 'CLUB_LEADER_EXISTS', 'Người này đang là người phụ trách của CLB.')
      const [term] = await tx<
        { id: string }[]
      >`INSERT INTO club_leader_assignments(club_id,leader_user_id,valid_from,assigned_by_user_id) VALUES(${id},${leader.id},clock_timestamp(),${actor.userId}) RETURNING id`
      await tx`INSERT INTO user_roles(user_id,role_id) SELECT ${leader.id},id FROM roles WHERE code='CLUB_LEADER' ON CONFLICT DO NOTHING`
      await this.audit(tx, actor, 'club.leader.assigned', id, {
        assignmentId: term!.id,
        leaderUserId: leader.id,
      })
      return this.detail(actor.userId, id, tx)
    })
  }

  async endLeader(actor: SubmissionActor, id: string, assignmentId: string, reason: string) {
    return this.db.begin(async (tx) => {
      await this.manager(tx, actor.userId)
      await this.locked(tx, id)
      const [ended] = await this.endTerms(tx, actor, id, assignmentId, reason)
      if (!ended) throw conflict()
      await this.audit(tx, actor, 'club.leader.ended', id, {
        assignmentId,
        leaderUserId: ended.userId,
        reason,
      })
      return this.detail(actor.userId, id, tx)
    })
  }
}
