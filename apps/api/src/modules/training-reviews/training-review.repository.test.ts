import { createHash } from 'node:crypto'
import { readSheet } from 'read-excel-file/node'
import { createTrainingExportWorkbook } from './training-export.xlsx.js'
import { createTrainingMinutesDocx } from './training-export.docx.js'
import { strFromU8, unzipSync } from 'fflate'
import { TrainingExportService } from './training-export.service.js'
import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import postgres, { type TransactionSql } from 'postgres'
import { databaseClient } from '../../db/client.js'
import { env } from '../../config/env.js'
import { buildApp } from '../../app.js'
import { TrainingPointRepository } from '../training-points/training-points.repository.js'
import { TrainingPointService } from '../training-points/training-points.service.js'
import { TrainingReviewRepository } from './training-review.repository.js'
import { TrainingReviewService } from './training-review.service.js'
import type { ReviewInput } from './training-review.types.js'
import { demoCriteria, type Answers } from '../training-points/training-points.types.js'
import { SubmissionError } from '../submissions/submission.types.js'
import { JWT_ISSUER, ADMIN_JWT_AUDIENCE, USER_JWT_AUDIENCE } from '../auth/auth.constants.js'
after(() => databaseClient.end())
const status = (n: number) => (e: unknown) => e instanceof SubmissionError && e.statusCode === n
const pg = (n: string) => (e: unknown) =>
  Boolean(e && typeof e === 'object' && 'code' in e && e.code === n)
test('advisor and faculty workflow uses an isolated synthetic database', async (t) => {
  const url = new URL(process.env.DATABASE_URL ?? 'http://invalid')
  assert.equal(url.port, '5434')
  assert.equal(url.pathname, '/student_service_test')
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname))
  const name = 'training_reviews_test_' + randomUUID().replaceAll('-', ''),
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
      advisor = randomUUID(),
      faculty = randomUUID(),
      dual = randomUUID(),
      outsider = randomUUID(),
      clazz = randomUUID(),
      foreignClass = randomUUID(),
      fac = randomUUID(),
      foreignFac = randomUUID()
    for (const [id, name] of [
      [admin, 'admin'],
      [student, 'student'],
      [other, 'other'],
      [advisor, 'advisor'],
      [faculty, 'faculty'],
      [dual, 'dual'],
      [outsider, 'outsider'],
    ])
      await db`INSERT INTO users(id,username,full_name,status,must_change_password) VALUES(${id!},${'s9-' + name},${'Người giả định ' + name},'ACTIVE',false)`
    await db`INSERT INTO faculties(id,code,name) VALUES(${fac},'S9','Khoa thử nghiệm'),(${foreignFac},'S9OTHER','Khoa khác')`
    await db`INSERT INTO academic_classes(id,faculty_id,code,name) VALUES(${clazz},${fac},'S9CLASS','Lớp thử nghiệm'),(${foreignClass},${foreignFac},'S9OTHERCLASS','Lớp khác')`
    for (const role of ['SYSTEM_ADMIN', 'STUDENT', 'ACADEMIC_ADVISOR', 'FACULTY_REVIEWER'])
      await db`INSERT INTO roles(code,name,is_system) VALUES(${role},${role},true) ON CONFLICT DO NOTHING`
    const grant = async (user: string, role: string, scope: string) => {
      await db`INSERT INTO user_roles(user_id,role_id) SELECT ${user},id FROM roles WHERE code=${role} ON CONFLICT DO NOTHING`
      await db`INSERT INTO user_role_scopes(user_id,role_id,scope_id) SELECT ${user},id,${scope} FROM roles WHERE code=${role} ON CONFLICT DO NOTHING`
    }
    const [global] = await db<
      { id: string }[]
    >`SELECT id FROM authorization_scopes WHERE scope_type='GLOBAL'`
    const [classScope] = await db<
      { id: string }[]
    >`INSERT INTO authorization_scopes(scope_type,class_id) VALUES('CLASS',${clazz}) RETURNING id`
    const [facultyScope] = await db<
      { id: string }[]
    >`INSERT INTO authorization_scopes(scope_type,faculty_id) VALUES('FACULTY',${fac}) RETURNING id`
    const [foreignScope] = await db<
      { id: string }[]
    >`INSERT INTO authorization_scopes(scope_type,faculty_id) VALUES('FACULTY',${foreignFac}) RETURNING id`
    for (const [role, permission] of [
      ['SYSTEM_ADMIN', 'training_point.period.manage'],
      ['ACADEMIC_ADVISOR', 'training_point.review'],
      ['FACULTY_REVIEWER', 'training_point.faculty_approve'],
    ])
      await db`INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.code=${role!} AND p.code=${permission!} ON CONFLICT DO NOTHING`
    await grant(admin, 'SYSTEM_ADMIN', global!.id)
    await grant(student, 'STUDENT', global!.id)
    await grant(other, 'STUDENT', global!.id)
    await grant(advisor, 'ACADEMIC_ADVISOR', classScope!.id)
    await grant(faculty, 'FACULTY_REVIEWER', facultyScope!.id)
    await grant(dual, 'ACADEMIC_ADVISOR', classScope!.id)
    await grant(dual, 'FACULTY_REVIEWER', facultyScope!.id)
    await grant(outsider, 'FACULTY_REVIEWER', foreignScope!.id)
    await db`INSERT INTO student_profiles(user_id,class_id,student_code) VALUES(${student},${clazz},'S9001'),(${other},${clazz},'S9002')`
    await db`INSERT INTO academic_advisor_assignments(advisor_user_id,class_id,valid_from) VALUES(${advisor},${clazz},now()-interval '1 day')`
    // ADR 0028: the Sprint 9/10 scenarios use the class monitor's own declaration, which goes
    // straight to the advisor; the monitor step itself is covered by dedicated tests below.
    await db`INSERT INTO user_roles(user_id,role_id) SELECT ${student},id FROM roles WHERE code='CLASS_MONITOR'`
    await db`INSERT INTO class_monitor_assignments(monitor_user_id,class_id,valid_from,assigned_by_user_id) VALUES(${student},${clazz},now()-interval '1 day',${advisor})`
    await db`INSERT INTO academic_advisor_assignments(advisor_user_id,class_id,valid_from,status) VALUES(${dual},${clazz},now()-interval '1 day','INACTIVE')`
    const pointRepo = new TrainingPointRepository(db),
      repo = new TrainingReviewRepository(db),
      blobs = new Map<string, Buffer>()
    let beforeRead: (() => Promise<void>) | undefined
    const storage = {
      put: async (bytes: Buffer) => {
        const k = randomUUID()
        blobs.set(k, Buffer.from(bytes))
        return k
      },
      read: async (k: string) => {
        await beforeRead?.()
        if (!blobs.has(k)) throw new Error('Missing synthetic bytes')
        return Buffer.from(blobs.get(k)!)
      },
      remove: async (k: string) => {
        blobs.delete(k)
      },
    }
    const points = new TrainingPointService(pointRepo, storage),
      service = new TrainingReviewService(repo, storage)
    const pdf = await readFile(
      new URL('../../../scripts/fixtures/recovery/evidence-round-1.pdf', import.meta.url),
    )
    let year = 2026
    const answers: Answers = {
      A: { points: 10, note: 'Tự khai A' },
      B: { points: 5, note: 'Tự khai B' },
      C: { points: 0, note: '' },
      D: { points: 0, note: '' },
      E: { points: 0, note: '' },
    }
    const assessed: Answers = {
      ...answers,
      A: { points: 8, note: 'Cố vấn đối chiếu A' },
      B: { points: 5, note: 'Cố vấn đối chiếu B' },
    }
    const actorOf = (userId: string) => ({
      userId,
      username: 'test',
      requestId: randomUUID(),
      ipAddress: '127.0.0.1',
      userAgent: 'test',
    })
    const input = (revision = 0, withAnswers = true): ReviewInput => ({
      expectedRevision: revision,
      requestId: randomUUID(),
      confirmed: true,
      comment: 'Nhận xét giả định',
      ...(withAnswers ? { answers: structuredClone(assessed) } : {}),
    })
    const fixture = async (withFile = false, requiredZero = false) => {
      const p = await pointRepo.createPeriod(admin, {
        classId: clazz,
        academicYear: `${year}-${++year}`,
        semester: '1',
        name: 'Đợt giả định Sprint 9',
        policyLabel: 'Quy chế giả định',
        startsAt: new Date(Date.now() - 60000).toISOString(),
        endsAt: new Date(Date.now() + 3600000).toISOString(),
        criteria: demoCriteria().map((c) => ({
          ...c,
          evidenceRequired: requiredZero && c.code === 'A',
        })),
      })
      await pointRepo.changePeriod(admin, p.id, p.revision, 'OPEN')
      let d = await pointRepo.start(student, p.id)
      d = await pointRepo.save(
        student,
        d.id,
        d.revision,
        requiredZero ? { ...answers, A: { points: 0, note: '' } } : answers,
      )
      if (withFile)
        d = await points.upload(
          student,
          d.id,
          'A',
          d.revision,
          randomUUID(),
          pdf,
          'proof.pdf',
          'application/pdf',
        )
      return { p, d: await points.submit(student, d.id, d.revision, randomUUID()) }
    }
    await t.test(
      'export snapshot excludes drafts and pending rows without inventing zero results',
      async () => {
        const p = await pointRepo.createPeriod(admin, {
          classId: clazz,
          academicYear: `${year}-${++year}`,
          semester: '1',
          name: 'Đợt trống',
          policyLabel: 'Giả định',
          startsAt: new Date(Date.now() - 60000).toISOString(),
          endsAt: new Date(Date.now() + 3600000).toISOString(),
          criteria: demoCriteria().map((c) => ({ ...c, evidenceRequired: false })),
        })
        await assert.rejects(repo.exportSnapshot(advisor, p.id), status(404))
        await pointRepo.changePeriod(admin, p.id, 1, 'OPEN')
        await pointRepo.start(other, p.id)
        const empty = await repo.exportSnapshot(advisor, p.id)
        assert.deepEqual(empty.rows, [])
        assert.equal(empty.summary.submitted, 0)
        assert.equal(empty.summary.approvedAveragePoints, null)
        assert.equal(empty.summary.approvedTotalPoints, 0)
        const pending = await fixture()
        await pointRepo.start(other, pending.p.id)
        const snapshot = await repo.exportSnapshot(faculty, pending.p.id)
        assert.equal(snapshot.summary.submitted, 1)
        assert.equal(snapshot.summary.waitingAdvisor, 1)
        assert.equal(snapshot.summary.approved, 0)
        assert.deepEqual(snapshot.rows, [])
        assert.deepEqual(snapshot.classification, {
          status: 'PROVISIONAL',
          version: 'classification-standard-v1',
        })
        assert.equal(snapshot.legalEffect, false)
        assert.equal(snapshot.exportedBy.userId, faculty)
        assert.match(snapshot.capturedAt, /^\d{4}-\d{2}-\d{2}T.*Z$/)
        assert.notEqual(
          snapshot.snapshotId,
          (await repo.exportSnapshot(faculty, pending.p.id)).snapshotId,
        )
      },
    )
    await t.test(
      'export uses final approval parent, frozen student and actor data, including genuine zero scores',
      async () => {
        const { p, d } = await fixture()
        await repo.act(advisor, d.id, 'ADVISOR_SIGNED', input())
        await repo.act(faculty, d.id, 'FACULTY_RETURNED', input(1, false))
        const revised = input(2)
        revised.answers = { ...assessed, A: { points: 9, note: 'Xác nhận lại' } }
        const signed = await repo.act(advisor, d.id, 'ADVISOR_SIGNED', revised)
        const approved = await repo.act(faculty, d.id, 'FACULTY_APPROVED', input(3, false))
        let second = await pointRepo.start(other, p.id)
        const zero = Object.fromEntries(
          Object.keys(answers).map((code) => [code, { points: 0, note: '' }]),
        )
        second = await pointRepo.save(other, second.id, second.revision, zero)
        await pointRepo.submit(other, second.id, second.revision, randomUUID())
        // ADR 0028: a regular student's declaration passes the class monitor first.
        await repo.act(student, second.id, 'MONITOR_CONFIRMED', input(0, false))
        await repo.act(advisor, second.id, 'ADVISOR_SIGNED', { ...input(1), answers: zero })
        await repo.act(faculty, second.id, 'FACULTY_APPROVED', input(2, false))
        const [advisorBefore] = await db<
          { full_name: string }[]
        >`SELECT full_name FROM users WHERE id=${advisor}`
        try {
          await db`UPDATE student_profiles SET class_id=${foreignClass} WHERE user_id=${student}`
          await db`UPDATE users SET full_name='Tên đã thay đổi sau duyệt' WHERE id=${advisor}`
          const snapshot = await repo.exportSnapshot(faculty, p.id)
          assert.deepEqual(
            snapshot.rows.map((row) => row.student.studentCode),
            ['S9001', 'S9002'],
          )
          const row = snapshot.rows[0]!
          assert.equal(row.student.classCode, 'S9CLASS')
          assert.equal(row.selfPoints, 15)
          assert.equal(row.approvedPoints, 14)
          assert.equal(row.approvedAnswers.A!.points, 9)
          assert.equal(row.advisor.id, signed.decisions[2]!.id)
          assert.equal(row.advisor.actor.fullName, advisorBefore!.full_name)
          assert.equal(row.faculty.id, approved.decisions[3]!.id)
          assert.equal(row.declarationSha256, approved.declarationSha256)
          assert.equal(snapshot.rows[1]!.approvedPoints, 0)
          assert.equal(snapshot.summary.approved, 2)
          assert.equal(snapshot.summary.approvedTotalPoints, 14)
          assert.equal(snapshot.summary.approvedAveragePoints, 7)
          assert.equal('files' in row, false)
          assert.equal('storageKey' in row, false)
        } finally {
          await db`UPDATE student_profiles SET class_id=${clazz} WHERE user_id=${student}`
          await db`UPDATE users SET full_name=${advisorBefore!.full_name} WHERE id=${advisor}`
        }
      },
    )
    await t.test(
      'export requires current role, scope and assignment; service refuses a snapshot after revocation',
      async () => {
        const { p } = await fixture()
        for (const read of [repo.exportSnapshot.bind(repo), repo.assertExportAccess.bind(repo)]) {
          await assert.rejects(read(admin, p.id), status(403))
          await assert.rejects(read(other, p.id), status(403))
          // ADR 0028: the class monitor is refused detailed exports but allowed the class sheet/forms.
          await assert.rejects(read(student, p.id), status(404))
          await read(student, p.id, true)
          await assert.rejects(read(outsider, p.id), status(404))
          await assert.rejects(read(faculty, randomUUID()), status(404))
        }
        try {
          await db`UPDATE academic_advisor_assignments SET status='INACTIVE' WHERE advisor_user_id=${advisor}`
          await assert.rejects(repo.exportSnapshot(advisor, p.id), status(404))
          await db`UPDATE academic_advisor_assignments SET status='ACTIVE' WHERE advisor_user_id=${advisor}`
          await db`DELETE FROM user_role_scopes WHERE user_id=${faculty}`
          await assert.rejects(repo.exportSnapshot(faculty, p.id), status(404))
          await grant(faculty, 'FACULTY_REVIEWER', facultyScope!.id)
          const service = new TrainingExportService({
            exportSnapshot: async (user, id) => {
              const snapshot = await repo.exportSnapshot(user, id)
              await db`UPDATE academic_advisor_assignments SET status='INACTIVE' WHERE advisor_user_id=${advisor}`
              return snapshot
            },
            assertExportAccess: repo.assertExportAccess.bind(repo),
            recordExport: repo.recordExport.bind(repo),
          })
          await assert.rejects(service.capture(advisor, p.id), status(404))
        } finally {
          await db`UPDATE academic_advisor_assignments SET status='ACTIVE' WHERE advisor_user_id=${advisor}`
          await grant(faculty, 'FACULTY_REVIEWER', facultyScope!.id)
        }
      },
    )
    await t.test(
      'export rows and summary share a snapshot when faculty approves between reads',
      async () => {
        const { p, d } = await fixture()
        await repo.act(advisor, d.id, 'ADVISOR_SIGNED', input())
        let interleaved = false
        const concurrentDb = new Proxy(db, {
          get(target, property, receiver) {
            if (property !== 'begin') return Reflect.get(target, property, receiver) as unknown
            return (options: string, fn: (tx: TransactionSql) => Promise<unknown>) =>
              target.begin(options, (tx) =>
                fn(
                  new Proxy(tx, {
                    apply(query, context, args) {
                      const sql = (args[0] as TemplateStringsArray).join('?')
                      if (sql.includes('AS submitted,'))
                        return (async () => {
                          await repo.act(faculty, d.id, 'FACULTY_APPROVED', input(1, false))
                          interleaved = true
                          return Reflect.apply(query, context, args) as unknown
                        })()
                      return Reflect.apply(query, context, args) as unknown
                    },
                  }),
                ),
              )
          },
        })
        const result = await new TrainingReviewRepository(concurrentDb).exportSnapshot(
          advisor,
          p.id,
        )
        assert.equal(interleaved, true)
        assert.deepEqual(result.rows, [])
        assert.equal(result.summary.waitingFaculty, 1)
        assert.equal(result.summary.approved, 0)
        const later = await repo.exportSnapshot(advisor, p.id)
        assert.equal(later.rows.length, 1)
        assert.equal(later.summary.approved, 1)
      },
    )

    await t.test(
      'XLSX HTTP download enforces session, origin, scope, fresh rights and transactional audit',
      async () => {
        const { p, d } = await fixture()
        await repo.act(advisor, d.id, 'ADVISOR_SIGNED', input())
        await repo.act(faculty, d.id, 'FACULTY_APPROVED', input(1, false))
        let revokeAfterRender = false
        const exporter = new TrainingExportService(repo, async (snapshot) => {
          const bytes = createTrainingExportWorkbook(snapshot)
          if (revokeAfterRender)
            await db`UPDATE academic_advisor_assignments SET status='INACTIVE' WHERE advisor_user_id=${advisor}`
          return bytes
        })
        const app = buildApp({
          trainingReviewService: service,
          trainingService: points,
          trainingExportService: exporter,
        })
        await app.ready()
        const cookie = (user = advisor, portal: 'user' | 'admin' = 'user') =>
          portal +
          '_session=' +
          app.jwt.sign(
            {
              sub: user,
              username: 'test',
              roles: portal === 'admin' ? ['SYSTEM_ADMIN'] : ['ACADEMIC_ADVISOR', 'STUDENT'],
              portal,
              mustChangePassword: false,
              iss: JWT_ISSUER,
              aud: portal === 'admin' ? ADMIN_JWT_AUDIENCE : USER_JWT_AUDIENCE,
            },
            { expiresIn: '5m' },
          )
        const url = '/api/v1/user/training-reviews/periods/' + p.id + '/export.xlsx'
        let ip = 1
        const request = (headers: Record<string, string>, path = url) =>
          app.inject({
            method: 'POST',
            payload: {},
            url: path,
            headers,
            remoteAddress: '127.0.1.' + ip++,
          })
        try {
          for (const headers of [{}, { cookie: cookie(admin, 'admin') }]) {
            const res = await request(headers)
            assert.equal(res.statusCode, 401)
            assert.match(res.headers['cache-control'] as string, /private.*no-store/)
          }
          for (const [user, expected] of [
            [admin, 403],
            [other, 403],
            [outsider, 404],
          ] as const)
            assert.equal(
              (await request({ cookie: cookie(user), origin: env.corsOrigin })).statusCode,
              expected,
            )
          assert.equal((await request({ cookie: cookie() })).statusCode, 403)
          assert.equal(
            (await request({ cookie: cookie(), origin: 'https://foreign.invalid' })).statusCode,
            403,
          )
          assert.equal(
            (await request({ cookie: cookie(), origin: env.corsOrigin }, url + '?format=csv'))
              .statusCode,
            400,
          )
          assert.equal(
            (await app.inject({ url, headers: { cookie: cookie(), origin: env.corsOrigin } }))
              .statusCode,
            404,
          )
          assert.equal(
            (
              await app.inject({
                url,
                method: 'POST',
                payload: { format: 'csv' },
                headers: { cookie: cookie(), origin: env.corsOrigin },
                remoteAddress: '127.0.3.200',
              })
            ).statusCode,
            400,
          )
          const res = await request({ cookie: cookie(), origin: env.corsOrigin })
          assert.equal(res.statusCode, 200, res.body)
          assert.match(res.headers['content-type'] as string, /spreadsheetml/)
          assert.match(
            res.headers['content-disposition'] as string,
            /attachment; filename="training-points.xlsx"/,
          )
          assert.equal(res.headers['x-content-type-options'], 'nosniff')
          const data = await readSheet(res.rawPayload, 'Kết quả đã duyệt')
          assert.equal(data[4]![1], 'S9001')
          assert.equal(data[4]![6], 15)
          assert.equal(data[4]![12], 13)
          const [audit] = await db<
            {
              metadata: {
                snapshotId: string
                rowCount: number
                sha256: string
                size: number
                format: string
              }
              actor_username: string
            }[]
          >`SELECT metadata,actor_username FROM audit_logs WHERE action='training.export.xlsx.prepared' AND resource_id=${p.id}`
          assert.equal(audit!.metadata.snapshotId, res.headers['x-export-snapshot-id'])
          assert.equal(
            audit!.metadata.sha256,
            createHash('sha256').update(res.rawPayload).digest('hex'),
          )
          assert.equal(audit!.metadata.sha256, res.headers['x-export-sha256'])
          assert.equal(audit!.metadata.rowCount, 1)
          assert.deepEqual(Object.keys(audit!.metadata).sort(), [
            'format',
            'rowCount',
            'sha256',
            'size',
            'snapshotId',
          ])
          revokeAfterRender = true
          const revoked = await request({ cookie: cookie(), origin: env.corsOrigin })
          assert.equal(revoked.statusCode, 404)
          assert.match(revoked.headers['content-type'] as string, /json/)
          assert.equal(revoked.headers['x-export-snapshot-id'], undefined)
          revokeAfterRender = false
          await db`UPDATE academic_advisor_assignments SET status='ACTIVE' WHERE advisor_user_id=${advisor}`
          await db.unsafe(
            `CREATE FUNCTION s10_fail_export_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='training.export.xlsx.prepared' THEN RAISE EXCEPTION 'synthetic export audit failure'; END IF; RETURN NEW; END $$`,
          )
          await db.unsafe(
            'CREATE TRIGGER s10_fail_export_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION s10_fail_export_audit()',
          )
          try {
            const failed = await request({ cookie: cookie(), origin: env.corsOrigin })
            assert.equal(failed.statusCode, 500)
            assert.equal(failed.headers['x-export-sha256'], undefined)
            assert.doesNotMatch(
              failed.body,
              /synthetic export audit failure|SELECT|INSERT|storage_key/,
            )
          } finally {
            await db.unsafe('DROP TRIGGER s10_fail_export_audit ON audit_logs')
            await db.unsafe('DROP FUNCTION s10_fail_export_audit()')
          }
          const [count] = await db<
            { n: number }[]
          >`SELECT count(*)::integer AS n FROM audit_logs WHERE action='training.export.xlsx.prepared' AND resource_id=${p.id}`
          assert.equal(count!.n, 1)
          for (let i = 0; i < 6; i++) {
            const limited = await app.inject({
              url,
              method: 'POST',
              payload: {},
              headers: { cookie: cookie(), origin: env.corsOrigin },
              remoteAddress: '127.0.2.250',
            })
            assert.equal(limited.statusCode, i < 5 ? 200 : 429)
            assert.match(limited.headers['cache-control'] as string, /no-store/)
          }
        } finally {
          await db`UPDATE academic_advisor_assignments SET status='ACTIVE' WHERE advisor_user_id=${advisor}`
          await app.close()
        }
      },
    )

    await t.test(
      'minutes DOCX/PDF HTTP download uses one snapshot, exact DOCX for PDF, fresh rights and audit',
      async () => {
        const { p, d } = await fixture()
        await repo.act(advisor, d.id, 'ADVISOR_SIGNED', input())
        await repo.act(faculty, d.id, 'FACULTY_APPROVED', input(1, false))
        let revokeAfterConvert = false,
          failConvert = false,
          converted: Buffer | undefined
        const exporter = new TrainingExportService(
          repo,
          createTrainingExportWorkbook,
          createTrainingMinutesDocx,
          {
            convert: async (docx) => {
              converted = docx
              if (failConvert) throw new Error('synthetic converter failure')
              if (revokeAfterConvert)
                await db`UPDATE academic_advisor_assignments SET status='INACTIVE' WHERE advisor_user_id=${advisor}`
              return Buffer.from('%PDF-1.7 synthetic minutes %%EOF')
            },
          },
        )
        const app = buildApp({
          trainingReviewService: service,
          trainingService: points,
          trainingExportService: exporter,
        })
        await app.ready()
        const cookie = (user = advisor) =>
          'user_session=' +
          app.jwt.sign(
            {
              sub: user,
              username: 'test',
              roles: ['ACADEMIC_ADVISOR', 'STUDENT'],
              portal: 'user',
              mustChangePassword: false,
              iss: JWT_ISSUER,
              aud: USER_JWT_AUDIENCE,
            },
            { expiresIn: '5m' },
          )
        const base = '/api/v1/user/training-reviews/periods/' + p.id
        let ip = 1
        const request = (format: 'docx' | 'pdf', headers: Record<string, string> = {}) =>
          app.inject({
            method: 'POST',
            payload: {},
            url: `${base}/minutes.${format}`,
            headers: { cookie: cookie(), origin: env.corsOrigin, ...headers },
            remoteAddress: '127.0.4.' + ip++,
          })
        const audits = (action: string) =>
          db<
            { metadata: Record<string, unknown> }[]
          >`SELECT metadata FROM audit_logs WHERE action=${action} AND resource_id=${p.id} ORDER BY occurred_at`
        try {
          assert.equal((await request('docx', { cookie: '' })).statusCode, 401)
          assert.equal(
            (await request('docx', { origin: 'https://foreign.invalid' })).statusCode,
            403,
          )
          assert.equal((await request('pdf', { cookie: cookie(other) })).statusCode, 403)
          assert.equal((await request('pdf', { cookie: cookie(outsider) })).statusCode, 404)
          assert.equal(
            (await app.inject({ url: `${base}/minutes.pdf`, headers: { cookie: cookie() } }))
              .statusCode,
            404,
            'GET never generates a file',
          )
          assert.equal(converted, undefined, 'rejected requests never reach the converter')

          const docx = await request('docx')
          assert.equal(docx.statusCode, 200, docx.body)
          assert.match(docx.headers['content-type'] as string, /wordprocessingml/)
          assert.match(
            docx.headers['content-disposition'] as string,
            /attachment; filename="training-minutes.docx"/,
          )
          assert.equal(docx.headers['x-export-template-version'], 'training-minutes-v3')
          assert.match(docx.headers['cache-control'] as string, /private.*no-store/)
          const word = strFromU8(unzipSync(docx.rawPayload)['word/document.xml']!)
          assert.ok(word.includes('S9001'))
          assert.ok(word.includes(docx.headers['x-export-snapshot-id'] as string))

          const pdf = await request('pdf')
          assert.equal(pdf.statusCode, 200, pdf.body)
          assert.equal(pdf.headers['content-type'], 'application/pdf')
          const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')
          assert.equal(pdf.headers['x-export-sha256'], sha(pdf.rawPayload))
          assert.equal(pdf.headers['x-export-source-docx-sha256'], sha(converted!))
          // The PDF comes from the DOCX of its own snapshot, rendered by the same code path.
          assert.ok(
            strFromU8(unzipSync(converted!)['word/document.xml']!).includes(
              pdf.headers['x-export-snapshot-id'] as string,
            ),
          )

          const [docxAudit] = await audits('training.export.docx.prepared')
          assert.deepEqual(docxAudit!.metadata, {
            format: 'DOCX',
            rowCount: 1,
            sha256: sha(docx.rawPayload),
            size: docx.rawPayload.length,
            snapshotId: docx.headers['x-export-snapshot-id'],
            templateVersion: 'training-minutes-v3',
          })
          const [pdfAudit] = await audits('training.export.pdf.prepared')
          assert.deepEqual(pdfAudit!.metadata, {
            format: 'PDF',
            rowCount: 1,
            sha256: sha(pdf.rawPayload),
            size: pdf.rawPayload.length,
            snapshotId: pdf.headers['x-export-snapshot-id'],
            templateVersion: 'training-minutes-v3',
            sourceDocxSha256: sha(converted!),
          })

          failConvert = true
          const failed = await request('pdf')
          assert.equal(failed.statusCode, 503)
          assert.match(failed.body, /TRAINING_EXPORT_PDF_UNAVAILABLE/)
          assert.doesNotMatch(failed.body, /synthetic converter failure/)
          assert.equal(failed.headers['x-export-sha256'], undefined)
          failConvert = false

          revokeAfterConvert = true
          const revoked = await request('pdf')
          assert.equal(revoked.statusCode, 404)
          assert.equal(revoked.headers['x-export-snapshot-id'], undefined)
          assert.match(revoked.headers['content-type'] as string, /json/)
          revokeAfterConvert = false
          assert.equal((await audits('training.export.pdf.prepared')).length, 1)
        } finally {
          await db`UPDATE academic_advisor_assignments SET status='ACTIVE' WHERE advisor_user_id=${advisor}`
          await app.close()
        }
      },
    )

    await t.test(
      'ZIP HTTP download bundles one snapshot with a verifiable manifest and CORS-exposed hashes',
      async () => {
        const { p, d } = await fixture()
        await repo.act(advisor, d.id, 'ADVISOR_SIGNED', input())
        await repo.act(faculty, d.id, 'FACULTY_APPROVED', input(1, false))
        let failConvert = false
        const exporter = new TrainingExportService(
          repo,
          createTrainingExportWorkbook,
          createTrainingMinutesDocx,
          {
            convert: async () => {
              if (failConvert) throw new Error('synthetic converter failure')
              return Buffer.from('%PDF-1.7 synthetic bundle %%EOF')
            },
          },
        )
        const app = buildApp({
          trainingReviewService: service,
          trainingService: points,
          trainingExportService: exporter,
        })
        await app.ready()
        const token = app.jwt.sign(
          {
            sub: advisor,
            username: 'test',
            roles: ['ACADEMIC_ADVISOR', 'STUDENT'],
            portal: 'user',
            mustChangePassword: false,
            iss: JWT_ISSUER,
            aud: USER_JWT_AUDIENCE,
          },
          { expiresIn: '5m' },
        )
        const url = '/api/v1/user/training-reviews/periods/' + p.id + '/export.zip'
        let ip = 1
        const request = () =>
          app.inject({
            method: 'POST',
            payload: {},
            url,
            headers: { cookie: 'user_session=' + token, origin: env.corsOrigin },
            remoteAddress: '127.0.5.' + ip++,
          })
        const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
        try {
          const res = await request()
          assert.equal(res.statusCode, 200, res.body)
          assert.equal(res.headers['content-type'], 'application/zip')
          assert.match(res.headers['cache-control'] as string, /private.*no-store/)
          const exposed = String(res.headers['access-control-expose-headers'] ?? '')
          for (const header of [
            'Content-Disposition',
            'X-Export-Snapshot-Id',
            'X-Export-Sha256',
            'X-Export-Manifest-Sha256',
          ])
            assert.ok(exposed.includes(header), header)
          assert.equal(res.headers['x-export-sha256'], sha(res.rawPayload))
          const files = unzipSync(res.rawPayload)
          const manifest = JSON.parse(strFromU8(files['manifest.json']!)) as {
            snapshotId: string
            approvedRows: number
            files: { name: string; sha256: string; size: number }[]
          }
          assert.equal(res.headers['x-export-manifest-sha256'], sha(files['manifest.json']!))
          assert.equal(manifest.snapshotId, res.headers['x-export-snapshot-id'])
          assert.equal(manifest.approvedRows, 1)
          // ADR 0026: the bundle also carries the school-format class sheet of the same snapshot.
          assert.equal(manifest.files.length, 4)
          assert.ok(manifest.files.some((f) => f.name.startsWith('training-class-sheet-')))
          for (const f of manifest.files) {
            assert.equal(sha(files[f.name]!), f.sha256, f.name)
            assert.equal(files[f.name]!.length, f.size, f.name)
          }
          // Every rendered file inside carries the same snapshot.
          const docxName = manifest.files.find((f) => f.name.endsWith('.docx'))!.name
          assert.ok(
            strFromU8(unzipSync(files[docxName]!)['word/document.xml']!).includes(
              manifest.snapshotId,
            ),
          )
          const xlsxName = manifest.files.find((f) => f.name.endsWith('.xlsx'))!.name
          const info = await readSheet(Buffer.from(files[xlsxName]!), 'Thông tin')
          assert.equal(info.find((r) => r[0] === 'Mã snapshot')?.[1], manifest.snapshotId)

          const [audit] = await db<
            { metadata: Record<string, unknown> }[]
          >`SELECT metadata FROM audit_logs WHERE action='training.export.zip.prepared' AND resource_id=${p.id}`
          assert.deepEqual(audit!.metadata, {
            format: 'ZIP',
            rowCount: 1,
            sha256: sha(res.rawPayload),
            size: res.rawPayload.length,
            snapshotId: manifest.snapshotId,
            templateVersion: 'training-minutes-v3',
            manifestSha256: res.headers['x-export-manifest-sha256'],
          })

          const classSheet = await app.inject({
            method: 'POST',
            payload: {},
            url: url.replace('/export.zip', '/class-sheet.xlsx'),
            headers: { cookie: 'user_session=' + token, origin: env.corsOrigin },
            remoteAddress: '127.0.5.' + ip++,
          })
          assert.equal(classSheet.statusCode, 200, classSheet.body)
          assert.match(classSheet.headers['content-type'] as string, /spreadsheetml/)
          assert.equal(classSheet.headers['x-export-template-version'], 'class-sheet-v2')
          const sheet = await readSheet(classSheet.rawPayload, 'Bảng điểm lớp')
          assert.ok(sheet.some((r) => r[1] === 'S9001' && r[4] !== null))
          const [classAudit] = await db<
            { metadata: Record<string, unknown> }[]
          >`SELECT metadata FROM audit_logs WHERE action='training.export.class-sheet.prepared' AND resource_id=${p.id}`
          assert.deepEqual(classAudit!.metadata, {
            format: 'CLASS_SHEET',
            rowCount: 1,
            sha256: sha(classSheet.rawPayload),
            size: classSheet.rawPayload.length,
            snapshotId: classSheet.headers['x-export-snapshot-id'],
            templateVersion: 'class-sheet-v2',
          })

          failConvert = true
          const failed = await request()
          assert.equal(failed.statusCode, 503)
          assert.equal(failed.headers['x-export-sha256'], undefined)
          const [count] = await db<
            { n: number }[]
          >`SELECT count(*)::integer AS n FROM audit_logs WHERE action='training.export.zip.prepared' AND resource_id=${p.id}`
          assert.equal(count!.n, 1)
        } finally {
          await app.close()
        }
      },
    )

    await t.test(
      'client disconnect during PDF conversion leaves the server healthy and releases the slot',
      async () => {
        const { p, d } = await fixture()
        await repo.act(advisor, d.id, 'ADVISOR_SIGNED', input())
        await repo.act(faculty, d.id, 'FACULTY_APPROVED', input(1, false))
        let started!: () => void
        const converting = new Promise<void>((resolve) => (started = resolve))
        let conversions = 0
        const exporter = new TrainingExportService(
          repo,
          createTrainingExportWorkbook,
          createTrainingMinutesDocx,
          {
            convert: async () => {
              conversions++
              started()
              await new Promise((resolve) => setTimeout(resolve, 400))
              return Buffer.from('%PDF-1.7 synthetic slow %%EOF')
            },
          },
        )
        const app = buildApp({
          trainingReviewService: service,
          trainingService: points,
          trainingExportService: exporter,
        })
        const address = await app.listen({ host: '127.0.0.1', port: 0 })
        const token = app.jwt.sign(
          {
            sub: advisor,
            username: 'test',
            roles: ['ACADEMIC_ADVISOR', 'STUDENT'],
            portal: 'user',
            mustChangePassword: false,
            iss: JWT_ISSUER,
            aud: USER_JWT_AUDIENCE,
          },
          { expiresIn: '5m' },
        )
        const call = (signal?: AbortSignal) =>
          fetch(address + '/api/v1/user/training-reviews/periods/' + p.id + '/minutes.pdf', {
            method: 'POST',
            body: '{}',
            signal: signal ?? null,
            headers: {
              cookie: 'user_session=' + token,
              origin: env.corsOrigin,
              'content-type': 'application/json',
            },
          })
        try {
          const abort = new AbortController()
          const pending = call(abort.signal)
          await converting
          abort.abort()
          await assert.rejects(pending, { name: 'AbortError' })
          // Let the abandoned task finish; the per-account slot must then be free again.
          await new Promise((resolve) => setTimeout(resolve, 600))
          const next = await call()
          assert.equal(next.status, 200)
          assert.equal((await next.arrayBuffer()).byteLength > 0, true)
          assert.equal(conversions, 2)
        } finally {
          await app.close()
        }
      },
    )

    await t.test(
      'advisor, return, new confirmation and faculty approval preserve original and frozen receipts',
      async () => {
        const { p, d } = await fixture(),
          original = await repo.detail(student, d.id, true)
        assert.equal(original.state, 'WAITING_ADVISOR')
        assert.equal(original.totalPoints, 15)
        const first = await service.act(advisor, d.id, 'ADVISOR_SIGNED', input())
        assert.equal(first.state, 'WAITING_FACULTY')
        assert.equal(first.decisions[0]!.totalPoints, 13)
        const returned = await service.act(faculty, d.id, 'FACULTY_RETURNED', input(1, false))
        assert.equal(returned.state, 'RETURNED_TO_ADVISOR')
        const second = await service.act(advisor, d.id, 'ADVISOR_SIGNED', input(2))
        assert.equal(second.revision, 3)
        const final = await service.act(faculty, d.id, 'FACULTY_APPROVED', input(3, false))
        assert.equal(final.state, 'APPROVED')
        assert.equal(final.revision, 4)
        assert.equal(final.decisions.length, 4)
        assert.equal(final.declarationSha256, original.declarationSha256)
        assert.deepEqual(final.answers, answers)
        assert.equal(final.totalPoints, 15)
        assert.equal(final.decisions[3]!.parentDecisionId, second.decisions[2]!.id)
        assert.equal(final.decisions[3]!.technicalSignatureStatus, 'NOT_VERIFIED')
        assert.equal(final.decisions[3]!.legalEffect, false)
        await assert.rejects(repo.act(advisor, d.id, 'ADVISOR_SIGNED', input(4)), status(409))
        await assert.rejects(
          db`UPDATE training_review_decisions SET comment='tamper' WHERE declaration_id=${d.id}`,
          pg('23514'),
        )
        await assert.rejects(
          db`DELETE FROM training_review_decisions WHERE declaration_id=${d.id}`,
          pg('23514'),
        )
        await pointRepo.changePeriod(admin, p.id, 2, 'CLOSE')
        assert.equal((await repo.detail(student, d.id, true)).state, 'APPROVED')
        await db`UPDATE users SET full_name='Tên hiện tại' WHERE id=${advisor}`
        assert.notEqual(
          (await repo.detail(faculty, d.id)).decisions[0]!.actor.fullName,
          'Tên hiện tại',
        )
        const [audit] =
          await db`SELECT count(*)::integer AS n FROM audit_logs WHERE action LIKE 'training.review.%' AND metadata->>'declarationId'=${d.id}`
        assert.equal(audit!.n, 4)
      },
    )
    await t.test(
      'current assignment, role, permission and scope are all required; admin cannot substitute',
      async () => {
        const { d } = await fixture()
        await assert.rejects(repo.detail(admin, d.id), status(403))
        await assert.rejects(repo.detail(outsider, d.id), status(404))
        assert.equal((await repo.periods(outsider)).items.length, 0)
        await db`UPDATE academic_advisor_assignments SET valid_to=now()-interval '1 hour' WHERE advisor_user_id=${advisor}`
        await assert.rejects(repo.detail(advisor, d.id), status(404))
        await db`UPDATE academic_advisor_assignments SET valid_to=NULL WHERE advisor_user_id=${advisor}`
        await db`DELETE FROM role_permissions WHERE role_id=(SELECT id FROM roles WHERE code='ACADEMIC_ADVISOR') AND permission_id=(SELECT id FROM permissions WHERE code='training_point.review')`
        await assert.rejects(repo.detail(advisor, d.id), status(403))
        await db`INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.code='ACADEMIC_ADVISOR' AND p.code='training_point.review'`
        await db`DELETE FROM user_role_scopes WHERE user_id=${advisor}`
        await assert.rejects(repo.detail(advisor, d.id), status(404))
        await grant(advisor, 'ACADEMIC_ADVISOR', classScope!.id)
        await db`UPDATE academic_classes SET faculty_id=${foreignFac} WHERE id=${clazz}`
        await assert.rejects(repo.detail(faculty, d.id), status(404))
        await db`UPDATE academic_classes SET faculty_id=${fac} WHERE id=${clazz}`
        await db`UPDATE users SET status='INACTIVE' WHERE id=${advisor}`
        await assert.rejects(repo.detail(advisor, d.id), status(403))
        await db`UPDATE users SET status='ACTIVE' WHERE id=${advisor}`
      },
    )
    await t.test(
      'cannot bypass advisor stage, approve oneself or combine two roles on one review',
      async () => {
        const { d } = await fixture()
        await assert.rejects(
          repo.act(faculty, d.id, 'FACULTY_APPROVED', input(0, false)),
          status(409),
        )
        await db`UPDATE academic_advisor_assignments SET status='INACTIVE' WHERE advisor_user_id=${advisor}`
        await db`UPDATE academic_advisor_assignments SET status='ACTIVE' WHERE advisor_user_id=${dual}`
        await repo.act(dual, d.id, 'ADVISOR_SIGNED', input())
        const detail = await repo.detail(dual, d.id)
        assert.equal(detail.canFacultyDecide, false)
        await assert.rejects(repo.act(dual, d.id, 'FACULTY_APPROVED', input(1, false)), status(409))
        await db`UPDATE academic_advisor_assignments SET status='INACTIVE' WHERE advisor_user_id=${dual}`
        await db`UPDATE academic_advisor_assignments SET status='ACTIVE' WHERE advisor_user_id=${advisor}`
        await grant(student, 'FACULTY_REVIEWER', facultyScope!.id)
        assert.equal((await repo.detail(student, d.id)).canFacultyDecide, false)
        await assert.rejects(
          repo.act(student, d.id, 'FACULTY_APPROVED', input(1, false)),
          status(409),
        )
        await db`DELETE FROM user_roles WHERE user_id=${student} AND role_id=(SELECT id FROM roles WHERE code='FACULTY_REVIEWER')`
      },
    )
    await t.test(
      'retries bind complete input and stale/concurrent decisions cannot duplicate',
      async () => {
        const { d } = await fixture(),
          first = input()
        const signed = await repo.act(advisor, d.id, 'ADVISOR_SIGNED', first)
        assert.equal((await repo.act(advisor, d.id, 'ADVISOR_SIGNED', first)).revision, 1)
        await assert.rejects(
          repo.act(advisor, d.id, 'ADVISOR_SIGNED', { ...first, comment: 'Khác' }),
          status(409),
        )
        await assert.rejects(
          repo.act(advisor, d.id, 'ADVISOR_SIGNED', { ...first, answers }),
          status(409),
        )
        const pair = await Promise.allSettled([
          repo.act(faculty, d.id, 'FACULTY_APPROVED', input(signed.revision, false)),
          repo.act(faculty, d.id, 'FACULTY_RETURNED', input(signed.revision, false)),
        ])
        assert.equal(pair.filter((x) => x.status === 'fulfilled').length, 1)
        assert.equal((await repo.detail(advisor, d.id)).revision, 2)
      },
    )
    await t.test('audit failure rolls back decision and allows a clean retry', async () => {
      const { d } = await fixture()
      await db.unsafe(
        `CREATE FUNCTION s9_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action LIKE 'training.review.%' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`,
      )
      await db.unsafe(
        'CREATE TRIGGER s9_fail_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION s9_fail_audit()',
      )
      try {
        await assert.rejects(repo.act(advisor, d.id, 'ADVISOR_SIGNED', input()), pg('P0001'))
        assert.equal((await repo.detail(advisor, d.id)).revision, 0)
      } finally {
        await db.unsafe('DROP TRIGGER s9_fail_audit ON audit_logs')
        await db.unsafe('DROP FUNCTION s9_fail_audit()')
      }
      assert.equal((await repo.act(advisor, d.id, 'ADVISOR_SIGNED', input())).revision, 1)
    })
    await t.test('database guards reject a corrupted receipt hash atomically', async () => {
      const { d } = await fixture()
      await db.unsafe(
        `CREATE FUNCTION s9_corrupt_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.payload_sha256:=repeat('0',64); RETURN NEW; END $$`,
      )
      await db.unsafe(
        'CREATE TRIGGER a_s9_corrupt_receipt BEFORE INSERT ON training_review_decisions FOR EACH ROW EXECUTE FUNCTION s9_corrupt_receipt()',
      )
      try {
        await assert.rejects(repo.act(advisor, d.id, 'ADVISOR_SIGNED', input()), pg('23514'))
        assert.equal((await repo.detail(advisor, d.id)).revision, 0)
      } finally {
        await db.unsafe('DROP TRIGGER a_s9_corrupt_receipt ON training_review_decisions')
        await db.unsafe('DROP FUNCTION s9_corrupt_receipt()')
      }
    })
    await t.test(
      'a transferred student retains own result and review authority follows the original period class',
      async () => {
        const { d } = await fixture()
        await db`UPDATE student_profiles SET class_id=${foreignClass} WHERE user_id=${student}`
        try {
          assert.equal((await repo.detail(student, d.id, true)).student.classCode, 'S9CLASS')
          assert.equal(
            (await repo.act(advisor, d.id, 'ADVISOR_SIGNED', input())).state,
            'WAITING_FACULTY',
          )
          await assert.rejects(repo.detail(outsider, d.id), status(404))
        } finally {
          await db`UPDATE student_profiles SET class_id=${clazz} WHERE user_id=${student}`
        }
      },
    )
    await t.test(
      'advisor cannot award positive points without required evidence in the frozen submission',
      async () => {
        const { d } = await fixture(false, true)
        await assert.rejects(repo.act(advisor, d.id, 'ADVISOR_SIGNED', input()), status(400))
        assert.equal((await repo.detail(advisor, d.id)).revision, 0)
        const zero = input()
        zero.answers = { ...assessed, A: { points: 0, note: '' } }
        assert.equal(
          (await repo.act(advisor, d.id, 'ADVISOR_SIGNED', zero)).state,
          'WAITING_FACULTY',
        )
      },
    )
    await t.test(
      'private evidence bytes, tampering and rights revoked during read are enforced',
      async () => {
        const { d } = await fixture(true),
          file = d.files[0]!
        assert.deepEqual((await service.download(advisor, d.id, file.id)).bytes, pdf)
        const [record] = await db`SELECT storage_key FROM training_evidence WHERE id=${file.id}`
        const key = record!.storage_key as string
        blobs.delete(key)
        const unavailable = (e: unknown) =>
          e instanceof SubmissionError &&
          e.statusCode === 409 &&
          e.code === 'TRAINING_REVIEW_FILE_UNAVAILABLE'
        await assert.rejects(service.download(advisor, d.id, file.id), unavailable)
        await assert.rejects(service.act(advisor, d.id, 'ADVISOR_SIGNED', input()), unavailable)
        assert.equal((await repo.detail(advisor, d.id)).revision, 0)
        blobs.set(key, Buffer.from('corrupt'))
        await assert.rejects(service.act(advisor, d.id, 'ADVISOR_SIGNED', input()), status(409))
        assert.equal((await repo.detail(advisor, d.id)).revision, 0)
        blobs.set(key, pdf)
        beforeRead = async () => {
          await db`UPDATE academic_advisor_assignments SET status='INACTIVE' WHERE advisor_user_id=${advisor}`
        }
        try {
          await assert.rejects(service.download(advisor, d.id, file.id), status(404))
        } finally {
          beforeRead = undefined
          await db`UPDATE academic_advisor_assignments SET status='ACTIVE' WHERE advisor_user_id=${advisor}`
        }
      },
    )
    await t.test(
      'class aggregate counts only submitted data and keyset pages do not lose students',
      async () => {
        const { p, d } = await fixture()
        for (let i = 0; i < 27; i++) {
          const u = randomUUID()
          await db`INSERT INTO users(id,username,full_name,status,must_change_password) VALUES(${u},${'s9-page-' + i},'Sinh viên giả định','ACTIVE',false)`
          await grant(u, 'STUDENT', global!.id)
          await db`INSERT INTO student_profiles(user_id,class_id,student_code) VALUES(${u},${clazz},${'PAGE' + i})`
          let row = await pointRepo.start(u, p.id)
          row = await pointRepo.save(u, row.id, row.revision, answers)
          await pointRepo.submit(u, row.id, row.revision, randomUUID())
        }
        await repo.act(advisor, d.id, 'ADVISOR_SIGNED', input())
        await repo.act(faculty, d.id, 'FACULTY_APPROVED', input(1, false))
        const one = await repo.queue(advisor, p.id),
          two = await repo.queue(advisor, p.id, one.nextCursor ?? undefined)
        assert.equal(one.items.length, 25)
        assert.equal(two.items.length, 3)
        assert.equal(new Set([...one.items, ...two.items].map((x) => x.id)).size, 28)
        assert.equal(one.summary.submitted, 28)
        assert.equal(one.summary.approved, 1)
        assert.equal(one.summary.approvedTotalPoints, 13)
        assert.equal(one.summary.approvedAveragePoints, 13)
        assert.equal((await repo.queue(advisor, p.id, undefined, 'APPROVED')).items.length, 1)
        await assert.rejects(repo.queue(outsider, p.id), status(404))
      },
    )
    await t.test('queue rows and summary share a snapshot during concurrent approval', async () => {
      const { p, d } = await fixture()
      await repo.act(advisor, d.id, 'ADVISOR_SIGNED', input())
      let approvedBetweenReads = false
      const concurrentDb = new Proxy(db, {
        get(target, property, receiver) {
          if (property !== 'begin') return Reflect.get(target, property, receiver) as unknown
          return (options: string, fn: (tx: TransactionSql) => Promise<unknown>) =>
            target.begin(options, (tx) =>
              fn(
                new Proxy(tx, {
                  apply(query, context, args) {
                    const sql = (args[0] as TemplateStringsArray).join('?')
                    if (sql.includes('AS submitted,')) {
                      return (async () => {
                        await repo.act(faculty, d.id, 'FACULTY_APPROVED', input(1, false))
                        approvedBetweenReads = true
                        return Reflect.apply(query, context, args) as unknown
                      })()
                    }
                    return Reflect.apply(query, context, args) as unknown
                  },
                }),
              ),
            )
        },
      })
      const result = await new TrainingReviewRepository(concurrentDb).queue(advisor, p.id)
      assert.equal(approvedBetweenReads, true)
      assert.equal(result.items[0]!.state, 'WAITING_FACULTY')
      assert.equal(result.summary.waitingFaculty, 1)
      assert.equal(result.summary.approved, 0)
      assert.equal((await repo.queue(advisor, p.id)).summary.approved, 1)
    })
    await t.test(
      'student owns result while drafts and foreign students remain private',
      async () => {
        const { d } = await fixture()
        assert.equal((await repo.detail(student, d.id, true)).revision, 0)
        await assert.rejects(repo.detail(other, d.id, true), status(404))
        const p = await pointRepo.createPeriod(admin, {
          classId: clazz,
          academicYear: `${year}-${++year}`,
          semester: '1',
          name: 'Nháp',
          policyLabel: 'Giả định',
          startsAt: new Date(Date.now() - 60000).toISOString(),
          endsAt: new Date(Date.now() + 3600000).toISOString(),
          criteria: demoCriteria(),
        })
        await pointRepo.changePeriod(admin, p.id, 1, 'OPEN')
        const draft = await pointRepo.start(student, p.id)
        await assert.rejects(repo.detail(advisor, draft.id), status(404))
        assert.equal((await repo.queue(advisor, p.id)).summary.submitted, 0)
      },
    )
    await t.test(
      'HTTP rejects wrong audience, missing Origin, coercion, excess fields and lost rights with no-store',
      async () => {
        const app = buildApp({ trainingReviewService: service, trainingService: points })
        await app.ready()
        const { d } = await fixture()
        const cookie = (user = advisor, portal: 'user' | 'admin' = 'user') =>
          portal +
          '_session=' +
          app.jwt.sign(
            {
              sub: user,
              username: 'fake',
              roles: portal === 'admin' ? ['SYSTEM_ADMIN'] : ['ACADEMIC_ADVISOR', 'STUDENT'],
              portal,
              mustChangePassword: false,
              iss: JWT_ISSUER,
              aud: portal === 'admin' ? ADMIN_JWT_AUDIENCE : USER_JWT_AUDIENCE,
            },
            { expiresIn: '5m' },
          )
        const path = '/api/v1/user/training-reviews/' + d.id
        try {
          for (const headers of [{}, { cookie: cookie(admin, 'admin') }]) {
            const res = await app.inject({ url: path, headers })
            assert.equal(res.statusCode, 401)
            assert.match(res.headers['cache-control'] as string, /no-store/)
          }
          assert.equal(
            (
              await app.inject({
                url: '/api/v1/user/training-declarations/' + d.id + '/review',
                headers: { cookie: cookie(other) },
              })
            ).statusCode,
            404,
          )
          const post = (payload: unknown, origin: string | undefined = env.corsOrigin) =>
            app.inject({
              method: 'POST',
              url: path + '/advisor-sign',
              headers: { cookie: cookie(), ...(origin ? { origin } : {}) },
              payload: payload as object,
            })
          assert.equal((await post(input(), undefined)).statusCode, 200)
          const second = await fixture(),
            url = '/api/v1/user/training-reviews/' + second.d.id + '/advisor-sign'
          for (const payload of [
            { ...input(), confirmed: false },
            { ...input(), expectedRevision: '0' },
            { ...input(), extra: 'no' },
            { ...input(), answers: { ...assessed, A: { points: '8', note: 'a' } } },
            { ...input(), answers: { ...assessed, A: { points: null, note: 'a' } } },
          ]) {
            const res = await app.inject({
              method: 'POST',
              url,
              headers: { cookie: cookie(), origin: env.corsOrigin },
              payload,
            })
            assert.equal(res.statusCode, 400, res.body)
            assert.match(res.headers['cache-control'] as string, /no-store/)
          }
          for (const origin of ['https://foreign.invalid', ''])
            assert.equal(
              (
                await app.inject({
                  method: 'POST',
                  url,
                  headers: { cookie: cookie(), ...(origin ? { origin } : {}) },
                  payload: input(),
                })
              ).statusCode,
              403,
            )
          const large = input()
          large.comment = 'ệ'.repeat(2000)
          large.answers = structuredClone(assessed)
          for (const a of Object.values(large.answers)) a.note = 'ệ'.repeat(2000)
          assert.ok(Buffer.byteLength(JSON.stringify(large), 'utf8') > 32768)
          const largeResponse = await app.inject({
            method: 'POST',
            url,
            headers: { cookie: cookie(), origin: env.corsOrigin },
            payload: large,
          })
          assert.equal(largeResponse.statusCode, 200)
          await db`UPDATE academic_advisor_assignments SET status='INACTIVE' WHERE advisor_user_id=${advisor}`
          assert.equal(
            (await app.inject({ url: path, headers: { cookie: cookie() } })).statusCode,
            404,
          )
          await db`UPDATE academic_advisor_assignments SET status='ACTIVE' WHERE advisor_user_id=${advisor}`
        } finally {
          await app.close()
        }
      },
    )
    // ADR 0028 — class monitor step, roster, audit and appointment.
    const submitOther = async (p: { id: string }) => {
      let d = await pointRepo.start(other, p.id)
      d = await pointRepo.save(other, d.id, d.revision, answers)
      return points.submit(other, d.id, d.revision, randomUUID())
    }
    await t.test(
      'monitor confirms first without changing scores; advisor cannot skip it silently',
      async () => {
        const { p } = await fixture()
        const d = await submitOther(p)
        const before = await repo.detail(advisor, d.id)
        assert.equal(before.state, 'WAITING_MONITOR')
        assert.equal(before.canAdvisorSign, false)
        assert.equal(before.canAdvisorBypass, true)
        await assert.rejects(repo.act(advisor, d.id, 'ADVISOR_SIGNED', input()), status(409))
        // The monitor cannot sign as advisor, and the student cannot confirm its own form.
        await assert.rejects(repo.act(student, d.id, 'ADVISOR_SIGNED', input()), status(403))
        await assert.rejects(
          repo.act(other, d.id, 'MONITOR_CONFIRMED', input(0, false)),
          status(403),
        )
        const confirmed = await repo.act(student, d.id, 'MONITOR_CONFIRMED', input(0, false))
        assert.equal(confirmed.state, 'WAITING_ADVISOR')
        const decision = confirmed.decisions.at(-1)!
        assert.equal(decision.action, 'MONITOR_CONFIRMED')
        assert.equal(decision.actor.roleCode, 'CLASS_MONITOR')
        assert.deepEqual(decision.answers, d.answers)
        assert.equal(decision.totalPoints, d.totalPoints)
        await assert.rejects(
          repo.act(student, d.id, 'MONITOR_CONFIRMED', input(1, false)),
          status(409),
        )
        const signed = await repo.act(advisor, d.id, 'ADVISOR_SIGNED', input(1))
        assert.equal(signed.state, 'WAITING_FACULTY')
        // The database itself refuses a monitor decision that alters the student's scores.
        await assert.rejects(
          db`INSERT INTO training_review_decisions(id,declaration_id,revision,action,actor_user_id,actor_snapshot,assessed_answers,total_points,comment,declaration_sha256,request_id,input_revision,payload,payload_sha256) VALUES(${randomUUID()},${d.id},3,'MONITOR_CONFIRMED',${student},'{}'::jsonb,${JSON.stringify(assessed)}::text::jsonb,13,'x',${'a'.repeat(64)},${randomUUID()},2,'{}'::jsonb,${'a'.repeat(64)})`,
          pg('23514'),
        )
        // The monitor's own declaration goes straight to the advisor.
        const own = await fixture()
        assert.equal((await repo.detail(advisor, own.d.id)).state, 'WAITING_ADVISOR')
        assert.equal((await repo.detail(student, own.d.id)).canMonitorConfirm, false)
      },
    )
    await t.test('advisor bypasses the monitor step with a recorded reason', async () => {
      const { p } = await fixture()
      const d = await submitOther(p)
      await assert.rejects(
        repo.act(student, d.id, 'MONITOR_BYPASSED', input(0, false)),
        status(403),
      )
      const bypassed = await repo.act(advisor, d.id, 'MONITOR_BYPASSED', {
        ...input(0, false),
        comment: 'Lớp trưởng nghỉ ốm',
      })
      assert.equal(bypassed.state, 'WAITING_ADVISOR')
      assert.equal(bypassed.decisions.at(-1)!.comment, 'Lớp trưởng nghỉ ốm')
      assert.equal(bypassed.decisions.at(-1)!.actor.roleCode, 'ACADEMIC_ADVISOR')
      const [audit] = await db<
        { n: number }[]
      >`SELECT count(*)::integer AS n FROM audit_logs WHERE action='training.review.monitor_bypassed' AND metadata->>'declarationId'=${d.id}`
      assert.equal(audit!.n, 1)
    })
    await t.test(
      'monitor roster shows contact data and date of birth; every monitor read is audited for the advisor',
      async () => {
        const { p } = await fixture(true)
        const d = await submitOther(p)
        await db`UPDATE student_profiles SET date_of_birth='2003-02-10',cohort_year=2021 WHERE user_id=${other}`
        const before = await db<
          { n: number }[]
        >`SELECT count(*)::integer AS n FROM audit_logs WHERE action LIKE 'training.monitor.%'`
        const roster = await repo.roster(student, p.id)
        assert.equal(roster.canAppointMonitor, false)
        assert.equal(roster.monitor?.userId, student)
        const row = roster.students.find((x) => x.userId === other)!
        assert.equal(row.dateOfBirth, '2003-02-10')
        assert.equal(row.cohortYear, 2021)
        assert.equal(row.declarationState, 'SUBMITTED')
        await repo.detail(student, d.id)
        // Advisor reads are not audited as monitor reads.
        await repo.roster(advisor, p.id)
        await repo.detail(advisor, d.id)
        const after = await db<
          { action: string; classId: string }[]
        >`SELECT action,metadata->>'classId' AS "classId" FROM audit_logs WHERE action LIKE 'training.monitor.%' ORDER BY occurred_at DESC LIMIT 2`
        const [count] = await db<
          { n: number }[]
        >`SELECT count(*)::integer AS n FROM audit_logs WHERE action LIKE 'training.monitor.%'`
        assert.equal(count!.n - before[0]!.n, 2)
        assert.deepEqual(after.map((a) => a.action).sort(), [
          'training.monitor.declaration_viewed',
          'training.monitor.roster_viewed',
        ])
        assert.ok(after.every((a) => a.classId === clazz))
        const log = await repo.monitorAudit(advisor, p.id)
        assert.ok(log.items.some((i) => i.action === 'training.monitor.roster_viewed'))
        assert.doesNotMatch(JSON.stringify(log), /2003-02-10/)
        await assert.rejects(repo.monitorAudit(student, p.id), status(403))
        await assert.rejects(repo.roster(outsider, p.id), status(404))
      },
    )
    await t.test(
      'monitor HTTP exports: class sheet and printed form allowed, detailed exports refused',
      async () => {
        const { p } = await fixture()
        const d = await submitOther(p)
        await repo.act(student, d.id, 'MONITOR_CONFIRMED', input(0, false))
        await repo.act(advisor, d.id, 'ADVISOR_SIGNED', input(1))
        await repo.act(faculty, d.id, 'FACULTY_APPROVED', input(2, false))
        const exporter = new TrainingExportService(
          repo,
          createTrainingExportWorkbook,
          createTrainingMinutesDocx,
          { convert: async () => Buffer.from('%PDF-1.7 synthetic form %%EOF') },
        )
        const app = buildApp({
          trainingReviewService: service,
          trainingService: points,
          trainingExportService: exporter,
        })
        await app.ready()
        const token = app.jwt.sign(
          {
            sub: student,
            username: 'test',
            roles: ['STUDENT', 'CLASS_MONITOR'],
            portal: 'user',
            mustChangePassword: false,
            iss: JWT_ISSUER,
            aud: USER_JWT_AUDIENCE,
          },
          { expiresIn: '5m' },
        )
        let ip = 1
        const post = (path: string) =>
          app.inject({
            method: 'POST',
            payload: {},
            url: '/api/v1/user/training-reviews/periods/' + p.id + '/' + path,
            headers: { cookie: 'user_session=' + token, origin: env.corsOrigin },
            remoteAddress: '127.0.6.' + ip++,
          })
        try {
          for (const path of ['export.xlsx', 'minutes.docx', 'export.zip'])
            assert.equal((await post(path)).statusCode, 404, path)
          const sheet = await post('class-sheet.xlsx')
          assert.equal(sheet.statusCode, 200, sheet.body)
          const form = await post('declarations/' + d.id + '/form.docx')
          assert.equal(form.statusCode, 200, form.body)
          assert.equal(form.headers['x-export-template-version'], 'training-form-v1')
          assert.ok(
            strFromU8(unzipSync(form.rawPayload)['word/document.xml']!).includes('Lớp trưởng'),
          )
          const pdf = await post('declarations/' + d.id + '/form.pdf')
          assert.equal(pdf.statusCode, 200, pdf.body)
          // A declaration that is not faculty-approved in this period cannot be printed.
          const pending = await submitOther((await fixture()).p)
          assert.equal((await post('declarations/' + pending.id + '/form.docx')).statusCode, 404)
          const [audit] = await db<
            { metadata: { declarationId: string; format: string } }[]
          >`SELECT metadata FROM audit_logs WHERE action='training.export.form.prepared' AND resource_id=${p.id} ORDER BY occurred_at LIMIT 1`
          assert.equal(audit!.metadata.declarationId, d.id)
          assert.equal(audit!.metadata.format, 'FORM')
          const log = await repo.monitorAudit(advisor, p.id)
          assert.ok(log.items.some((i) => i.action === 'training.export.form.prepared'))
        } finally {
          await app.close()
        }
      },
    )
    await t.test(
      'advisor replaces the monitor: the old term ends at once and only class students qualify',
      async () => {
        const { p } = await fixture()
        const d = await submitOther(p)
        await assert.rejects(repo.appointMonitor({ ...actorOf(student) }, p.id, other), status(403))
        await assert.rejects(repo.appointMonitor(actorOf(advisor), p.id, outsider), status(400))
        try {
          await repo.appointMonitor(actorOf(advisor), p.id, other)
          // The previous monitor lost every right at once: the declaration is no longer visible (404).
          await assert.rejects(
            repo.act(student, d.id, 'MONITOR_CONFIRMED', input(0, false)),
            status(404),
          )
          assert.equal((await repo.detail(advisor, d.id)).state, 'WAITING_ADVISOR')
          const roster = await repo.roster(advisor, p.id)
          assert.equal(roster.monitor?.userId, other)
          const [audit] = await db<
            { n: number }[]
          >`SELECT count(*)::integer AS n FROM audit_logs WHERE action='training.monitor.appointed' AND metadata->>'monitorUserId'=${other}`
          assert.equal(audit!.n, 1)
        } finally {
          await repo.appointMonitor(actorOf(advisor), p.id, student)
        }
        assert.equal((await repo.roster(advisor, p.id)).monitor?.userId, student)
      },
    )
  } finally {
    await q?.end()
    await control.unsafe('DROP DATABASE IF EXISTS "' + name + '" WITH (FORCE)')
    await control.end()
  }
})
