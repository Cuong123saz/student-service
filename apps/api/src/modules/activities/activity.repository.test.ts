import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import postgres from 'postgres'
import { buildApp } from '../../app.js'
import { env } from '../../config/env.js'
import { JWT_ISSUER, USER_JWT_AUDIENCE } from '../auth/auth.constants.js'
import { ClubRepository } from '../clubs/club.repository.js'
import { SubmissionError } from '../submissions/submission.types.js'
import { ActivityRepository } from './activity.repository.js'
import type { ActivityInput } from './activity.types.js'

const is = (expected: string, status?: number) => (e: unknown) =>
  e instanceof SubmissionError &&
  e.code === expected &&
  (status === undefined || e.statusCode === status)

test('ADR 0030 activities run on an isolated synthetic database', async (t) => {
  const url = new URL(process.env.DATABASE_URL ?? 'http://invalid')
  assert.equal(url.port, '5434')
  assert.equal(url.pathname, '/student_service_test')
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname))
  const name = 'activities_test_' + randomUUID().replaceAll('-', ''),
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
    const [ctsv, pdt, sysadmin, leader, s1, s2, fac1, fac2, classA, classB] = [
      randomUUID(),
      randomUUID(),
      randomUUID(),
      randomUUID(),
      randomUUID(),
      randomUUID(),
      randomUUID(),
      randomUUID(),
      randomUUID(),
      randomUUID(),
    ] as const
    for (const [id, username] of [
      [ctsv, 'a-ctsv'],
      [pdt, 'a-pdt'],
      [sysadmin, 'a-sysadmin'],
      [leader, 'a-leader'],
      [s1, 'a-s1'],
      [s2, 'a-s2'],
    ] as const)
      await db`INSERT INTO users(id,username,full_name,status,must_change_password) VALUES(${id},${username},${'Người giả định ' + username},'ACTIVE',false)`
    await db`INSERT INTO faculties(id,code,name) VALUES(${fac1},'AF1','Khoa 1'),(${fac2},'AF2','Khoa 2')`
    await db`INSERT INTO academic_classes(id,faculty_id,code,name) VALUES(${classA},${fac1},'AF1A','Lớp A'),(${classB},${fac2},'AF2B','Lớp B')`
    const [global] = await db<
      { id: string }[]
    >`SELECT id FROM authorization_scopes WHERE scope_type='GLOBAL'`
    const [fac1Scope] = await db<
      { id: string }[]
    >`INSERT INTO authorization_scopes(scope_type,faculty_id) VALUES('FACULTY',${fac1}) RETURNING id`
    await db`INSERT INTO roles(code,name,is_system) VALUES('STUDENT','STUDENT',true) ON CONFLICT DO NOTHING`
    const grant = async (user: string, role: string, scope: string) => {
      await db`INSERT INTO user_roles(user_id,role_id) SELECT ${user},id FROM roles WHERE code=${role} ON CONFLICT DO NOTHING`
      await db`INSERT INTO user_role_scopes(user_id,role_id,scope_id) SELECT ${user},id,${scope} FROM roles WHERE code=${role} ON CONFLICT DO NOTHING`
    }
    await grant(ctsv, 'STUDENT_AFFAIRS', global!.id)
    await grant(pdt, 'TRAINING_OFFICE', fac1Scope!.id)
    await grant(sysadmin, 'SYSTEM_ADMIN', global!.id)
    for (const s of [s1, s2, leader]) await grant(s, 'STUDENT', global!.id)
    await db`INSERT INTO student_profiles(user_id,class_id,student_code,cohort_year) VALUES(${s1},${classA},'A001',2021),(${s2},${classB},'A002',NULL),(${leader},${classA},'A003',2021)`
    const actorOf = (userId: string) => ({
      userId,
      username: 'test',
      requestId: randomUUID(),
      ipAddress: '127.0.0.1',
      userAgent: 'test',
    })
    const clubs = new ClubRepository(db),
      repo = new ActivityRepository(db)
    const club = await clubs.create(actorOf(ctsv), {
      code: 'DOIMAU',
      name: 'Đội Máu',
      description: '',
    })
    const otherClub = await clubs.create(actorOf(ctsv), {
      code: 'KHAC',
      name: 'CLB khác',
      description: '',
    })
    await clubs.assignLeader(actorOf(ctsv), club.id, 'a-leader')
    const hour = 3600000
    const input = (over: Partial<ActivityInput> = {}): ActivityInput => ({
      kind: 'MANDATORY',
      category: 'SCHOOL',
      title: 'Hoạt động giả định',
      description: '',
      location: 'Hội trường A',
      startsAt: new Date(Date.now() + 48 * hour).toISOString(),
      endsAt: new Date(Date.now() + 50 * hour).toISOString(),
      capacity: 100,
      eligibility: { facultyIds: [], classIds: [], cohortYears: [] },
      ...over,
    })
    const voluntary = (over: Partial<ActivityInput> = {}) =>
      input({ kind: 'VOLUNTARY', category: 'VOLUNTEER', clubId: club.id, ...over })

    await t.test('only CTSV and Phòng ĐT create mandatory activities, within scope', async () => {
      const a = await repo.create(actorOf(ctsv), input())
      assert.equal(a.ownerType, 'STUDENT_AFFAIRS')
      assert.equal(a.status, 'DRAFT')
      assert.equal(a.revision, 0)
      assert.equal(a.canPublish, true)
      for (const actor of [leader, sysadmin, s1])
        await assert.rejects(repo.create(actorOf(actor), input()), is('ACTIVITY_FORBIDDEN', 403))
      // Phòng ĐT scoped to faculty 1 must restrict the audience to its faculty.
      await assert.rejects(repo.create(actorOf(pdt), input()), is('INVALID_ACTIVITY', 400))
      await assert.rejects(
        repo.create(
          actorOf(pdt),
          input({ eligibility: { facultyIds: [fac2], classIds: [], cohortYears: [] } }),
        ),
        is('INVALID_ACTIVITY', 400),
      )
      const own = await repo.create(
        actorOf(pdt),
        input({ eligibility: { facultyIds: [fac1], classIds: [], cohortYears: [] } }),
      )
      assert.equal(own.ownerType, 'TRAINING_OFFICE')
      await assert.rejects(
        repo.create(actorOf(ctsv), input({ ownerType: 'TRAINING_OFFICE' })),
        is('ACTIVITY_FORBIDDEN', 403),
      )
      await assert.rejects(
        repo.create(actorOf(ctsv), input({ clubId: club.id })),
        is('INVALID_ACTIVITY', 400),
      )
    })

    await t.test('club leaders open voluntary activities only for their active club', async () => {
      const a = await repo.create(actorOf(leader), voluntary())
      assert.equal(a.ownerType, 'CLUB')
      assert.equal(a.ownerClub?.code, 'DOIMAU')
      await assert.rejects(
        repo.create(actorOf(leader), voluntary({ clubId: otherClub.id })),
        is('ACTIVITY_FORBIDDEN', 403),
      )
      await assert.rejects(repo.create(actorOf(ctsv), voluntary()), is('ACTIVITY_FORBIDDEN', 403))
      await assert.rejects(
        repo.create(actorOf(leader), voluntary({ ownerType: 'STUDENT_AFFAIRS' })),
        is('INVALID_ACTIVITY', 400),
      )
      const c = await clubs.detail(ctsv, club.id)
      await clubs.changeStatus(actorOf(ctsv), club.id, {
        expectedRevision: c.revision,
        status: 'SUSPENDED',
        reason: 'Tạm dừng giả định',
      })
      try {
        await assert.rejects(repo.create(actorOf(leader), voluntary()), is('CLUB_NOT_ACTIVE', 409))
        await assert.rejects(
          repo.transition(actorOf(leader), a.id, 'PUBLISHED', 0, null),
          is('ACTIVITY_CONFLICT', 409),
        )
        assert.equal((await repo.detail(leader, a.id)).canPublish, false)
      } finally {
        await clubs.changeStatus(actorOf(ctsv), club.id, {
          expectedRevision: c.revision + 1,
          status: 'ACTIVE',
          reason: 'Mở lại',
        })
      }
    })

    await t.test('server-side eligibility decides what students see', async () => {
      await assert.rejects(
        repo.create(
          actorOf(ctsv),
          input({ eligibility: { facultyIds: [fac1], classIds: [classB], cohortYears: [] } }),
        ),
        is('INVALID_ACTIVITY', 400),
      )
      await assert.rejects(
        repo.create(
          actorOf(ctsv),
          input({ eligibility: { facultyIds: [randomUUID()], classIds: [], cohortYears: [] } }),
        ),
        is('INVALID_ACTIVITY', 400),
      )
      await assert.rejects(
        repo.create(actorOf(ctsv), input({ endsAt: input().startsAt })),
        is('INVALID_ACTIVITY', 400),
      )
      const restricted = await repo.create(
        actorOf(ctsv),
        input({
          title: 'Chỉ K15',
          eligibility: { facultyIds: [], classIds: [], cohortYears: [2021] },
        }),
      )
      const open = await repo.create(actorOf(ctsv), input({ title: 'Mọi sinh viên' }))
      const titles = async (u: string) => (await repo.available(u)).items.map((a) => a.title).sort()
      assert.deepEqual(await titles(s1), [])
      await repo.transition(actorOf(ctsv), restricted.id, 'PUBLISHED', 0, null)
      await repo.transition(actorOf(ctsv), open.id, 'PUBLISHED', 0, null)
      assert.deepEqual(await titles(s1), ['Chỉ K15', 'Mọi sinh viên'])
      // A student without a cohort fails a cohort restriction.
      assert.deepEqual(await titles(s2), ['Mọi sinh viên'])
      assert.equal(
        'eligibility' in (await repo.available(s1)).items[0]!,
        false,
        'students do not receive the audience lists',
      )
      await assert.rejects(
        repo.transition(actorOf(ctsv), open.id, 'PUBLISHED', 1, null),
        is('ACTIVITY_CONFLICT', 409),
      )
    })

    await t.test('every edit is recorded with before/after values and a new revision', async () => {
      const a = await repo.create(actorOf(ctsv), input({ title: 'Trước' }))
      await repo.transition(actorOf(ctsv), a.id, 'PUBLISHED', 0, null)
      const { id: _id, ...rest } = await repo.detail(ctsv, a.id)
      void _id
      const edited = await repo.update(actorOf(ctsv), a.id, {
        expectedRevision: 1,
        category: rest.category,
        title: 'Sau',
        description: rest.description,
        location: rest.location,
        startsAt: rest.startsAt,
        endsAt: rest.endsAt,
        capacity: 50,
        eligibility: rest.eligibility,
      })
      assert.equal(edited.revision, 2)
      const event = edited.events[0]!
      assert.equal(event.action, 'UPDATED')
      assert.deepEqual(event.before, { title: 'Trước', capacity: 100 })
      assert.deepEqual(event.after, { title: 'Sau', capacity: 50 })
      await assert.rejects(
        repo.update(actorOf(ctsv), a.id, { ...rest, expectedRevision: 1 }),
        is('ACTIVITY_CONFLICT', 409),
      )
      // A club leader cannot see a CTSV activity that was not delegated to its club.
      await assert.rejects(repo.detail(leader, a.id), is('ACTIVITY_NOT_FOUND', 404))
      await assert.rejects(
        repo.update(actorOf(ctsv), a.id, {
          ...rest,
          expectedRevision: 2,
          startsAt: new Date(Date.now() - hour).toISOString(),
        }),
        is('INVALID_ACTIVITY', 400),
      )
      const [audit] = await db<
        { n: number }[]
      >`SELECT count(*)::integer AS n FROM audit_logs WHERE action='activity.updated' AND resource_id=${a.id}`
      assert.equal(audit!.n, 1)
    })

    await t.test('delegation lets a club see but not edit a mandatory activity', async () => {
      const a = await repo.create(actorOf(ctsv), input({ title: 'Giao CLB' }))
      await assert.rejects(repo.detail(leader, a.id), is('ACTIVITY_NOT_FOUND', 404))
      const delegated = await repo.delegate(actorOf(ctsv), a.id, 0, club.id, 'CLB thực hiện')
      assert.equal(delegated.delegatedClub?.id, club.id)
      const seen = await repo.detail(leader, a.id)
      assert.equal(seen.canEdit, false)
      assert.equal(seen.canDelegate, false)
      assert.ok((await repo.list(leader)).items.some((x) => x.id === a.id))
      await assert.rejects(
        repo.update(actorOf(leader), a.id, { ...seen, expectedRevision: 1 }),
        is('ACTIVITY_FORBIDDEN', 403),
      )
      await assert.rejects(
        repo.delegate(actorOf(ctsv), a.id, 1, club.id, null),
        is('ACTIVITY_CONFLICT', 409),
      )
      const revoked = await repo.delegate(actorOf(ctsv), a.id, 1, null, 'Rút lại')
      assert.equal(revoked.delegatedClub, null)
      assert.deepEqual(
        revoked.events.map((e) => e.action),
        ['DELEGATION_REVOKED', 'DELEGATED', 'CREATED'],
      )
      await assert.rejects(repo.detail(leader, a.id), is('ACTIVITY_NOT_FOUND', 404))
      const v = await repo.create(actorOf(leader), voluntary())
      await assert.rejects(
        repo.delegate(actorOf(leader), v.id, 0, otherClub.id, null),
        is('ACTIVITY_FORBIDDEN', 403),
      )
    })

    await t.test('CTSV suspends/resumes; cancellation is final and history immutable', async () => {
      const v = await repo.create(actorOf(leader), voluntary({ title: 'Tự nguyện' }))
      await repo.transition(actorOf(leader), v.id, 'PUBLISHED', 0, null)
      for (const actor of [leader, pdt, sysadmin])
        await assert.rejects(
          repo.transition(actorOf(actor), v.id, 'SUSPENDED', 1, 'Thử'),
          (e) => is('ACTIVITY_FORBIDDEN', 403)(e) || is('ACTIVITY_NOT_FOUND', 404)(e),
        )
      await assert.rejects(
        repo.transition(actorOf(ctsv), v.id, 'SUSPENDED', 1, null),
        is('INVALID_ACTIVITY', 400),
      )
      await repo.transition(actorOf(ctsv), v.id, 'SUSPENDED', 1, 'Nội dung chưa phù hợp')
      assert.ok(!(await repo.available(s1)).items.some((x) => x.id === v.id))
      await repo.transition(actorOf(ctsv), v.id, 'RESUMED', 2, 'Đã chỉnh')
      assert.ok((await repo.available(s1)).items.some((x) => x.id === v.id))
      const cancelled = await repo.transition(actorOf(leader), v.id, 'CANCELLED', 3, 'Thời tiết')
      assert.equal(cancelled.status, 'CANCELLED')
      assert.equal(cancelled.canEdit || cancelled.canCancel || cancelled.canSuspend, false)
      await assert.rejects(
        repo.transition(actorOf(leader), v.id, 'CANCELLED', 4, 'Lần hai'),
        is('ACTIVITY_CONFLICT', 409),
      )
      await assert.rejects(
        db`UPDATE activities SET title='x',revision=revision+1 WHERE id=${v.id}`,
        /ACTIVITY_CANCELLED/,
      )
      await assert.rejects(db`DELETE FROM activities WHERE id=${v.id}`, /ACTIVITY_IMMUTABLE/)
      await assert.rejects(
        db`UPDATE activity_events SET reason='x' WHERE activity_id=${v.id}`,
        /ACTIVITY_HISTORY_IMMUTABLE/,
      )
      const d = await repo.create(actorOf(ctsv), input())
      await assert.rejects(
        db`UPDATE activities SET status='SUSPENDED',revision=revision+1 WHERE id=${d.id}`,
        /ACTIVITY_INVALID/,
      )
    })

    await t.test('an activity can be published only before it starts', async () => {
      const past = await repo.create(
        actorOf(ctsv),
        input({
          startsAt: new Date(Date.now() - 2 * hour).toISOString(),
          endsAt: new Date(Date.now() - hour).toISOString(),
        }),
      )
      assert.equal(past.canPublish, false)
      await assert.rejects(
        repo.transition(actorOf(ctsv), past.id, 'PUBLISHED', 0, null),
        is('ACTIVITY_CONFLICT', 409),
      )
    })

    await t.test('HTTP: student view needs a student session; bodies are strict', async () => {
      const app = buildApp({ activityRepository: repo })
      await app.ready()
      const cookie = (user: string, roles: string[]) =>
        'user_session=' +
        app.jwt.sign(
          {
            sub: user,
            username: 'test',
            roles,
            portal: 'user',
            mustChangePassword: false,
            iss: JWT_ISSUER,
            aud: USER_JWT_AUDIENCE,
          },
          { expiresIn: '5m' },
        )
      let ip = 1
      const call = (
        method: 'GET' | 'POST',
        path: string,
        headers: Record<string, string>,
        payload?: object,
      ) =>
        app.inject({
          method,
          url: '/api/v1/user' + path,
          headers,
          remoteAddress: '127.0.3.' + ip++,
          ...(payload ? { payload } : {}),
        })
      try {
        assert.equal(
          (
            await call('GET', '/activities/available', {
              cookie: cookie(ctsv, ['STUDENT_AFFAIRS']),
            })
          ).statusCode,
          403,
        )
        const seen = await call('GET', '/activities/available', { cookie: cookie(s1, ['STUDENT']) })
        assert.equal(seen.statusCode, 200)
        assert.equal(seen.headers['cache-control'], 'private, no-store')
        const body = {
          ...input(),
          eligibility: { facultyIds: [], classIds: [], cohortYears: [], unitIds: [] },
        }
        const headers = { cookie: cookie(ctsv, ['STUDENT_AFFAIRS']), origin: env.corsOrigin }
        assert.equal((await call('POST', '/activities', headers, body)).statusCode, 400)
        assert.equal(
          (await call('POST', '/activities', headers, { ...input(), kind: 'OTHER' })).statusCode,
          400,
        )
        const created = await call('POST', '/activities', headers, input())
        assert.equal(created.statusCode, 201)
        const { id }: { id: string } = created.json()
        assert.equal(
          (await call('POST', '/activities/' + id + '/cancel', headers, { expectedRevision: 0 }))
            .statusCode,
          400,
        )
        assert.equal(
          (
            await call(
              'POST',
              '/activities/' + id + '/publish',
              { cookie: headers.cookie },
              { expectedRevision: 0 },
            )
          ).statusCode,
          403,
        )
        const options = await call('GET', '/activities/manage/options', { cookie: headers.cookie })
        assert.equal(options.statusCode, 200)
        const o: { mandatoryOwners: string[]; delegationClubs: unknown[] } = options.json()
        assert.deepEqual(o.mandatoryOwners, ['STUDENT_AFFAIRS'])
        assert.equal(o.delegationClubs.length, 2)
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
