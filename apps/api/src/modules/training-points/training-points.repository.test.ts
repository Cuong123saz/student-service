import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import postgres from 'postgres'
import { databaseClient } from '../../db/client.js'
import { env } from '../../config/env.js'
import { buildApp } from '../../app.js'
import { TrainingPointRepository } from './training-points.repository.js'
import { TrainingPointService } from './training-points.service.js'
import { demoCriteria, type PeriodInput, type Answers } from './training-points.types.js'
import { SubmissionError } from '../submissions/submission.types.js'
import { JWT_ISSUER, ADMIN_JWT_AUDIENCE, USER_JWT_AUDIENCE } from '../auth/auth.constants.js'
after(() => databaseClient.end())
const status = (n: number) => (e: unknown) => e instanceof SubmissionError && e.statusCode === n
const pg = (n: string) => (e: unknown) =>
  Boolean(e && typeof e === 'object' && 'code' in e && e.code === n)
test('training points uses isolated synthetic PostgreSQL with lifecycle, current authorization and frozen submission', async (t) => {
  const url = new URL(process.env.DATABASE_URL ?? 'http://invalid')
  assert.equal(url.port, '5434')
  assert.equal(url.pathname, '/student_service_test')
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname))
  const name = 'training_points_test_' + randomUUID().replaceAll('-', ''),
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
      student = randomUUID(),
      other = randomUUID(),
      scoped = randomUUID(),
      split = randomUUID(),
      faculty = randomUUID(),
      foreignFaculty = randomUUID(),
      clazz = randomUUID(),
      otherClass = randomUUID()
    for (const [id, username] of [
      [admin, 's8-admin'],
      [student, 's8-student'],
      [other, 's8-other'],
      [scoped, 's8-scoped'],
      [split, 's8-split'],
    ])
      await db`INSERT INTO users(id,username,full_name,status,must_change_password) VALUES(${id!},${username!},'Sinh viên giả định','ACTIVE',false)`
    await db`INSERT INTO faculties(id,code,name) VALUES(${faculty},'S8','Khoa giả định'),(${foreignFaculty},'S8OTHER','Khoa khác')`
    await db`INSERT INTO academic_classes(id,faculty_id,code,name) VALUES(${clazz},${faculty},'S8CLASS','Lớp giả định'),(${otherClass},${foreignFaculty},'S8OTHERCLASS','Lớp khác')`
    for (const [user, code] of [
      [student, 'S8001'],
      [other, 'S8002'],
    ])
      await db`INSERT INTO student_profiles(user_id,class_id,student_code) VALUES(${user!},${clazz},${code!})`
    for (const role of ['SYSTEM_ADMIN', 'ADMIN', 'STUDENT', 'S8_SCOPE', 'S8_EMPTY'])
      await db`INSERT INTO roles(code,name,is_system) VALUES(${role},${role},false) ON CONFLICT DO NOTHING`
    for (const [user, role] of [
      [admin, 'SYSTEM_ADMIN'],
      [student, 'STUDENT'],
      [other, 'STUDENT'],
      [scoped, 'ADMIN'],
      [scoped, 'S8_SCOPE'],
      [split, 'ADMIN'],
      [split, 'S8_SCOPE'],
      [split, 'S8_EMPTY'],
    ])
      await db`INSERT INTO user_roles(user_id,role_id) SELECT ${user!},id FROM roles WHERE code=${role!}`
    await db`INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.code IN ('SYSTEM_ADMIN','S8_SCOPE') AND p.code='training_point.period.manage' ON CONFLICT DO NOTHING`
    const [global] = await db`SELECT id FROM authorization_scopes WHERE scope_type='GLOBAL'`
    const [scope] =
      await db`INSERT INTO authorization_scopes(scope_type,class_id) VALUES('CLASS',${clazz}) RETURNING id`
    for (const [user, role, scopeId] of [
      [admin, 'SYSTEM_ADMIN', global!.id],
      [scoped, 'S8_SCOPE', scope!.id],
      [split, 'S8_EMPTY', global!.id],
    ])
      await db`INSERT INTO user_role_scopes(user_id,role_id,scope_id) SELECT ${user as string},id,${scopeId as string} FROM roles WHERE code=${role as string}`
    const repo = new TrainingPointRepository(db),
      blobs = new Map<string, Buffer>()
    let beforeRead: (() => Promise<void>) | undefined, afterPut: (() => Promise<void>) | undefined
    const storage = {
      put: async (bytes: Buffer) => {
        const key = randomUUID()
        blobs.set(key, Buffer.from(bytes))
        await afterPut?.()
        return key
      },
      read: async (key: string) => {
        await beforeRead?.()
        const bytes = blobs.get(key)
        if (!bytes) throw new Error('Missing fake file')
        return Buffer.from(bytes)
      },
      remove: async (key: string) => {
        blobs.delete(key)
      },
    }
    const service = new TrainingPointService(repo, storage),
      pdf = await readFile(
        new URL('../../../scripts/fixtures/recovery/evidence-round-1.pdf', import.meta.url),
      )
    let year = 2026
    const input = (classId = clazz): PeriodInput => ({
      classId,
      academicYear: `${year}-${++year}`,
      semester: '1',
      name: 'Đợt giả định',
      policyLabel: 'Dữ liệu thử nghiệm, không phải quy chế',
      startsAt: new Date(Date.now() - 60000).toISOString(),
      endsAt: new Date(Date.now() + 3600000).toISOString(),
      criteria: demoCriteria(),
    })
    const fixture = async (user = student) => {
      const period = await repo.createPeriod(admin, input())
      const open = await repo.changePeriod(admin, period.id, period.revision, 'OPEN')
      return { period: open, row: await repo.start(user, period.id) }
    }
    const answers: Answers = Object.fromEntries(
      demoCriteria().map((c) => [c.code, { points: 0, note: '' }]),
    )
    await t.test(
      'manager permission and scope must come from same role and be current',
      async () => {
        const cat = await repo.catalog(scoped)
        assert.deepEqual(
          cat.classes.map((c) => c.id),
          [clazz],
        )
        await assert.rejects(repo.createPeriod(scoped, input(otherClass)), status(403))
        await assert.rejects(repo.catalog(split), status(403))
        await db`DELETE FROM user_roles WHERE user_id=${scoped} AND role_id=(SELECT id FROM roles WHERE code='ADMIN')`
        await assert.rejects(repo.catalog(scoped), status(403))
        await db`INSERT INTO user_roles(user_id,role_id) SELECT ${scoped},id FROM roles WHERE code='ADMIN'`
      },
    )
    await t.test(
      'faculty scope follows the current class faculty rather than stale grants',
      async () => {
        const [facultyScope] =
          await db`INSERT INTO authorization_scopes(scope_type,faculty_id) VALUES('FACULTY',${faculty}) RETURNING id`
        await db`DELETE FROM user_role_scopes WHERE user_id=${scoped} AND role_id=(SELECT id FROM roles WHERE code='S8_SCOPE')`
        await db`INSERT INTO user_role_scopes(user_id,role_id,scope_id) SELECT ${scoped},id,${facultyScope!.id as string} FROM roles WHERE code='S8_SCOPE'`
        try {
          const p = await repo.createPeriod(scoped, input())
          assert.deepEqual(
            (await repo.catalog(scoped)).classes.map((c) => c.id),
            [clazz],
          )
          await assert.rejects(repo.createPeriod(scoped, input(otherClass)), status(403))
          await db`UPDATE academic_classes SET faculty_id=${foreignFaculty} WHERE id=${clazz}`
          await assert.rejects(repo.periodDetail(scoped, p.id), status(403))
        } finally {
          await db`UPDATE academic_classes SET faculty_id=${faculty} WHERE id=${clazz}`
          await db`DELETE FROM user_role_scopes WHERE user_id=${scoped} AND role_id=(SELECT id FROM roles WHERE code='S8_SCOPE')`
          await db`INSERT INTO user_role_scopes(user_id,role_id,scope_id) SELECT ${scoped},id,${scope!.id as string} FROM roles WHERE code='S8_SCOPE'`
        }
      },
    )
    await t.test(
      'periods freeze configuration after opening, stale revision and duplicate cohort fail',
      async () => {
        const config = input(),
          p = await repo.createPeriod(admin, config)
        await assert.rejects(repo.createPeriod(admin, config), status(409))
        await assert.rejects(repo.start(student, p.id), status(409))
        const saved = await repo.changePeriod(admin, p.id, p.revision, 'SAVE', {
          ...config,
          name: 'Đợt đã sửa',
        })
        await assert.rejects(repo.changePeriod(admin, p.id, p.revision, 'OPEN'), status(409))
        const open = await repo.changePeriod(admin, p.id, saved.revision, 'OPEN')
        await assert.rejects(
          repo.changePeriod(admin, p.id, open.revision, 'SAVE', config),
          status(409),
        )
        await assert.rejects(
          db`UPDATE training_periods SET name='Tamper',revision=revision+1 WHERE id=${p.id}`,
          pg('23514'),
        )
      },
    )
    await t.test(
      'database rejects malformed criteria and missing/unknown answer keys',
      async () => {
        for (const value of [
          null,
          {},
          [null],
          demoCriteria().map((c) => ({ ...c, code: null })),
          demoCriteria().map((c) => ({ ...c, label: null })),
        ]) {
          const [r] =
            await db`SELECT training_valid_criteria(${JSON.stringify(value)}::text::jsonb) AS valid`
          assert.equal(r!.valid, false)
        }
        const [r] =
          await db`SELECT training_valid_answers('{"A":{"points":null,"note":null}}'::jsonb,${JSON.stringify(demoCriteria())}::text::jsonb,false) AS valid`
        assert.equal(r!.valid, false)
      },
    )
    await t.test(
      'concurrent starts create one declaration and one event; partial draft retains zero and null',
      async () => {
        const p = await repo.createPeriod(admin, input())
        await repo.changePeriod(admin, p.id, p.revision, 'OPEN')
        const [a, b] = await Promise.all([repo.start(student, p.id), repo.start(student, p.id)])
        assert.equal(a.id, b.id)
        assert.equal(a.history.length, 1)
        const saved = await repo.save(student, a.id, a.revision, {
          A: { points: 0, note: '' },
          B: { points: null, note: '' },
        })
        assert.equal(saved.answers.A!.points, 0)
        assert.equal(saved.answers.B!.points, null)
        await assert.rejects(
          service.submit(student, a.id, saved.revision, randomUUID()),
          status(400),
        )
        await assert.rejects(repo.save(student, a.id, a.revision, answers), status(409))
      },
    )
    await t.test('foreign owners cannot read, change or download another declaration', async () => {
      const { row } = await fixture()
      await assert.rejects(repo.detail(other, row.id), status(404))
      await assert.rejects(repo.save(other, row.id, row.revision, answers), status(404))
      await assert.rejects(service.download(other, row.id, randomUUID()), status(404))
      await db`UPDATE student_profiles SET class_id=${otherClass} WHERE user_id=${other}`
      await assert.rejects(repo.start(other, row.period.id), status(409))
      await db`UPDATE student_profiles SET class_id=${clazz} WHERE user_id=${other}`
    })
    await t.test(
      'positive required group needs explanation and a real file; invalid mime is rejected before storage',
      async () => {
        const { row } = await fixture()
        const a = { ...answers, A: { points: 15, note: 'Minh chứng giả định' } }
        const saved = await repo.save(student, row.id, row.revision, a)
        await assert.rejects(
          service.submit(student, row.id, saved.revision, randomUUID()),
          status(400),
        )
        const n = blobs.size
        await assert.rejects(
          service.upload(
            student,
            row.id,
            'A',
            saved.revision,
            randomUUID(),
            Buffer.from('fake'),
            'bad.pdf',
            'application/pdf',
          ),
          status(422),
        )
        assert.equal(blobs.size, n)
      },
    )
    await t.test(
      'upload retry is idempotent, conflicting request and stale revision clean newly owned bytes',
      async () => {
        const { row } = await fixture(),
          request = randomUUID(),
          n = blobs.size
        const added = await service.upload(
          student,
          row.id,
          'A',
          row.revision,
          request,
          pdf,
          'Mẫu.pdf',
          'application/pdf',
        )
        const replay = await service.upload(
          student,
          row.id,
          'A',
          row.revision,
          request,
          pdf,
          'Mẫu.pdf',
          'application/pdf',
        )
        assert.equal(replay.revision, added.revision)
        assert.equal(replay.files.length, 1)
        assert.equal(blobs.size, n + 1)
        assert.equal(replay.history.filter((e) => e.action === 'FILE_ADDED').length, 1)
        await assert.rejects(
          service.upload(
            student,
            row.id,
            'B',
            row.revision,
            request,
            pdf,
            'Mẫu.pdf',
            'application/pdf',
          ),
          status(409),
        )
        await assert.rejects(
          service.upload(
            student,
            row.id,
            'A',
            row.revision,
            randomUUID(),
            pdf,
            'Mẫu.pdf',
            'application/pdf',
          ),
          status(409),
        )
        assert.equal(blobs.size, n + 1)
        const file = added.files[0]!
        assert.deepEqual((await service.download(student, row.id, file.id)).bytes, pdf)
        assert.equal(file.signatureStatus, 'NOT_CHECKED')
        assert.ok(!('storageKey' in file))
        const removed = await repo.removeFile(student, row.id, file.id, added.revision)
        assert.equal(removed.files.length, 0)
        await assert.rejects(service.download(student, row.id, file.id), status(404))
        assert.equal(blobs.size, n + 1)
      },
    )
    await t.test(
      'three files per group is enforced and rejected upload does not leak bytes',
      async () => {
        let { row } = await fixture()
        const n = blobs.size
        for (let i = 0; i < 3; i++)
          row = await service.upload(
            student,
            row.id,
            'A',
            row.revision,
            randomUUID(),
            pdf,
            'Mẫu.pdf',
            'application/pdf',
          )
        await assert.rejects(
          service.upload(
            student,
            row.id,
            'A',
            row.revision,
            randomUUID(),
            pdf,
            'Mẫu.pdf',
            'application/pdf',
          ),
          status(413),
        )
        assert.equal(blobs.size, n + 3)
      },
    )
    await t.test(
      'ten-file and twenty-MiB totals reject an extra upload and reclaim new bytes',
      async () => {
        let { row } = await fixture()
        for (const criterion of ['A', 'A', 'A', 'B', 'B', 'B', 'C', 'C', 'C', 'D'] as const)
          row = await service.upload(
            student,
            row.id,
            criterion,
            row.revision,
            randomUUID(),
            pdf,
            'Mẫu.pdf',
            'application/pdf',
          )
        let n = blobs.size
        await assert.rejects(
          service.upload(
            student,
            row.id,
            'E',
            row.revision,
            randomUUID(),
            pdf,
            'Mẫu.pdf',
            'application/pdf',
          ),
          status(413),
        )
        assert.equal(blobs.size, n)
        ;({ row } = await fixture())
        const large = Buffer.alloc(5 * 1024 * 1024)
        pdf.copy(large)
        for (const criterion of ['A', 'A', 'B', 'B'] as const)
          row = await service.upload(
            student,
            row.id,
            criterion,
            row.revision,
            randomUUID(),
            large,
            'Mẫu.pdf',
            'application/pdf',
          )
        n = blobs.size
        await assert.rejects(
          service.upload(
            student,
            row.id,
            'C',
            row.revision,
            randomUUID(),
            pdf,
            'Mẫu.pdf',
            'application/pdf',
          ),
          status(413),
        )
        assert.equal(blobs.size, n)
      },
    )
    await t.test(
      'corrupt stored bytes block download and submit without state transition',
      async () => {
        let { row } = await fixture()
        row = await repo.save(student, row.id, row.revision, {
          ...answers,
          A: { points: 12, note: 'Giả định' },
        })
        row = await service.upload(
          student,
          row.id,
          'A',
          row.revision,
          randomUUID(),
          pdf,
          'Mẫu.pdf',
          'application/pdf',
        )
        const [f] = await db`SELECT storage_key FROM training_evidence WHERE id=${row.files[0]!.id}`
        const key = f!.storage_key as string
        blobs.set(key, Buffer.from('corrupt'))
        await assert.rejects(service.download(student, row.id, row.files[0]!.id), status(409))
        await assert.rejects(
          service.submit(student, row.id, row.revision, randomUUID()),
          status(409),
        )
        assert.equal((await repo.detail(student, row.id)).state, 'DRAFT')
        blobs.set(key, pdf)
      },
    )
    await t.test(
      'authorization is checked again after file I/O and failed upload cleans bytes',
      async () => {
        let { row } = await fixture()
        row = await service.upload(
          student,
          row.id,
          'A',
          row.revision,
          randomUUID(),
          pdf,
          'Mẫu.pdf',
          'application/pdf',
        )
        beforeRead = async () => {
          beforeRead = undefined
          await db`UPDATE users SET status='LOCKED' WHERE id=${student}`
        }
        await assert.rejects(service.download(student, row.id, row.files[0]!.id), status(403))
        await db`UPDATE users SET status='ACTIVE' WHERE id=${student}`
        const n = blobs.size
        afterPut = async () => {
          afterPut = undefined
          await db`UPDATE users SET status='LOCKED' WHERE id=${student}`
        }
        await assert.rejects(
          service.upload(
            student,
            row.id,
            'B',
            row.revision,
            randomUUID(),
            pdf,
            'Mẫu.pdf',
            'application/pdf',
          ),
          status(403),
        )
        assert.equal(blobs.size, n)
        await db`UPDATE users SET status='ACTIVE' WHERE id=${student}`
      },
    )
    await t.test(
      'submit freezes profile, criteria, file hash and score; concurrent retry creates one event',
      async () => {
        let { row } = await fixture()
        row = await repo.save(student, row.id, row.revision, {
          ...answers,
          A: { points: 20, note: 'Giả định' },
          B: { points: 5, note: 'Giả định' },
        })
        row = await service.upload(
          student,
          row.id,
          'A',
          row.revision,
          randomUUID(),
          pdf,
          'Mẫu.pdf',
          'application/pdf',
        )
        const request = randomUUID(),
          [a, b] = await Promise.all([
            service.submit(student, row.id, row.revision, request),
            service.submit(student, row.id, row.revision, request),
          ])
        assert.equal(a.state, 'SUBMITTED')
        assert.equal(a.totalPoints, 25)
        assert.equal(b.revision, a.revision)
        assert.equal(a.history.filter((e) => e.action === 'SUBMITTED').length, 1)
        assert.equal(a.scoreStatus, 'SELF_DECLARED_NOT_REVIEWED')
        assert.equal(a.editable, false)
        const [snapshot] =
          await db`SELECT student_snapshot,period_snapshot,evidence_snapshot,total_points FROM training_declarations WHERE id=${row.id}`
        assert.equal((snapshot!.evidence_snapshot as unknown[]).length, 1)
        await assert.rejects(repo.save(student, row.id, a.revision, answers), status(409))
        await assert.rejects(
          repo.removeFile(student, row.id, a.files[0]!.id, a.revision),
          status(409),
        )
        await assert.rejects(service.submit(student, row.id, a.revision, randomUUID()), status(409))
        await assert.rejects(
          db`UPDATE training_declarations SET answers='{}',revision=revision+1 WHERE id=${row.id}`,
          pg('23514'),
        )
        await assert.rejects(
          db`DELETE FROM training_evidence WHERE declaration_id=${row.id}`,
          pg('23514'),
        )
        await assert.rejects(
          db`UPDATE training_events SET metadata='{}' WHERE declaration_id=${row.id}`,
          pg('23514'),
        )
        await db`UPDATE users SET full_name='Tên mới giả định' WHERE id=${student}`
        await db`UPDATE student_profiles SET class_id=${otherClass} WHERE user_id=${student}`
        const old = await repo.detail(student, row.id)
        assert.equal((old.student as { fullName: string }).fullName, 'Sinh viên giả định')
        assert.ok((await repo.periods(student)).items.some((p) => p.declarationId === row.id))
        assert.equal(
          (await service.submit(student, row.id, row.revision, request)).revision,
          a.revision,
        )
        await db`UPDATE users SET full_name='Sinh viên giả định' WHERE id=${student}`
        await db`UPDATE student_profiles SET class_id=${clazz} WHERE user_id=${student}`
      },
    )
    await t.test(
      'closed periods, future windows and expired windows reject edits; history remains visible',
      async () => {
        const { period, row } = await fixture()
        await repo.changePeriod(admin, period.id, period.revision, 'CLOSE')
        assert.equal((await repo.detail(student, row.id)).editable, false)
        await assert.rejects(repo.save(student, row.id, row.revision, answers), status(409))
        await assert.rejects(
          repo.changePeriod(admin, period.id, period.revision + 1, 'OPEN'),
          status(409),
        )
        for (const dates of [
          {
            startsAt: new Date(Date.now() + 60000).toISOString(),
            endsAt: new Date(Date.now() + 120000).toISOString(),
          },
          {
            startsAt: new Date(Date.now() - 120000).toISOString(),
            endsAt: new Date(Date.now() - 60000).toISOString(),
          },
        ]) {
          const p = await repo.createPeriod(admin, { ...input(), ...dates })
          await repo.changePeriod(admin, p.id, p.revision, 'OPEN')
          await assert.rejects(repo.start(student, p.id), status(409))
        }
      },
    )
    await t.test('audit failure rolls back the answer, revision and event together', async () => {
      const { row } = await fixture()
      await db.unsafe(
        `CREATE FUNCTION fail_s8_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='training.saved' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`,
      )
      await db.unsafe(
        'CREATE TRIGGER fail_s8 BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_s8_audit()',
      )
      try {
        await assert.rejects(repo.save(student, row.id, row.revision, answers))
        const after = await repo.detail(student, row.id)
        assert.equal(after.revision, row.revision)
        assert.deepEqual(after.answers, {})
        assert.equal(after.history.length, 1)
      } finally {
        await db.unsafe('DROP TRIGGER fail_s8 ON audit_logs')
        await db.unsafe('DROP FUNCTION fail_s8_audit()')
      }
    })
    await t.test(
      'HTTP enforces portal, Origin, strict nested input and current rights; multipart works',
      async () => {
        const app = buildApp({ trainingService: service })
        await app.ready()
        const cookie = (user = student, portal: 'user' | 'admin' = 'user') =>
          portal +
          '_session=' +
          app.jwt.sign(
            {
              sub: user,
              username: 'fake',
              roles: portal === 'admin' ? ['SYSTEM_ADMIN'] : ['STUDENT'],
              portal,
              mustChangePassword: false,
              iss: JWT_ISSUER,
              aud: portal === 'admin' ? ADMIN_JWT_AUDIENCE : USER_JWT_AUDIENCE,
            },
            { expiresIn: '5m' },
          )
        const { row } = await fixture(),
          path = '/api/v1/user/training-declarations/' + row.id.toUpperCase()
        try {
          assert.equal((await app.inject({ url: path })).statusCode, 401)
          assert.equal(
            (await app.inject({ url: path, headers: { cookie: cookie(admin, 'admin') } }))
              .statusCode,
            401,
          )
          assert.equal(
            (await app.inject({ url: path, headers: { cookie: cookie(other) } })).statusCode,
            404,
          )
          const unauthorized = await app.inject({ url: path + '/files/' + randomUUID() })
          assert.equal(unauthorized.statusCode, 401)
          assert.match(unauthorized.headers['cache-control'] as string, /private, no-store/)
          const missingFile = await app.inject({
            url: path + '/files/' + randomUUID(),
            headers: { cookie: cookie() },
          })
          assert.equal(missingFile.statusCode, 404)
          assert.match(missingFile.headers['cache-control'] as string, /private, no-store/)
          const get = await app.inject({ url: path, headers: { cookie: cookie() } })
          assert.equal(get.statusCode, 200)
          assert.match(get.headers['cache-control'] as string, /no-store/)
          assert.ok(!get.body.includes('storage_key'))
          const put = async (body: unknown, origin: string | undefined = env.corsOrigin) =>
            app.inject({
              method: 'PUT',
              url: path,
              headers: { cookie: cookie(), ...(origin ? { origin } : {}) },
              payload: body as Record<string, unknown>,
            })
          assert.equal(
            (await put({ expectedRevision: row.revision, answers }, 'https://foreign.invalid'))
              .statusCode,
            403,
          )
          assert.equal(
            (
              await put({
                expectedRevision: row.revision,
                answers,
                studentSnapshot: { fullName: 'Injected' },
              })
            ).statusCode,
            400,
          )
          assert.equal(
            (
              await put({
                expectedRevision: row.revision,
                answers: { A: { points: 0, note: '', approved: true } },
              })
            ).statusCode,
            400,
          )
          const malformed = await app.inject({
            method: 'POST',
            url: '/api/v1/admin/training-periods',
            headers: { cookie: cookie(admin, 'admin'), origin: env.corsOrigin },
            payload: { ...input(), criteria: {} },
          })
          assert.equal(malformed.statusCode, 400)
          const forbidden = await app.inject({
            url: '/api/v1/admin/training-periods',
            headers: { cookie: cookie(split, 'admin') },
          })
          assert.equal(forbidden.statusCode, 403)
          const boundary = 's8-boundary',
            payload = Buffer.concat([
              Buffer.from(
                '--' +
                  boundary +
                  '\r\nContent-Disposition: form-data; name="file"; filename="proof.pdf"\r\nContent-Type: application/pdf\r\n\r\n',
              ),
              pdf,
              Buffer.from('\r\n--' + boundary + '--\r\n'),
            ])
          const upload = await app.inject({
            method: 'POST',
            url:
              path +
              '/evidence/A?expectedRevision=' +
              row.revision +
              '&requestId=' +
              randomUUID().toUpperCase(),
            headers: {
              cookie: cookie(),
              origin: env.corsOrigin,
              'content-type': 'multipart/form-data; boundary=' + boundary,
            },
            payload,
          })
          assert.equal(upload.statusCode, 200, upload.body)
          assert.equal(upload.json<{ files: unknown[] }>().files.length, 1)
        } finally {
          await app.close()
        }
      },
    )
  } finally {
    await q?.end()
    await control.unsafe('DROP DATABASE IF EXISTS "' + name + '" WITH (FORCE)')
    await control.end()
  }
})
