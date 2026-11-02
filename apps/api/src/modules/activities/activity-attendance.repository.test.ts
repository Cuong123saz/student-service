import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import postgres from 'postgres'
import { buildApp } from '../../app.js'
import { env } from '../../config/env.js'
import { JWT_ISSUER, USER_JWT_AUDIENCE } from '../auth/auth.constants.js'
import { ClubRepository } from '../clubs/club.repository.js'
import { SubmissionError } from '../submissions/submission.types.js'
import { ActivityAttendanceRepository } from './activity-attendance.repository.js'
import { rotatingCheckinCode, staticCheckinCode } from './activity-checkin.js'
import { ActivityRegistrationRepository } from './activity-registration.repository.js'
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
/** Synthetic JPEG structure with an EXIF/GPS segment; the server never decodes pixels. */
const jpeg = (tag = 'x') =>
  Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    seg(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'binary')),
    seg(0xe1, Buffer.from('Exif\0\0GPS=21.0285,105.8542', 'binary')),
    seg(0xdb, Buffer.alloc(65, 1)),
    seg(0xda, Buffer.alloc(10, 2)),
    Buffer.from(tag),
    Buffer.from([0xff, 0xd9]),
  ])

test('ADR 0032 attendance runs on an isolated synthetic database', async (t) => {
  const url = new URL(process.env.DATABASE_URL ?? 'http://invalid')
  assert.equal(url.port, '5434')
  assert.equal(url.pathname, '/student_service_test')
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname))
  const name = 'attendance_test_' + randomUUID().replaceAll('-', ''),
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
      leader = randomUUID(),
      fac = randomUUID(),
      clazz = randomUUID()
    await db`INSERT INTO faculties(id,code,name) VALUES(${fac},'TF1','Khoa 1')`
    await db`INSERT INTO academic_classes(id,faculty_id,code,name) VALUES(${clazz},${fac},'TF1A','Lớp A')`
    const [global] = await db<
      { id: string }[]
    >`SELECT id FROM authorization_scopes WHERE scope_type='GLOBAL'`
    await db`INSERT INTO roles(code,name,is_system) VALUES('STUDENT','STUDENT',true) ON CONFLICT DO NOTHING`
    const user = async (id: string, username: string, role: string, student = false) => {
      await db`INSERT INTO users(id,username,full_name,status,must_change_password) VALUES(${id},${username},${'Người giả định ' + username},'ACTIVE',false)`
      await db`INSERT INTO user_roles(user_id,role_id) SELECT ${id},id FROM roles WHERE code=${role}`
      await db`INSERT INTO user_role_scopes(user_id,role_id,scope_id) SELECT ${id},id,${global!.id} FROM roles WHERE code=${role}`
      if (student)
        await db`INSERT INTO student_profiles(user_id,class_id,student_code,cohort_year) VALUES(${id},${clazz},${username},2021)`
    }
    await user(ctsv, 't-ctsv', 'STUDENT_AFFAIRS')
    await user(pdt, 't-pdt', 'TRAINING_OFFICE')
    await user(leader, 't-leader', 'STUDENT', true)
    const students: string[] = []
    for (let i = 0; i < 4; i++) {
      const id = randomUUID()
      await user(id, 't-s' + i, 'STUDENT', true)
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
    const blobs = new Map<string, Buffer>()
    const storage = {
      put: async (bytes: Buffer) => {
        const k = randomUUID()
        blobs.set(k, Buffer.from(bytes))
        return k
      },
      read: async (k: string) => {
        if (!blobs.has(k)) throw new Error('missing')
        return Buffer.from(blobs.get(k)!)
      },
      remove: async (k: string) => {
        blobs.delete(k)
      },
    }
    const clubs = new ClubRepository(db),
      activities = new ActivityRepository(db),
      registrations = new ActivityRegistrationRepository(db),
      repo = new ActivityAttendanceRepository(storage, db)
    const club = await clubs.create(actorOf(ctsv), { code: 'TCLB', name: 'CLB', description: '' })
    await clubs.assignLeader(actorOf(ctsv), club.id, 't-leader')
    const hour = 3600000
    const input = (over: Partial<ActivityInput> = {}): ActivityInput => ({
      kind: 'MANDATORY',
      category: 'SCHOOL',
      title: 'Hoạt động điểm danh giả định',
      description: '',
      location: 'Hội trường',
      startsAt: new Date(Date.now() + 48 * hour).toISOString(),
      endsAt: new Date(Date.now() + 50 * hour).toISOString(),
      capacity: null,
      eligibility: { facultyIds: [], classIds: [], cohortYears: [] },
      ...over,
    })
    /** Published activity with registered students, then moved so that it is running now. */
    const running = async (who: string[], over: Partial<ActivityInput> = {}, owner = ctsv) => {
      const a = await activities.create(actorOf(owner), input(over))
      await activities.transition(actorOf(owner), a.id, 'PUBLISHED', 0, null)
      for (const id of who) await registrations.register(actorOf(id), a.id)
      await db`UPDATE activities SET starts_at=now()-interval '5 minutes',ends_at=now()+interval '1 hour',revision=revision+1 WHERE id=${a.id}`
      const [row] = await db<
        { secret: string }[]
      >`SELECT checkin_secret AS secret FROM activities WHERE id=${a.id}`
      return { id: a.id, secret: row!.secret }
    }
    const checkIn = async (a: { id: string; secret: string }, student: string) => {
      await repo.scan(actorOf(student), a.id, staticCheckinCode(a.secret))
      return repo.submitPhoto(actorOf(student), a.id, jpeg(student))
    }

    await t.test('scan needs the right code, the activity window and a held seat', async () => {
      const future = await activities.create(actorOf(ctsv), input())
      await activities.transition(actorOf(ctsv), future.id, 'PUBLISHED', 0, null)
      await registrations.register(actorOf(s(0)), future.id)
      const [f] = await db<
        { secret: string }[]
      >`SELECT checkin_secret AS secret FROM activities WHERE id=${future.id}`
      await assert.rejects(
        repo.scan(actorOf(s(0)), future.id, staticCheckinCode(f!.secret)),
        is('ACTIVITY_CHECKIN_CLOSED', 409),
      )
      const a = await running([s(0)])
      await assert.rejects(
        repo.scan(actorOf(s(0)), a.id, 'A'.repeat(32)),
        is('INVALID_CHECKIN_CODE', 400),
      )
      await assert.rejects(
        repo.scan(actorOf(s(1)), a.id, staticCheckinCode(a.secret)),
        is('ACTIVITY_NOT_FOUND', 404),
      )
      const scanned = await repo.scan(actorOf(s(0)), a.id, staticCheckinCode(a.secret))
      assert.equal(scanned.status, 'SCANNED')
      assert.ok(Date.parse(scanned.captureExpiresAt!) > Date.now())
      const again = await repo.scan(actorOf(s(0)), a.id, staticCheckinCode(a.secret))
      assert.equal(again.captureExpiresAt, scanned.captureExpiresAt, 'an open session is reused')
      const [n] = await db<
        { n: number }[]
      >`SELECT count(*)::integer AS n FROM activity_attendances WHERE activity_id=${a.id}`
      assert.equal(n!.n, 1)
    })

    await t.test(
      'photos are JPEG only, stripped of EXIF, accepted once inside the capture window',
      async () => {
        const a = await running([s(0), s(1)])
        await assert.rejects(
          repo.submitPhoto(actorOf(s(0)), a.id, jpeg()),
          is('ACTIVITY_ATTENDANCE_CONFLICT', 409),
        )
        await repo.scan(actorOf(s(0)), a.id, staticCheckinCode(a.secret))
        await assert.rejects(
          repo.submitPhoto(actorOf(s(0)), a.id, Buffer.from('%PDF-1.7')),
          is('INVALID_ACTIVITY_PHOTO', 400),
        )
        const sent = await repo.submitPhoto(actorOf(s(0)), a.id, jpeg())
        assert.equal(sent.status, 'PENDING_REVIEW')
        const [row] = await db<{ key: string; sha: string }[]>`
        SELECT photo_storage_key AS key,photo_sha256 AS sha FROM activity_attendances WHERE activity_id=${a.id} AND student_user_id=${s(0)}`
        const stored = blobs.get(row!.key)!
        assert.equal(stored.includes(Buffer.from('GPS')), false, 'EXIF/GPS removed before storage')
        assert.equal(createHash('sha256').update(stored).digest('hex'), row!.sha)
        const before = blobs.size
        await assert.rejects(
          repo.submitPhoto(actorOf(s(0)), a.id, jpeg()),
          is('ACTIVITY_ATTENDANCE_CONFLICT', 409),
        )
        assert.equal(blobs.size, before, 'rejected uploads leave no stored bytes')
        // An expired capture session can be reopened by scanning again.
        await repo.scan(actorOf(s(1)), a.id, staticCheckinCode(a.secret))
        await db`UPDATE activity_attendances SET capture_expires_at=now()-interval '1 second',revision=revision+1 WHERE activity_id=${a.id} AND student_user_id=${s(1)}`
        await assert.rejects(
          repo.submitPhoto(actorOf(s(1)), a.id, jpeg()),
          is('ACTIVITY_CHECKIN_EXPIRED', 409),
        )
        await repo.scan(actorOf(s(1)), a.id, staticCheckinCode(a.secret))
        assert.equal((await repo.submitPhoto(actorOf(s(1)), a.id, jpeg())).status, 'PENDING_REVIEW')
      },
    )

    await t.test(
      'rotating QR retires the printed code; only the owner configures check-in',
      async () => {
        const a = await running([s(0)])
        const d = await activities.detail(ctsv, a.id)
        await assert.rejects(
          repo.configureCheckin(actorOf(pdt), a.id, d.revision, { rotating: true }),
          (e) => is('ACTIVITY_FORBIDDEN', 403)(e) || is('ACTIVITY_NOT_FOUND', 404)(e),
        )
        const rotated = await repo.configureCheckin(actorOf(ctsv), a.id, d.revision, {
          rotating: true,
        })
        assert.equal(rotated.events[0]!.action, 'CHECKIN_MODE_CHANGED')
        await assert.rejects(
          repo.scan(actorOf(s(0)), a.id, staticCheckinCode(a.secret)),
          is('INVALID_CHECKIN_CODE', 400),
        )
        assert.equal(
          (await repo.scan(actorOf(s(0)), a.id, rotatingCheckinCode(a.secret))).status,
          'SCANNED',
        )
        const reset = await repo.configureCheckin(actorOf(ctsv), a.id, rotated.revision, {
          reset: true,
        })
        assert.equal(reset.events[0]!.action, 'CHECKIN_RESET')
        await assert.rejects(
          repo.scan(actorOf(s(0)), a.id, rotatingCheckinCode(a.secret)),
          is('INVALID_CHECKIN_CODE', 400),
        )
        const qr = await repo.qr(ctsv, a.id)
        assert.equal(qr.rotating, true)
        assert.match(qr.svg, /^<svg/)
        assert.equal(qr.svg.includes(a.secret), false)
        await assert.rejects(repo.qr(s(0), a.id), is('ACTIVITY_NOT_FOUND', 404))
      },
    )

    await t.test(
      'review issues hashed certificates; no self-review; rejection needs a reason',
      async () => {
        const a = await running([s(0), s(1), s(2)])
        for (const i of [0, 1, 2]) await checkIn(a, s(i))
        const queue = await repo.queue(ctsv, a.id)
        assert.equal(queue.summary.pending, 3)
        const entry = (i: number) => queue.items.find((x) => x.studentUserId === s(i))!
        await assert.rejects(
          repo.review(
            actorOf(ctsv),
            a.id,
            [{ id: entry(2).id, revision: entry(2).revision }],
            false,
            null,
          ),
          is('INVALID_ACTIVITY', 400),
        )
        const after = await repo.review(
          actorOf(ctsv),
          a.id,
          [0, 1].map((i) => ({ id: entry(i).id, revision: entry(i).revision })),
          true,
          null,
        )
        assert.equal(after.summary.approved, 2)
        const cert = after.items.find((x) => x.studentUserId === s(0))!.certificate!
        assert.match(cert.code, /^CN-[A-Z2-7]{12}$/)
        await repo.review(
          actorOf(ctsv),
          a.id,
          [{ id: entry(2).id, revision: entry(2).revision }],
          false,
          'Ảnh không thấy hội trường',
        )
        await assert.rejects(
          repo.review(
            actorOf(ctsv),
            a.id,
            [{ id: entry(0).id, revision: entry(0).revision }],
            true,
            null,
          ),
          is('ACTIVITY_ATTENDANCE_CONFLICT', 409),
        )
        const mine = await repo.certificates(s(0))
        assert.equal(mine.items.length, 1)
        assert.equal(mine.items[0]!.technicalSignatureStatus, 'NOT_VERIFIED')
        assert.equal(mine.items[0]!.legalEffect, false)
        assert.match(mine.items[0]!.payloadSha256, /^[0-9a-f]{64}$/)
        assert.equal((await repo.mine(s(2), a.id)).reviewNote, 'Ảnh không thấy hội trường')
        // A club leader never reviews their own attendance.
        const own = await running(
          [leader],
          { kind: 'VOLUNTARY', category: 'VOLUNTEER', clubId: club.id },
          leader,
        )
        await checkIn(own, leader)
        const e = (await repo.queue(leader, own.id)).items[0]!
        await assert.rejects(
          repo.review(actorOf(leader), own.id, [{ id: e.id, revision: e.revision }], true, null),
          is('ACTIVITY_SELF_DECISION', 403),
        )
        // Absence: after the end, a held seat without an approved attendance is absent.
        await db`UPDATE activities SET starts_at=now()-interval '3 hours',ends_at=now()-interval '1 hour',revision=revision+1 WHERE id=${a.id}`
        const roster = await registrations.roster(ctsv, a.id)
        const absent = (i: number) => roster.items.find((x) => x.studentUserId === s(i))!.absent
        assert.deepEqual([absent(0), absent(1), absent(2)], [false, false, true])
      },
    )

    await t.test('only CTSV revokes; certificates are append-only in the database', async () => {
      const a = await running([s(3)])
      await checkIn(a, s(3))
      const e = (await repo.queue(ctsv, a.id)).items[0]!
      const done = await repo.review(
        actorOf(ctsv),
        a.id,
        [{ id: e.id, revision: e.revision }],
        true,
        null,
      )
      const cert = done.items[0]!.certificate!
      await assert.rejects(repo.revoke(actorOf(pdt), cert.id, 'Thử'), is('ACTIVITY_FORBIDDEN', 403))
      await repo.revoke(actorOf(ctsv), cert.id, 'Phát hiện ảnh ghép')
      await assert.rejects(
        repo.revoke(actorOf(ctsv), cert.id, 'Lần hai'),
        is('ACTIVITY_ATTENDANCE_CONFLICT', 409),
      )
      assert.equal((await repo.certificates(s(3))).items[0]!.status, 'REVOKED')
      await assert.rejects(
        db`DELETE FROM activity_certificates WHERE id=${cert.id}`,
        /ACTIVITY_CERTIFICATE_IMMUTABLE/,
      )
      await assert.rejects(
        db`UPDATE activity_certificates SET payload_sha256=${'0'.repeat(64)} WHERE id=${cert.id}`,
        /ACTIVITY_CERTIFICATE_IMMUTABLE/,
      )
      const pending = await running([s(0)])
      await checkIn(pending, s(0))
      const p = (await repo.queue(ctsv, pending.id)).items[0]!
      await assert.rejects(
        db`INSERT INTO activity_certificates(code,activity_id,student_user_id,attendance_id,issued_by_user_id,payload_sha256)
          VALUES('CN-AAAAAAAAAAAA',${pending.id},${s(0)},${p.id},${ctsv},${'a'.repeat(64)})`,
        /ACTIVITY_CERTIFICATE_INVALID/,
      )
    })

    await t.test(
      'photo access is limited to reviewers and CTSV, audited, and purged after 90 days',
      async () => {
        const a = await running([s(1)], {}, ctsv)
        await checkIn(a, s(1))
        const e = (await repo.queue(ctsv, a.id)).items[0]!
        const photo = await repo.photo(actorOf(ctsv), a.id, e.id)
        assert.equal(photo.mimeType, 'image/jpeg')
        await assert.rejects(repo.photo(actorOf(s(2)), a.id, e.id), is('ACTIVITY_NOT_FOUND', 404))
        const [audit] = await db<{ n: number }[]>`
        SELECT count(*)::integer AS n FROM audit_logs WHERE action='activity.attendance.photo_viewed' AND resource_id=${e.id}`
        assert.equal(audit!.n, 1)
        await db`UPDATE activities SET starts_at=now()-interval '100 days',ends_at=now()-interval '99 days',revision=revision+1 WHERE id=${a.id}`
        const purged = await repo.purgeExpiredPhotos()
        assert.ok(purged.removed >= 1)
        await assert.rejects(
          repo.photo(actorOf(ctsv), a.id, e.id),
          is('ACTIVITY_PHOTO_NOT_FOUND', 404),
        )
        assert.equal((await repo.queue(ctsv, a.id)).items[0]!.hasPhoto, false)
      },
    )

    await t.test('HTTP: QR SVG, multipart photo upload and review body checks', async () => {
      const a = await running([s(2)])
      const app = buildApp({ attendanceRepository: repo })
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
      const base = '/api/v1/user/activities/'
      try {
        const svg = await app.inject({
          url: base + 'manage/' + a.id + '/checkin-qr.svg',
          headers: { cookie: cookie(ctsv, ['STUDENT_AFFAIRS']) },
          remoteAddress: '127.0.5.' + ip++,
        })
        assert.equal(svg.statusCode, 200)
        assert.match(String(svg.headers['content-type']), /^image\/svg\+xml/)
        assert.match(svg.body, /<svg/)
        const student = { cookie: cookie(s(2), ['STUDENT']), origin: env.corsOrigin }
        const scan = await app.inject({
          method: 'POST',
          url: base + a.id + '/attendance/scan',
          headers: student,
          payload: { code: staticCheckinCode(a.secret) },
          remoteAddress: '127.0.5.' + ip++,
        })
        assert.equal(scan.statusCode, 200)
        const boundary = 'x' + randomUUID()
        const form = (type: string, bytes: Buffer) =>
          Buffer.concat([
            Buffer.from(
              `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="a.jpg"\r\nContent-Type: ${type}\r\n\r\n`,
            ),
            bytes,
            Buffer.from(`\r\n--${boundary}--\r\n`),
          ])
        const upload = (type: string, bytes: Buffer) =>
          app.inject({
            method: 'POST',
            url: base + a.id + '/attendance/photo',
            headers: { ...student, 'content-type': 'multipart/form-data; boundary=' + boundary },
            payload: form(type, bytes),
            remoteAddress: '127.0.5.' + ip++,
          })
        assert.equal((await upload('image/png', jpeg())).statusCode, 400)
        const ok = await upload('image/jpeg', jpeg())
        assert.equal(ok.statusCode, 200)
        const body: { status: string } = ok.json()
        assert.equal(body.status, 'PENDING_REVIEW')
        const review = await app.inject({
          method: 'POST',
          url: base + 'manage/' + a.id + '/attendance/review',
          headers: { cookie: cookie(ctsv, ['STUDENT_AFFAIRS']), origin: env.corsOrigin },
          payload: { entries: [{ id: randomUUID(), revision: 0, extra: true }], approve: true },
          remoteAddress: '127.0.5.' + ip++,
        })
        assert.equal(review.statusCode, 400)
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
