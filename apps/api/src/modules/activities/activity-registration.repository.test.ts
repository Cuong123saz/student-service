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
import { ActivityRegistrationRepository } from './activity-registration.repository.js'
import { ActivityRepository } from './activity.repository.js'
import type { ActivityInput } from './activity.types.js'

const is = (expected: string, status?: number) => (e: unknown) =>
  e instanceof SubmissionError &&
  e.code === expected &&
  (status === undefined || e.statusCode === status)

test('ADR 0031 registrations run on an isolated synthetic database', async (t) => {
  const url = new URL(process.env.DATABASE_URL ?? 'http://invalid')
  assert.equal(url.port, '5434')
  assert.equal(url.pathname, '/student_service_test')
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname))
  const name = 'registrations_test_' + randomUUID().replaceAll('-', ''),
    control = postgres(url.href, { max: 1, onnotice: () => {} })
  let q: ReturnType<typeof postgres> | undefined
  try {
    await control.unsafe('CREATE DATABASE "' + name + '"')
    url.pathname = '/' + name
    q = postgres(url.href, { max: 16, onnotice: () => {} })
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
      leader = randomUUID(),
      outsider = randomUUID(),
      fac = randomUUID(),
      other = randomUUID(),
      clazz = randomUUID(),
      otherClass = randomUUID()
    await db`INSERT INTO faculties(id,code,name) VALUES(${fac},'RF1','Khoa 1'),(${other},'RF2','Khoa 2')`
    await db`INSERT INTO academic_classes(id,faculty_id,code,name) VALUES(${clazz},${fac},'RF1A','Lớp A'),(${otherClass},${other},'RF2A','Lớp B')`
    const [global] = await db<
      { id: string }[]
    >`SELECT id FROM authorization_scopes WHERE scope_type='GLOBAL'`
    await db`INSERT INTO roles(code,name,is_system) VALUES('STUDENT','STUDENT',true) ON CONFLICT DO NOTHING`
    const user = async (id: string, username: string, role: string, classId?: string) => {
      await db`INSERT INTO users(id,username,full_name,status,must_change_password) VALUES(${id},${username},${'Người giả định ' + username},'ACTIVE',false)`
      await db`INSERT INTO user_roles(user_id,role_id) SELECT ${id},id FROM roles WHERE code=${role}`
      await db`INSERT INTO user_role_scopes(user_id,role_id,scope_id) SELECT ${id},id,${global!.id} FROM roles WHERE code=${role}`
      if (classId)
        await db`INSERT INTO student_profiles(user_id,class_id,student_code,cohort_year) VALUES(${id},${classId},${username},2021)`
    }
    await user(ctsv, 'r-ctsv', 'STUDENT_AFFAIRS')
    await user(leader, 'r-leader', 'STUDENT', clazz)
    await user(outsider, 'r-outsider', 'STUDENT', otherClass)
    const students: string[] = []
    for (let i = 0; i < 12; i++) {
      const id = randomUUID()
      await user(id, 'r-s' + i, 'STUDENT', clazz)
      students.push(id)
    }
    const s = (i: number) => students[i]!
    const actorOf = (userId: string) => ({
      userId,
      username: 'test',
      requestId: randomUUID(),
      ipAddress: '127.0.0.1',
      userAgent: 'test',
    })
    const clubs = new ClubRepository(db),
      activities = new ActivityRepository(db),
      repo = new ActivityRegistrationRepository(db)
    const club = await clubs.create(actorOf(ctsv), { code: 'RCLB', name: 'CLB', description: '' })
    await clubs.assignLeader(actorOf(ctsv), club.id, 'r-leader')
    const hour = 3600000
    const input = (over: Partial<ActivityInput> = {}): ActivityInput => ({
      kind: 'MANDATORY',
      category: 'SCHOOL',
      title: 'Hoạt động đăng ký giả định',
      description: '',
      location: 'Hội trường',
      startsAt: new Date(Date.now() + 48 * hour).toISOString(),
      endsAt: new Date(Date.now() + 50 * hour).toISOString(),
      capacity: 2,
      eligibility: { facultyIds: [fac], classIds: [], cohortYears: [] },
      ...over,
    })
    const published = async (over: Partial<ActivityInput> = {}, owner = ctsv) => {
      const a = await activities.create(actorOf(owner), input(over))
      await activities.transition(actorOf(owner), a.id, 'PUBLISHED', 0, null)
      return a.id
    }
    const status = async (activity: string, student: string) =>
      (
        await db<
          { status: string }[]
        >`SELECT status FROM activity_registrations WHERE activity_id=${activity} AND student_user_id=${student}`
      )[0]?.status

    await t.test(
      'seats first, then an ordered waitlist; audience and duplicates enforced',
      async () => {
        const a = await published()
        assert.equal((await repo.register(actorOf(s(0)), a)).myStatus, 'REGISTERED')
        assert.equal((await repo.register(actorOf(s(1)), a)).myStatus, 'REGISTERED')
        const third = await repo.register(actorOf(s(2)), a)
        assert.equal(third.myStatus, 'WAITLISTED')
        assert.equal(third.waitlistPosition, 1)
        assert.equal(third.seatsTaken, 2)
        assert.equal((await repo.register(actorOf(s(3)), a)).waitlistPosition, 2)
        await assert.rejects(
          repo.register(actorOf(s(0)), a),
          is('ACTIVITY_REGISTRATION_CONFLICT', 409),
        )
        await assert.rejects(repo.register(actorOf(outsider), a), is('ACTIVITY_NOT_FOUND', 404))
        await assert.rejects(repo.register(actorOf(ctsv), a), is('ACTIVITY_NOT_FOUND', 404))
        const draft = await activities.create(actorOf(ctsv), input())
        await assert.rejects(repo.register(actorOf(s(0)), draft.id), is('ACTIVITY_NOT_FOUND', 404))
        const [snap] = await db<
          { snapshot: { classId: string; eligibility: { facultyIds: string[] } } }[]
        >`SELECT snapshot FROM activity_registrations WHERE activity_id=${a} AND student_user_id=${s(0)}`
        assert.equal(snap!.snapshot.classId, clazz)
        assert.deepEqual(snap!.snapshot.eligibility.facultyIds, [fac])
      },
    )

    await t.test('concurrent registrations never exceed the capacity', async () => {
      const a = await published({ capacity: 3 })
      const results = await Promise.allSettled(
        students.slice(0, 10).map((id) => repo.register(actorOf(id), a)),
      )
      assert.ok(results.every((r) => r.status === 'fulfilled'))
      const [counts] = await db<
        { seats: number; waiting: number }[]
      >`SELECT count(*) FILTER (WHERE status='REGISTERED')::integer AS seats,count(*) FILTER (WHERE status='WAITLISTED')::integer AS waiting FROM activity_registrations WHERE activity_id=${a}`
      assert.deepEqual(counts, { seats: 3, waiting: 7 })
      const positions = await db<
        { n: number }[]
      >`SELECT count(DISTINCT queued_at)::integer AS n FROM activity_registrations WHERE activity_id=${a} AND status='WAITLISTED'`
      assert.equal(positions[0]!.n, 7, 'queue order is unambiguous')
    })

    await t.test('accepted cancellation frees the seat for the head of the queue', async () => {
      const a = await published()
      for (const i of [0, 1, 2, 3]) await repo.register(actorOf(s(i)), a)
      const requested = await repo.requestCancel(actorOf(s(0)), a, 'Trùng lịch thi')
      assert.equal(requested.myStatus, 'CANCEL_REQUESTED')
      assert.equal(requested.seatsTaken, 2, 'a pending request still holds the seat')
      await assert.rejects(
        repo.requestCancel(actorOf(s(2)), a, 'x'),
        is('ACTIVITY_REGISTRATION_CONFLICT', 409),
      )
      const roster = await repo.roster(ctsv, a)
      assert.equal(roster.canDecide, true)
      assert.equal(roster.summary.pendingCancellations, 1)
      const entry = roster.items.find((i) => i.studentUserId === s(0))!
      assert.equal(entry.cancelReason, 'Trùng lịch thi')
      await assert.rejects(
        repo.decide(actorOf(ctsv), a, entry.id, entry.revision, false, null),
        is('INVALID_ACTIVITY', 400),
      )
      await assert.rejects(
        repo.decide(actorOf(s(5)), a, entry.id, entry.revision, true, null),
        is('ACTIVITY_NOT_FOUND', 404),
      )
      const after = await repo.decide(actorOf(ctsv), a, entry.id, entry.revision, true, 'Đồng ý')
      assert.equal(after.items.find((i) => i.studentUserId === s(0))!.excused, true)
      assert.equal(await status(a, s(2)), 'REGISTERED', 'head of the queue promoted')
      assert.equal(await status(a, s(3)), 'WAITLISTED')
      const mine = (await activities.available(s(2))).items.find((x) => x.id === a)!
      assert.equal(mine.promotionNotice, true)
      assert.equal((await repo.acknowledgePromotion(s(2), a)).promotionNotice, false)
      await assert.rejects(
        repo.decide(actorOf(ctsv), a, entry.id, entry.revision, true, null),
        is('ACTIVITY_REGISTRATION_CONFLICT', 409),
      )
      const events = await db<
        { action: string }[]
      >`SELECT action FROM activity_registration_events WHERE activity_id=${a} AND registration_id=${entry.id} ORDER BY created_at`
      assert.deepEqual(
        events.map((e) => e.action),
        ['REGISTERED', 'CANCEL_REQUESTED', 'CANCEL_ACCEPTED'],
      )
      // Rejection keeps the seat and needs a reason.
      const r1 = (await repo.requestCancel(actorOf(s(1)), a, 'Ốm')) && (await repo.roster(ctsv, a))
      const e1 = r1.items.find((i) => i.studentUserId === s(1))!
      await repo.decide(actorOf(ctsv), a, e1.id, e1.revision, false, 'Hoạt động bắt buộc')
      assert.equal(await status(a, s(1)), 'REGISTERED')
    })

    await t.test(
      'cancellation needs 24 hours notice; overdue requests are auto-accepted',
      async () => {
        const soon = await published({
          startsAt: new Date(Date.now() + 10 * hour).toISOString(),
          endsAt: new Date(Date.now() + 12 * hour).toISOString(),
        })
        await repo.register(actorOf(s(0)), soon)
        await assert.rejects(
          repo.requestCancel(actorOf(s(0)), soon, 'Muộn'),
          is('ACTIVITY_CANCEL_TOO_LATE', 409),
        )
        const a = await published()
        await repo.register(actorOf(s(1)), a)
        await repo.requestCancel(actorOf(s(1)), a, 'Có việc gia đình')
        // The start passes while the request is still pending.
        await db`UPDATE activities SET starts_at=now()-interval '1 minute',ends_at=now()+interval '1 hour',revision=revision+1 WHERE id=${a}`
        const roster = await repo.roster(ctsv, a)
        const entry = roster.items.find((i) => i.studentUserId === s(1))!
        assert.equal(entry.status, 'CANCELLED')
        assert.equal(entry.autoAccepted, true)
        assert.equal(entry.excused, true)
        await assert.rejects(
          repo.decide(actorOf(ctsv), a, entry.id, entry.revision, false, 'Muộn'),
          is('ACTIVITY_REGISTRATION_CONFLICT', 409),
        )
        // A failed write rolls its settlement back; the next successful settle persists it.
        const [settled] = await db<{ n: number }[]>`SELECT activity_settle(${a}::uuid) AS n`
        assert.equal(settled!.n, 1)
        const [row] = await db<
          { status: string; auto_accepted: boolean }[]
        >`SELECT status,auto_accepted FROM activity_registrations WHERE id=${entry.id}`
        assert.deepEqual({ ...row }, { status: 'CANCELLED', auto_accepted: true })
        await assert.rejects(
          repo.register(actorOf(s(2)), a),
          is('ACTIVITY_REGISTRATION_CONFLICT', 409),
        )
      },
    )

    await t.test('no one decides their own request; delegated clubs may decide', async () => {
      const own = await published(
        { kind: 'VOLUNTARY', category: 'VOLUNTEER', clubId: club.id },
        leader,
      )
      await repo.register(actorOf(leader), own)
      await repo.requestCancel(actorOf(leader), own, 'Tự hủy')
      const entry = (await repo.roster(leader, own)).items[0]!
      await assert.rejects(
        repo.decide(actorOf(leader), own, entry.id, entry.revision, true, null),
        is('ACTIVITY_SELF_DECISION', 403),
      )
      const delegated = await published()
      await activities.delegate(actorOf(ctsv), delegated, 1, club.id, null)
      await repo.register(actorOf(s(4)), delegated)
      await repo.requestCancel(actorOf(s(4)), delegated, 'Lý do')
      const e = (await repo.roster(leader, delegated)).items[0]!
      const done = await repo.decide(actorOf(leader), delegated, e.id, e.revision, true, null)
      assert.equal(done.items[0]!.status, 'CANCELLED')
    })

    await t.test('waitlist withdrawal, re-registration and capacity changes', async () => {
      const a = await published({ capacity: 1 })
      await repo.register(actorOf(s(0)), a)
      await repo.register(actorOf(s(1)), a)
      await repo.register(actorOf(s(2)), a)
      assert.equal((await repo.withdraw(actorOf(s(1)), a)).myStatus, 'WITHDRAWN')
      await assert.rejects(
        repo.withdraw(actorOf(s(0)), a),
        is('ACTIVITY_REGISTRATION_CONFLICT', 409),
      )
      const again = await repo.register(actorOf(s(1)), a)
      assert.equal(again.myStatus, 'WAITLISTED')
      assert.equal(again.waitlistPosition, 2, 're-registration joins the end of the queue')
      const d = await activities.detail(ctsv, a)
      const edit = {
        expectedRevision: d.revision,
        category: d.category,
        title: d.title,
        description: d.description,
        location: d.location,
        startsAt: d.startsAt,
        endsAt: d.endsAt,
        eligibility: d.eligibility,
      }
      await activities.update(actorOf(ctsv), a, { ...edit, capacity: 2 })
      assert.equal(await status(a, s(2)), 'REGISTERED', 'more seats promote the queue')
      assert.equal(await status(a, s(1)), 'WAITLISTED')
      await assert.rejects(
        activities.update(actorOf(ctsv), a, {
          ...edit,
          expectedRevision: d.revision + 1,
          capacity: 1,
        }),
        is('INVALID_ACTIVITY', 400),
      )
      await activities.update(actorOf(ctsv), a, {
        ...edit,
        expectedRevision: d.revision + 1,
        capacity: null,
      })
      assert.equal(await status(a, s(1)), 'REGISTERED')
      const history = await repo.history(s(1))
      assert.ok(history.items.some((h) => h.activityId === a && h.myStatus === 'REGISTERED'))
    })

    await t.test('the database itself refuses overbooking and late registration', async () => {
      const a = await published({ capacity: 1 })
      await repo.register(actorOf(s(0)), a)
      await assert.rejects(
        db`INSERT INTO activity_registrations(activity_id,student_user_id,status,snapshot) VALUES(${a},${s(5)},'REGISTERED','{}'::jsonb)`,
        /ACTIVITY_REGISTRATION_FULL/,
      )
      await db`UPDATE activities SET starts_at=now()-interval '1 minute',revision=revision+1 WHERE id=${a}`
      await assert.rejects(
        db`INSERT INTO activity_registrations(activity_id,student_user_id,status,snapshot) VALUES(${a},${s(6)},'WAITLISTED','{}'::jsonb)`,
        /ACTIVITY_REGISTRATION_CLOSED/,
      )
      await assert.rejects(
        db`DELETE FROM activity_registrations WHERE activity_id=${a}`,
        /ACTIVITY_REGISTRATION_IMMUTABLE/,
      )
      await assert.rejects(
        db`UPDATE activity_registration_events SET reason='x' WHERE activity_id=${a}`,
        /ACTIVITY_HISTORY_IMMUTABLE/,
      )
    })

    await t.test('HTTP: registration needs a student session and the portal origin', async () => {
      const a = await published({ capacity: null })
      const app = buildApp({ activityRepository: activities, registrationRepository: repo })
      await app.ready()
      const cookie = (sub: string, roles: string[]) =>
        'user_session=' +
        app.jwt.sign(
          {
            sub,
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
      const post = (path: string, headers: Record<string, string>, payload?: object) =>
        app.inject({
          method: 'POST',
          url: '/api/v1/user/activities/' + a + path,
          headers,
          remoteAddress: '127.0.4.' + ip++,
          ...(payload ? { payload } : {}),
        })
      try {
        const student = cookie(s(7), ['STUDENT'])
        assert.equal((await post('/registration', { cookie: student })).statusCode, 403)
        assert.equal(
          (
            await post('/registration', {
              cookie: cookie(ctsv, ['STUDENT_AFFAIRS']),
              origin: env.corsOrigin,
            })
          ).statusCode,
          403,
        )
        assert.equal(
          (await post('/registration', { cookie: student, origin: env.corsOrigin }, { extra: 1 }))
            .statusCode,
          400,
        )
        const ok = await post('/registration', { cookie: student, origin: env.corsOrigin })
        assert.equal(ok.statusCode, 200)
        const body: { myStatus: string } = ok.json()
        assert.equal(body.myStatus, 'REGISTERED')
        assert.equal(
          (
            await post(
              '/registration/cancel-request',
              { cookie: student, origin: env.corsOrigin },
              { reason: '' },
            )
          ).statusCode,
          400,
        )
        const list = await app.inject({
          url: '/api/v1/user/activities/registrations',
          headers: { cookie: student },
        })
        assert.equal(list.statusCode, 200)
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
