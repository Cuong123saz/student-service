import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import postgres from 'postgres'
import { buildApp } from '../../app.js'
import { env } from '../../config/env.js'
import { JWT_ISSUER, USER_JWT_AUDIENCE } from '../auth/auth.constants.js'
import { SubmissionError } from '../submissions/submission.types.js'
import { ClubRepository } from './club.repository.js'

const code = (e: unknown, expected: string, status?: number) =>
  e instanceof SubmissionError &&
  e.code === expected &&
  (status === undefined || e.statusCode === status)

test('ADR 0029 clubs run on an isolated synthetic database', async (t) => {
  const url = new URL(process.env.DATABASE_URL ?? 'http://invalid')
  assert.equal(url.port, '5434')
  assert.equal(url.pathname, '/student_service_test')
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname))
  const name = 'clubs_test_' + randomUUID().replaceAll('-', ''),
    control = postgres(url.href, { max: 1, onnotice: () => {} })
  let q: ReturnType<typeof postgres> | undefined
  try {
    await control.unsafe('CREATE DATABASE "' + name + '"')
    url.pathname = '/' + name
    q = postgres(url.href, { max: 8, onnotice: () => {} })
    const db = q
    const journal = JSON.parse(
      await readFile(new URL('../../../drizzle/meta/_journal.json', import.meta.url), 'utf8'),
    ) as { entries: { tag: string }[] }
    for (const entry of journal.entries) {
      const migration = await readFile(
        new URL('../../../drizzle/' + entry.tag + '.sql', import.meta.url),
        'utf8',
      )
      await db.begin(async (tx) => {
        for (const s of migration.split('--> statement-breakpoint').filter((s) => s.trim()))
          await tx.unsafe(s)
      })
    }
    const ctsv = randomUUID(),
      pdt = randomUUID(),
      sysadmin = randomUUID(),
      leader = randomUUID(),
      student = randomUUID(),
      locked = randomUUID(),
      fac = randomUUID()
    for (const [id, username, status] of [
      [ctsv, 'c-ctsv', 'ACTIVE'],
      [pdt, 'c-pdt', 'ACTIVE'],
      [sysadmin, 'c-sysadmin', 'ACTIVE'],
      [leader, 'c-leader', 'ACTIVE'],
      [student, 'c-student', 'ACTIVE'],
      [locked, 'c-locked', 'LOCKED'],
    ] as const)
      await db`INSERT INTO users(id,username,full_name,status,must_change_password) VALUES(${id},${username},${'Người giả định ' + username},${status},false)`
    await db`INSERT INTO faculties(id,code,name) VALUES(${fac},'CLBF','Khoa thử nghiệm')`
    const [global] = await db<
      { id: string }[]
    >`SELECT id FROM authorization_scopes WHERE scope_type='GLOBAL'`
    const [facultyScope] = await db<
      { id: string }[]
    >`INSERT INTO authorization_scopes(scope_type,faculty_id) VALUES('FACULTY',${fac}) RETURNING id`
    const grant = async (user: string, role: string, scope: string) => {
      await db`INSERT INTO user_roles(user_id,role_id) SELECT ${user},id FROM roles WHERE code=${role} ON CONFLICT DO NOTHING`
      await db`INSERT INTO user_role_scopes(user_id,role_id,scope_id) SELECT ${user},id,${scope} FROM roles WHERE code=${role} ON CONFLICT DO NOTHING`
    }
    await db`INSERT INTO roles(code,name,is_system) VALUES('STUDENT','STUDENT',true) ON CONFLICT DO NOTHING`
    await grant(ctsv, 'STUDENT_AFFAIRS', global!.id)
    await grant(pdt, 'TRAINING_OFFICE', facultyScope!.id)
    await grant(sysadmin, 'SYSTEM_ADMIN', global!.id)
    await grant(student, 'STUDENT', global!.id)
    const repo = new ClubRepository(db)
    const actorOf = (userId: string) => ({
      userId,
      username: 'test',
      requestId: randomUUID(),
      ipAddress: '127.0.0.1',
      userAgent: 'test',
    })
    const create = (clubCode: string, actor = ctsv) =>
      repo.create(actorOf(actor), {
        code: clubCode,
        name: 'CLB ' + clubCode,
        description: 'Giả định',
      })

    await t.test('only CTSV creates clubs; SYSTEM_ADMIN and Phòng ĐT are refused', async () => {
      const club = await create('DOIMAU')
      assert.equal(club.status, 'ACTIVE')
      assert.equal(club.revision, 0)
      assert.equal(club.canManage, true)
      for (const actor of [sysadmin, pdt, leader, student])
        await assert.rejects(create('X' + actor.slice(0, 4).toUpperCase(), actor), (e) =>
          code(e, 'CLUB_FORBIDDEN', 403),
        )
      await assert.rejects(create('DOIMAU'), (e) => code(e, 'CLUB_CODE_TAKEN', 409))
      const [unit] = await db<
        { status: string }[]
      >`SELECT u.status FROM clubs c JOIN organizational_units u ON u.id=c.organizational_unit_id WHERE c.id=${club.id}`
      assert.equal(unit!.status, 'ACTIVE')
      const [audit] = await db<
        { n: number }[]
      >`SELECT count(*)::integer AS n FROM audit_logs WHERE action='club.created' AND resource_id=${club.id}`
      assert.equal(audit!.n, 1)
    })

    await t.test('Phòng ĐT and SYSTEM_ADMIN read; a plain student sees nothing', async () => {
      assert.equal((await repo.list(pdt)).canManage, false)
      assert.ok((await repo.list(pdt)).items.length >= 1)
      assert.ok((await repo.list(sysadmin)).items.length >= 1)
      await assert.rejects(repo.list(student), (e) => code(e, 'CLUB_FORBIDDEN', 403))
      const [club] = (await repo.list(ctsv)).items
      await assert.rejects(repo.detail(student, club!.id), (e) => code(e, 'CLUB_NOT_FOUND', 404))
    })

    await t.test('leader terms grant access to the own club only and end immediately', async () => {
      const club = await create('TINHNGUYEN'),
        other = await create('HOCTHUAT')
      await assert.rejects(repo.assignLeader(actorOf(ctsv), club.id, 'c-locked'), (e) =>
        code(e, 'INVALID_CLUB_LEADER', 400),
      )
      await assert.rejects(repo.assignLeader(actorOf(pdt), club.id, 'c-leader'), (e) =>
        code(e, 'CLUB_FORBIDDEN', 403),
      )
      const assigned = await repo.assignLeader(actorOf(ctsv), club.id, 'C-LEADER')
      assert.equal(assigned.activeLeaders, 1)
      await assert.rejects(repo.assignLeader(actorOf(ctsv), club.id, 'c-leader'), (e) =>
        code(e, 'CLUB_LEADER_EXISTS', 409),
      )
      // A second leader (vice chair) is allowed by ADR 0029.
      assert.equal((await repo.assignLeader(actorOf(ctsv), club.id, 'c-student')).activeLeaders, 2)
      const mine = await repo.list(leader)
      assert.deepEqual(
        mine.items.map((c) => c.code),
        ['TINHNGUYEN'],
      )
      assert.equal(mine.items[0]!.isLeader, true)
      assert.equal(mine.canManage, false)
      await assert.rejects(repo.detail(leader, other.id), (e) => code(e, 'CLUB_NOT_FOUND', 404))
      await assert.rejects(
        repo.update(actorOf(leader), club.id, {
          expectedRevision: 0,
          name: 'Đổi tên',
          description: '',
        }),
        (e) => code(e, 'CLUB_FORBIDDEN', 403),
      )
      const term = (await repo.detail(ctsv, club.id)).leaders.find((l) => l.userId === leader)!
      const ended = await repo.endLeader(actorOf(ctsv), club.id, term.id, 'Hết nhiệm kỳ')
      assert.equal(ended.activeLeaders, 1)
      assert.equal(ended.leaders.find((l) => l.id === term.id)!.endReason, 'Hết nhiệm kỳ')
      await assert.rejects(repo.list(leader), (e) => code(e, 'CLUB_FORBIDDEN', 403))
      await assert.rejects(repo.endLeader(actorOf(ctsv), club.id, term.id, 'Lần hai'), (e) =>
        code(e, 'CLUB_CONFLICT', 409),
      )
      // A new term after the old one ended is allowed.
      assert.equal((await repo.assignLeader(actorOf(ctsv), club.id, 'c-leader')).activeLeaders, 2)
    })

    await t.test('optimistic revision, lifecycle transitions and final dissolution', async () => {
      const club = await create('VANNGHE')
      const updated = await repo.update(actorOf(ctsv), club.id, {
        expectedRevision: 0,
        name: 'CLB Văn nghệ',
        description: 'Mô tả mới',
      })
      assert.equal(updated.revision, 1)
      assert.equal(updated.name, 'CLB Văn nghệ')
      await assert.rejects(
        repo.update(actorOf(ctsv), club.id, { expectedRevision: 0, name: 'Cũ', description: '' }),
        (e) => code(e, 'CLUB_CONFLICT', 409),
      )
      const suspended = await repo.changeStatus(actorOf(ctsv), club.id, {
        expectedRevision: 1,
        status: 'SUSPENDED',
        reason: 'Vi phạm quy định giả định',
      })
      assert.equal(suspended.status, 'SUSPENDED')
      assert.equal(suspended.statusReason, 'Vi phạm quy định giả định')
      await assert.rejects(
        repo.changeStatus(actorOf(ctsv), club.id, {
          expectedRevision: 2,
          status: 'SUSPENDED',
          reason: 'Lặp lại',
        }),
        (e) => code(e, 'CLUB_CONFLICT', 409),
      )
      await repo.changeStatus(actorOf(ctsv), club.id, {
        expectedRevision: 2,
        status: 'ACTIVE',
        reason: 'Đã khắc phục',
      })
      await repo.assignLeader(actorOf(ctsv), club.id, 'c-leader')
      const dissolved = await repo.changeStatus(actorOf(ctsv), club.id, {
        expectedRevision: 3,
        status: 'DISSOLVED',
        reason: 'Giải thể giả định',
      })
      assert.equal(dissolved.status, 'DISSOLVED')
      assert.ok(dissolved.dissolvedAt)
      assert.equal(dissolved.activeLeaders, 0)
      const [unit] = await db<
        { status: string }[]
      >`SELECT u.status FROM clubs c JOIN organizational_units u ON u.id=c.organizational_unit_id WHERE c.id=${club.id}`
      assert.equal(unit!.status, 'INACTIVE')
      for (const status of ['ACTIVE', 'SUSPENDED'] as const)
        await assert.rejects(
          repo.changeStatus(actorOf(ctsv), club.id, { expectedRevision: 4, status, reason: 'x' }),
          (e) => code(e, 'CLUB_CONFLICT', 409),
        )
      await assert.rejects(repo.assignLeader(actorOf(ctsv), club.id, 'c-student'), (e) =>
        code(e, 'CLUB_CONFLICT', 409),
      )
      // The database itself keeps a dissolved club final and never deletes club rows.
      await assert.rejects(
        db`UPDATE clubs SET status='ACTIVE',dissolved_at=NULL,revision=revision+1 WHERE id=${club.id}`,
        /CLUB_DISSOLVED/,
      )
      await assert.rejects(db`DELETE FROM clubs WHERE id=${club.id}`, /CLUB_IMMUTABLE/)
      const actions = await db<
        { action: string }[]
      >`SELECT action FROM audit_logs WHERE resource_id=${club.id} ORDER BY occurred_at,id`
      assert.deepEqual(
        actions.map((a) => a.action),
        [
          'club.created',
          'club.updated',
          'club.suspended',
          'club.resumed',
          'club.leader.assigned',
          'club.dissolved',
        ],
      )
    })

    await t.test('HTTP enforces session, origin, strict bodies and code format', async () => {
      const app = buildApp({ clubRepository: repo })
      await app.ready()
      const cookie = (user: string) =>
        'user_session=' +
        app.jwt.sign(
          {
            sub: user,
            username: 'test',
            roles: ['STUDENT_AFFAIRS'],
            portal: 'user',
            mustChangePassword: false,
            iss: JWT_ISSUER,
            aud: USER_JWT_AUDIENCE,
          },
          { expiresIn: '5m' },
        )
      let ip = 1
      const post = (
        payload: unknown,
        headers: Record<string, string>,
        path = '/api/v1/user/clubs',
      ) =>
        app.inject({
          method: 'POST',
          url: path,
          payload: payload as object,
          headers,
          remoteAddress: '127.0.2.' + ip++,
        })
      try {
        const ok = { code: 'bongda', name: '  CLB Bóng đá  ' }
        assert.equal((await post(ok, {})).statusCode, 401)
        assert.equal((await post(ok, { cookie: cookie(ctsv) })).statusCode, 403)
        assert.equal(
          (await post({ ...ok, extra: 1 }, { cookie: cookie(ctsv), origin: env.corsOrigin }))
            .statusCode,
          400,
        )
        assert.equal(
          (await post({ ...ok, code: 'a b' }, { cookie: cookie(ctsv), origin: env.corsOrigin }))
            .statusCode,
          400,
        )
        assert.equal(
          (await post(ok, { cookie: cookie(sysadmin), origin: env.corsOrigin })).statusCode,
          403,
        )
        const created = await post(ok, { cookie: cookie(ctsv), origin: env.corsOrigin })
        assert.equal(created.statusCode, 201)
        const body: { id: string; code: string; name: string } = created.json()
        assert.equal(body.code, 'BONGDA')
        assert.equal(body.name, 'CLB Bóng đá')
        const list = await app.inject({
          url: '/api/v1/user/clubs',
          headers: { cookie: cookie(pdt) },
        })
        assert.equal(list.statusCode, 200)
        assert.equal(list.headers['cache-control'], 'private, no-store')
        const status = await post(
          { expectedRevision: 0, status: 'SUSPENDED', reason: '' },
          { cookie: cookie(ctsv), origin: env.corsOrigin },
          '/api/v1/user/clubs/' + body.id + '/status',
        )
        assert.equal(status.statusCode, 400)
      } finally {
        await app.close()
      }
    })
  } finally {
    await q?.end()
    await control.unsafe('DROP DATABASE IF EXISTS "' + name + '" WITH (FORCE)')
    await control.end()
  }
})
