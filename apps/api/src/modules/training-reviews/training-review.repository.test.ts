import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import postgres from 'postgres'
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
  } finally {
    await q?.end()
    await control.unsafe('DROP DATABASE IF EXISTS "' + name + '" WITH (FORCE)')
    await control.end()
  }
})
