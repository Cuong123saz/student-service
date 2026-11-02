import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import postgres from 'postgres'
import { ClubRepository } from '../clubs/club.repository.js'
import { SubmissionError } from '../submissions/submission.types.js'
import { TrainingPointRepository } from '../training-points/training-points.repository.js'
import { academyCriteria } from '../training-points/training-points.types.js'
import { ActivityAttendanceRepository } from './activity-attendance.repository.js'
import { staticCheckinCode } from './activity-checkin.js'
import { ActivityRegistrationRepository } from './activity-registration.repository.js'
import { ActivitySuggestionRepository } from './activity-suggestion.repository.js'
import { ActivityRepository } from './activity.repository.js'
import type { ActivityInput } from './activity.types.js'

const is = (expected: string, status?: number) => (e: unknown) =>
  e instanceof SubmissionError &&
  e.code === expected &&
  (status === undefined || e.statusCode === status)
const seg = (marker: number, body: Buffer) => {
  const head = Buffer.alloc(4)
  head[0] = 0xff
  head[1] = marker
  head.writeUInt16BE(body.length + 2, 2)
  return Buffer.concat([head, body])
}
const jpeg = Buffer.concat([
  Buffer.from([0xff, 0xd8]),
  seg(0xdb, Buffer.alloc(65, 1)),
  seg(0xda, Buffer.alloc(10, 2)),
  Buffer.from([1, 0xff, 0xd9]),
])

test('ADR 0033 suggestions run on an isolated synthetic database', async (t) => {
  const url = new URL(process.env.DATABASE_URL ?? 'http://invalid')
  assert.equal(url.port, '5434')
  assert.equal(url.pathname, '/student_service_test')
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname))
  const name = 'suggestions_test_' + randomUUID().replaceAll('-', ''),
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
    const admin = randomUUID(),
      ctsv = randomUUID(),
      leader = randomUUID(),
      advisor = randomUUID(),
      student = randomUUID(),
      other = randomUUID(),
      fac = randomUUID(),
      clazz = randomUUID()
    await db`INSERT INTO faculties(id,code,name) VALUES(${fac},'GF1','Khoa 1')`
    await db`INSERT INTO academic_classes(id,faculty_id,code,name) VALUES(${clazz},${fac},'GF1A','Lớp A')`
    const [global] = await db<
      { id: string }[]
    >`SELECT id FROM authorization_scopes WHERE scope_type='GLOBAL'`
    const [classScope] = await db<
      { id: string }[]
    >`INSERT INTO authorization_scopes(scope_type,class_id) VALUES('CLASS',${clazz}) RETURNING id`
    for (const role of ['SYSTEM_ADMIN', 'STUDENT', 'ACADEMIC_ADVISOR'])
      await db`INSERT INTO roles(code,name,is_system) VALUES(${role},${role},true) ON CONFLICT DO NOTHING`
    for (const [role, permission] of [
      ['SYSTEM_ADMIN', 'training_point.period.manage'],
      ['ACADEMIC_ADVISOR', 'training_point.review'],
    ])
      await db`INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.code=${role!} AND p.code=${permission!} ON CONFLICT DO NOTHING`
    const user = async (
      id: string,
      username: string,
      role: string,
      scope = global!.id,
      code?: string,
    ) => {
      await db`INSERT INTO users(id,username,full_name,status,must_change_password) VALUES(${id},${username},${'Người giả định ' + username},'ACTIVE',false) ON CONFLICT DO NOTHING`
      await db`INSERT INTO user_roles(user_id,role_id) SELECT ${id},id FROM roles WHERE code=${role} ON CONFLICT DO NOTHING`
      await db`INSERT INTO user_role_scopes(user_id,role_id,scope_id) SELECT ${id},id,${scope} FROM roles WHERE code=${role} ON CONFLICT DO NOTHING`
      if (code)
        await db`INSERT INTO student_profiles(user_id,class_id,student_code,cohort_year) VALUES(${id},${clazz},${code},2021)`
    }
    await user(admin, 'g-admin', 'SYSTEM_ADMIN')
    await user(ctsv, 'g-ctsv', 'STUDENT_AFFAIRS')
    await user(leader, 'g-leader', 'STUDENT', global!.id, 'G000')
    await user(advisor, 'g-advisor', 'ACADEMIC_ADVISOR', classScope!.id)
    await user(student, 'g-student', 'STUDENT', global!.id, 'G001')
    await user(other, 'g-other', 'STUDENT', global!.id, 'G002')
    await db`INSERT INTO academic_advisor_assignments(advisor_user_id,class_id,valid_from) VALUES(${advisor},${clazz},now()-interval '1 day')`
    const actorOf = (userId: string) => ({
      userId,
      username: 'test',
      requestId: randomUUID(),
      ipAddress: '127.0.0.1',
      userAgent: 'test',
    })
    const storage = {
      put: async () => randomUUID(),
      read: async () => jpeg,
      remove: async () => {},
    }
    const clubs = new ClubRepository(db),
      activities = new ActivityRepository(db),
      registrations = new ActivityRegistrationRepository(db),
      attendance = new ActivityAttendanceRepository(storage, db),
      repo = new ActivitySuggestionRepository(db),
      points = new TrainingPointRepository(db)
    const club = await clubs.create(actorOf(ctsv), { code: 'GCLB', name: 'CLB', description: '' })
    await clubs.assignLeader(actorOf(ctsv), club.id, 'g-leader')
    // HK1 2026-2027 covers 01/08/2026–31/01/2027 (Vietnam time), which contains "now" in this suite.
    const period = await points.createPeriod(admin, {
      classId: clazz,
      academicYear: '2026-2027',
      semester: '1',
      name: 'Đợt giả định',
      policyLabel: 'Giả định',
      startsAt: new Date(Date.now() - 60000).toISOString(),
      endsAt: new Date(Date.now() + 86400000).toISOString(),
      criteria: academyCriteria(),
    })
    await points.changePeriod(admin, period.id, period.revision, 'OPEN')
    const declaration = await points.start(student, period.id)
    const hour = 3600000
    const input = (over: Partial<ActivityInput> = {}): ActivityInput => ({
      kind: 'MANDATORY',
      category: 'SCHOOL',
      title: 'Bắt buộc',
      description: '',
      location: 'Hội trường',
      startsAt: new Date(Date.now() + 48 * hour).toISOString(),
      endsAt: new Date(Date.now() + 50 * hour).toISOString(),
      capacity: null,
      eligibility: { facultyIds: [fac], classIds: [], cohortYears: [] },
      ...over,
    })
    /** Publishes, registers `who`, runs the activity now and approves their attendance. */
    const held = async (
      over: Partial<ActivityInput>,
      who: string[],
      owner = ctsv,
      attend = who,
    ) => {
      const a = await activities.create(actorOf(owner), input(over))
      await activities.transition(actorOf(owner), a.id, 'PUBLISHED', 0, null)
      for (const id of who) await registrations.register(actorOf(id), a.id)
      await db`UPDATE activities SET starts_at=now()-interval '10 minutes',ends_at=now()+interval '1 hour',revision=revision+1 WHERE id=${a.id}`
      const [row] = await db<
        { secret: string }[]
      >`SELECT checkin_secret AS secret FROM activities WHERE id=${a.id}`
      for (const id of attend) {
        await attendance.scan(actorOf(id), a.id, staticCheckinCode(row!.secret))
        await attendance.submitPhoto(actorOf(id), a.id, jpeg)
      }
      const queue = await attendance.queue(owner, a.id)
      if (queue.items.length)
        await attendance.review(
          actorOf(owner),
          a.id,
          queue.items.map((i) => ({ id: i.id, revision: i.revision })),
          true,
          null,
        )
      await db`UPDATE activities SET ends_at=now()-interval '1 minute',revision=revision+1 WHERE id=${a.id}`
      return a.id
    }
    const lines = async () =>
      (await repo.forStudent(student, declaration.id)).lines.map((l) => [l.rule, l.group, l.points])

    await t.test(
      'defaults: no mandatory activity yet still gives +3 (owner decision)',
      async () => {
        assert.deepEqual(await lines(), [['SCHOOL_FULL', 'C', 3]])
        await assert.rejects(repo.forStudent(other, declaration.id), is('TRAINING_NOT_FOUND', 404))
      },
    )

    await t.test('mandatory attendance, voluntary school activities and missing ones', async () => {
      await held({ title: 'Sinh hoạt công dân' }, [student])
      const first = await repo.forStudent(student, declaration.id)
      assert.equal(first.lines[0]!.rule, 'SCHOOL_FULL')
      assert.match(first.lines[0]!.certificateCodes[0]!, /^CN-/)
      for (const title of ['Tự chọn 1', 'Tự chọn 2'])
        await held({ kind: 'VOLUNTARY', clubId: club.id, title }, [student], leader)
      assert.deepEqual((await lines())[0], ['SCHOOL_ACTIVE', 'C', 5])
      // A mandatory activity the student belongs to but did not attend removes the bonus.
      await held({ title: 'Hội nghị bắt buộc' }, [other])
      const missing = await repo.forStudent(student, declaration.id)
      assert.deepEqual([missing.lines[0]!.rule, missing.lines[0]!.points], ['SCHOOL_MISSING', 0])
      assert.match(missing.lines[0]!.explanation, /Hội nghị bắt buộc/)
    })

    await t.test('an excused cancellation counts as attended', async () => {
      const a = await activities.create(actorOf(ctsv), input({ title: 'Bắt buộc có lý do' }))
      await activities.transition(actorOf(ctsv), a.id, 'PUBLISHED', 0, null)
      await registrations.register(actorOf(student), a.id)
      await registrations.requestCancel(actorOf(student), a.id, 'Thi lại')
      const entry = (await registrations.roster(ctsv, a.id)).items[0]!
      await registrations.decide(actorOf(ctsv), a.id, entry.id, entry.revision, true, null)
      await db`UPDATE activities SET starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour',revision=revision+1 WHERE id=${a.id}`
      // The earlier missed activity still blocks; mark it as attended by another path: drop it.
      await db`UPDATE activities SET status='CANCELLED',revision=revision+1 WHERE title='Hội nghị bắt buộc'`
      const r = await repo.forStudent(student, declaration.id)
      assert.equal(r.lines[0]!.rule, 'SCHOOL_ACTIVE')
      assert.match(r.lines[0]!.explanation, /1 hủy có lý do/)
    })

    await t.test('club participation, organising committee and volunteering', async () => {
      const clubActivity = await held(
        { kind: 'VOLUNTARY', category: 'CLUB_ACADEMIC', clubId: club.id, title: 'Ngày hội CLB' },
        [student],
        leader,
      )
      await held(
        { kind: 'VOLUNTARY', category: 'VOLUNTEER', clubId: club.id, title: 'Hiến máu' },
        [student],
        leader,
      )
      await assert.rejects(
        repo.addOrganizer(actorOf(leader), clubActivity, 'G000'),
        is('ACTIVITY_SELF_DECISION', 403),
      )
      await assert.rejects(
        repo.addOrganizer(actorOf(leader), clubActivity, 'NOPE'),
        is('INVALID_ACTIVITY_ORGANIZER', 400),
      )
      await assert.rejects(
        repo.addOrganizer(actorOf(other), clubActivity, 'G001'),
        is('ACTIVITY_NOT_FOUND', 404),
      )
      const added = await repo.addOrganizer(actorOf(leader), clubActivity, 'G001')
      assert.equal(added.items[0]!.studentCode, 'G001')
      await assert.rejects(
        repo.addOrganizer(actorOf(leader), clubActivity, 'G001'),
        is('ACTIVITY_ORGANIZER_EXISTS', 409),
      )
      const r = await repo.forStudent(student, declaration.id)
      assert.deepEqual(
        r.lines.slice(1).map((l) => [l.rule, l.group, l.points]),
        [
          ['CLUB_PARTICIPANT', 'A', 3],
          ['CLUB_ORGANIZER', 'A', 2],
          ['VOLUNTEER', 'D', 5],
        ],
      )
      assert.deepEqual(r.totals, { C: 5, A: 5, D: 5 })
      const removed = await repo.removeOrganizer(actorOf(leader), clubActivity, added.items[0]!.id)
      assert.equal(removed.items.length, 0)
      await assert.rejects(
        db`UPDATE activity_organizers SET removed_at=NULL,removed_by_user_id=NULL WHERE id=${added.items[0]!.id}`,
        /ACTIVITY_ORGANIZER_IMMUTABLE/,
      )
      // A revoked certificate stops counting on the next read.
      const [volunteerCert] = await db<{ id: string }[]>`
        SELECT c.id FROM activity_certificates c JOIN activities a ON a.id=c.activity_id WHERE a.title='Hiến máu'`
      await attendance.revoke(actorOf(ctsv), volunteerCert!.id, 'Sai lệch')
      assert.ok(!(await lines()).some(([rule]) => rule === 'VOLUNTEER'))
    })

    await t.test(
      'period managers edit validated settings; reviewers see the same suggestion',
      async () => {
        const current = await repo.getSettings(admin, period.id)
        assert.equal(current.isDefault, true)
        assert.equal(current.revision, 0)
        await assert.rejects(
          repo.getSettings(ctsv, period.id),
          is('TRAINING_MANAGE_FORBIDDEN', 403),
        )
        const next = structuredClone(current.settings)
        next.school.active = 4
        const saved = await repo.saveSettings(admin, period.id, 0, next, null)
        assert.equal(saved.revision, 1)
        assert.equal((await repo.forStudent(student, declaration.id)).lines[0]!.points, 4)
        await assert.rejects(
          repo.saveSettings(admin, period.id, 0, next, null),
          is('TRAINING_CONFLICT', 409),
        )
        await assert.rejects(
          repo.saveSettings(
            admin,
            period.id,
            1,
            { ...next, school: { ...next.school, active: 21 } },
            null,
          ),
          is('INVALID_ACTIVITY_SETTINGS', 400),
        )
        const [audit] = await db<{ n: number }[]>`
        SELECT count(*)::integer AS n FROM audit_logs WHERE action='training.activity_settings.updated' AND resource_id=${period.id}`
        assert.equal(audit!.n, 1)
        await assert.rejects(
          repo.forReview(advisor, declaration.id),
          is('TRAINING_REVIEW_NOT_FOUND', 404),
        )
        const draft = await points.detail(student, declaration.id)
        const filled = await points.save(
          student,
          declaration.id,
          draft.revision,
          Object.fromEntries(['A', 'B', 'C', 'D', 'E'].map((c) => [c, { points: 0, note: '' }])),
        )
        await points.submit(student, declaration.id, filled.revision, randomUUID())
        const reviewer = await repo.forReview(advisor, declaration.id)
        assert.deepEqual(reviewer.lines, (await repo.forStudent(student, declaration.id)).lines)
        await assert.rejects(
          repo.forReview(other, declaration.id),
          is('TRAINING_REVIEW_NOT_FOUND', 404),
        )
      },
    )
  } finally {
    await q?.end()
    await control.unsafe('DROP DATABASE IF EXISTS "' + name + '" WITH (FORCE)')
    await control.end()
  }
})
