import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import { after, afterEach, beforeEach, test } from 'node:test'
import { and, eq, like, sql } from 'drizzle-orm'
import { db, databaseClient } from '../../db/client.js'
import { env } from '../../config/env.js'
import { services } from '../../db/schema.js'
import { auditLogs } from '../audit/audit.schema.js'
import { users, roles, userRoles } from '../auth/auth.schema.js'
import {
  academicClasses,
  faculties,
  organizationalUnits,
  studentProfiles,
} from '../organizations/organization.schema.js'
import { procedureVersions } from '../procedures/procedure.schema.js'
import type { ProcedureConfig } from '../procedures/procedure.contract.js'
import { DrizzleSubmissionRepository } from './submission.repository.js'
import { SubmissionService } from './submission.service.js'
import { SubmissionError, type SubmissionActor, type DraftView } from './submission.types.js'
import { submissionFiles, submissions } from './submission.schema.js'
import { buildApp } from '../../app.js'
import { JWT_ISSUER, USER_JWT_AUDIENCE } from '../auth/auth.constants.js'
const url = new URL(process.env.DATABASE_URL ?? 'http://invalid')
if (
  url.pathname !== '/student_service_test' ||
  !['localhost', '127.0.0.1'].includes(url.hostname) ||
  url.port !== '5434'
)
  throw new Error('Tests require local student_service_test on port 5434')
async function cleanup() {
  await db.execute(sql.raw('DROP TRIGGER IF EXISTS s5t_fail_audit ON audit_logs'))
  await db.execute(sql.raw('DROP FUNCTION IF EXISTS s5t_fail_audit()'))
  await db.execute(sql.raw('TRUNCATE submission_files, submissions, procedure_versions'))
  await db.execute(sql.raw('TRUNCATE audit_logs'))
  await db.delete(users).where(like(users.username, 's5t-%'))
  await db.delete(academicClasses).where(like(academicClasses.code, 'S5T_%'))
  await db.delete(faculties).where(like(faculties.code, 'S5T_%'))
  await db.delete(services).where(like(services.code, 'S5T_%'))
  await db.delete(organizationalUnits).where(like(organizationalUnits.code, 'S5T_%'))
}
beforeEach(cleanup)
afterEach(cleanup)
after(() => databaseClient.end())
class MemoryStorage {
  files = new Map<string, Buffer>()
  async put(bytes: Buffer) {
    const key = randomUUID()
    this.files.set(key, Buffer.from(bytes))
    return key
  }
  async read(key: string) {
    const bytes = this.files.get(key)
    if (!bytes) throw new Error('Missing file')
    return bytes
  }
  async remove(key: string) {
    this.files.delete(key)
  }
}
async function fixture(mode: ProcedureConfig['processingMode'] = 'ONLINE') {
  const suffix = randomUUID(),
    userId = randomUUID(),
    otherId = randomUUID(),
    unitId = randomUUID(),
    facultyId = randomUUID(),
    classId = randomUUID()
  await db.insert(roles).values({ code: 'STUDENT', name: 'Sinh viên' }).onConflictDoNothing()
  const [role] = await db.select().from(roles).where(eq(roles.code, 'STUDENT'))
  await db.insert(users).values([
    {
      id: userId,
      username: 's5t-' + suffix,
      fullName: 'Nguyễn Minh An',
      mustChangePassword: false,
    },
    {
      id: otherId,
      username: 's5t-' + randomUUID(),
      fullName: 'Sinh viên khác',
      mustChangePassword: false,
    },
  ])
  await db.insert(userRoles).values([
    { userId, roleId: role!.id },
    { userId: otherId, roleId: role!.id },
  ])
  await db.insert(faculties).values({ id: facultyId, code: 'S5T_' + suffix, name: 'Khoa giả định' })
  await db
    .insert(academicClasses)
    .values({ id: classId, facultyId, code: 'S5T_' + suffix, name: 'Lớp giả định' })
  await db.insert(studentProfiles).values([
    { userId, classId, studentCode: 'S5T_' + suffix },
    { userId: otherId, classId, studentCode: 'S5T_' + randomUUID() },
  ])
  await db
    .insert(organizationalUnits)
    .values({ id: unitId, code: 'S5T_' + suffix, name: 'Phòng CTSV' })
  const [service] = await db
    .insert(services)
    .values({
      code: 'S5T_' + suffix,
      name: 'Thủ tục kiểm thử',
      description: 'Test',
      processingDays: 3,
    })
    .returning()
  const config: ProcedureConfig = {
    processingMode: mode,
    processingUnitId: unitId,
    processorUserId: null,
    contactInstructions: 'Hướng dẫn kiểm thử',
    fields: [
      {
        key: 'fullName',
        label: 'Họ tên',
        type: 'TEXT',
        source: 'PROFILE',
        profileKey: 'fullName',
        required: true,
        maxLength: 255,
        options: [],
      },
      {
        key: 'purpose',
        label: 'Mục đích',
        type: 'TEXTAREA',
        source: 'STUDENT_INPUT',
        profileKey: null,
        required: true,
        maxLength: 200,
        options: [],
      },
      ...(['NUMBER', 'BOOLEAN', 'DATE'] as const).map((type, index) => ({
        key: ['amount', 'agreed', 'date'][index]!,
        label: type,
        type,
        source: 'STUDENT_INPUT' as const,
        profileKey: null,
        required: false,
        maxLength: 100,
        options: [],
      })),
    ],
    attachments: [
      {
        key: 'proof',
        label: 'Minh chứng',
        required: true,
        mimeTypes: ['application/pdf', 'image/png'],
        maxFiles: 1,
        maxBytes: 1000,
      },
      {
        key: 'extraProof',
        label: 'Minh chứng bổ sung',
        required: false,
        mimeTypes: ['application/pdf'],
        maxFiles: 1,
        maxBytes: 1000,
      },
    ],
    maxTotalAttachmentBytes: 1500,
  }
  const [version] = await db
    .insert(procedureVersions)
    .values({
      serviceId: service!.id,
      ownerUnitId: unitId,
      versionNumber: 1,
      status: 'PUBLISHED',
      publishedAt: new Date(),
      config,
      createdBy: userId,
      updatedBy: userId,
    })
    .returning()
  const actor: SubmissionActor = {
    userId,
    username: 's5t-' + suffix,
    requestId: 's5t-request',
    ipAddress: null,
    userAgent: null,
  }
  const repository = new DrizzleSubmissionRepository()
  const storage = new MemoryStorage()
  const serviceUseCase = new SubmissionService(repository, storage)
  const create = () => serviceUseCase.create(actor, service!.id, version!.id)
  return {
    actor,
    otherId,
    unitId,
    classId,
    roleId: role!.id,
    serviceId: service!.id,
    version: version!,
    repository,
    storage,
    service: serviceUseCase,
    create,
  }
}
function errorCode(status: number, code?: string) {
  return (e: unknown) =>
    e instanceof SubmissionError && e.statusCode === status && (!code || e.code === code)
}
const pdf = Buffer.from('%PDF-1.4\noriginal evidence')
test('create is idempotent under concurrency, auto-fills server profile and allows partial drafts', async () => {
  const f = await fixture()
  const [one, two] = await Promise.all([f.create(), f.create()])
  assert.equal(one.id, two.id)
  assert.equal(one.values.fullName, 'Nguyễn Minh An')
  assert.equal(one.status, 'DRAFT')
  assert.equal(one.issues.length, 2)
  assert.equal((await f.service.list(f.actor.userId)).length, 1)
  const audit = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.action, 'SUBMISSION_DRAFT_CREATE'))
  assert.equal(audit.length, 1)
  assert.ok(!JSON.stringify(audit).includes('Nguyễn Minh An'))
  assert.ok(!('processorUserId' in one.procedure))
})
test('save refreshes profile; rejects client profile override; concurrent stale saves conflict', async () => {
  const f = await fixture(),
    draft = await f.create()
  await assert.rejects(
    () => f.service.save(f.actor, draft.id, 1, { fullName: 'Giả' }),
    errorCode(422),
  )
  await db.update(users).set({ fullName: 'Tên đã cập nhật' }).where(eq(users.id, f.actor.userId))
  const results = await Promise.allSettled([
    f.service.save(f.actor, draft.id, 1, { purpose: 'A' }),
    f.service.save(f.actor, draft.id, 1, { purpose: 'B' }),
  ])
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
  const rejected = results.find((r) => r.status === 'rejected')
  assert.ok(rejected?.status === 'rejected' && errorCode(409, 'REVISION_CONFLICT')(rejected.reason))
  assert.equal((await f.service.get(f.actor.userId, draft.id)).values.fullName, 'Tên đã cập nhật')
})
test('student cannot list, read, save or download another student draft; current role/status checked', async () => {
  const f = await fixture(),
    draft = await f.create()
  const other = { ...f.actor, userId: f.otherId }
  assert.deepEqual(await f.service.list(f.otherId), [])
  await assert.rejects(() => f.service.get(f.otherId, draft.id), errorCode(404))
  await assert.rejects(() => f.service.save(other, draft.id, 1, {}), errorCode(404))
  const uploaded = await f.service.upload(
    f.actor,
    draft.id,
    1,
    'proof',
    pdf,
    'proof.pdf',
    'application/pdf',
  )
  await assert.rejects(
    () => f.service.download(f.otherId, draft.id, uploaded.files[0]!.id),
    errorCode(404),
  )
  await assert.rejects(
    () => f.service.remove(other, draft.id, 2, uploaded.files[0]!.id),
    errorCode(404),
  )
  await db.update(users).set({ status: 'INACTIVE' }).where(eq(users.id, f.actor.userId))
  await assert.rejects(() => f.service.get(f.actor.userId, draft.id), errorCode(403))
  await db.update(users).set({ status: 'ACTIVE' }).where(eq(users.id, f.actor.userId))
  await db
    .delete(userRoles)
    .where(and(eq(userRoles.userId, f.actor.userId), eq(userRoles.roleId, f.roleId)))
  await assert.rejects(() => f.service.list(f.actor.userId), errorCode(403))
})
test('OFFLINE and inactive units/classes cannot create usable online drafts', async () => {
  const f = await fixture('OFFLINE')
  await assert.rejects(f.create, errorCode(409, 'PROCEDURE_UNAVAILABLE'))
  assert.equal((await db.select().from(submissions)).length, 0)
  await db
    .update(academicClasses)
    .set({ status: 'INACTIVE' })
    .where(eq(academicClasses.id, f.classId))
  await assert.rejects(f.create, errorCode(403))
})
test('retired pinned version becomes read-only; new published version starts a separate draft', async () => {
  const f = await fixture(),
    draft = await f.create()
  await db
    .update(procedureVersions)
    .set({ status: 'RETIRED' })
    .where(eq(procedureVersions.id, f.version.id))
  const [next] = await db
    .insert(procedureVersions)
    .values({
      serviceId: f.serviceId,
      ownerUnitId: f.unitId,
      versionNumber: 2,
      status: 'PUBLISHED',
      publishedAt: new Date(),
      config: f.version.config,
      createdBy: f.actor.userId,
      updatedBy: f.actor.userId,
    })
    .returning()
  const old = await f.service.get(f.actor.userId, draft.id)
  assert.equal(old.procedure.versionId, f.version.id)
  assert.equal(old.editable, false)
  await assert.rejects(
    () => f.service.save(f.actor, draft.id, 1, {}),
    errorCode(409, 'PROCEDURE_UNAVAILABLE'),
  )
  await assert.rejects(
    () => f.service.upload(f.actor, draft.id, 1, 'proof', pdf, 'a.pdf', 'application/pdf'),
    errorCode(409),
  )
  assert.equal(f.storage.files.size, 0)
  const current = await f.service.create(f.actor, f.serviceId, next!.id)
  assert.notEqual(current.id, draft.id)
  await db
    .update(organizationalUnits)
    .set({ status: 'INACTIVE' })
    .where(eq(organizationalUnits.id, f.unitId))
  assert.equal((await f.service.get(f.actor.userId, current.id)).editable, false)
  await assert.rejects(() => f.service.save(f.actor, current.id, 1, {}), errorCode(409))
})
test('file limits and revisions serialize concurrent uploads; rejected objects are removed', async () => {
  const f = await fixture(),
    draft = await f.create()
  const results = await Promise.allSettled([
    f.service.upload(f.actor, draft.id, 1, 'proof', pdf, 'a.pdf', 'application/pdf'),
    f.service.upload(f.actor, draft.id, 1, 'proof', pdf, 'b.pdf', 'application/pdf'),
  ])
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
  assert.equal(f.storage.files.size, 1)
  await assert.rejects(
    () => f.service.upload(f.actor, draft.id, 2, 'proof', pdf, 'c.pdf', 'application/pdf'),
    errorCode(422, 'ATTACHMENT_LIMIT'),
  )
  assert.equal(f.storage.files.size, 1)
  await assert.rejects(
    () => f.service.upload(f.actor, draft.id, 2, 'unknown', pdf, 'c.pdf', 'application/pdf'),
    errorCode(422),
  )
  assert.equal(f.storage.files.size, 1)
})
test('original bytes/hash preserved, NOT_CHECKED never means valid; soft removal hides downloads', async () => {
  const f = await fixture(),
    draft = await f.create()
  const uploaded = await f.service.upload(
    f.actor,
    draft.id,
    1,
    'proof',
    pdf,
    'giấy.pdf',
    'application/pdf',
  )
  const file = uploaded.files[0]!
  assert.equal(file.signatureStatus, 'NOT_CHECKED')
  assert.equal(file.sha256, createHash('sha256').update(pdf).digest('hex'))
  assert.ok(!('storageKey' in file) && !('key' in file))
  assert.deepEqual((await f.service.download(f.actor.userId, draft.id, file.id)).bytes, pdf)
  const [metadata] = await db.select().from(submissionFiles)
  f.storage.files.set(metadata!.storageKey, Buffer.from('tampered'))
  await assert.rejects(
    () => f.service.download(f.actor.userId, draft.id, file.id),
    errorCode(503, 'FILE_INTEGRITY'),
  )
  f.storage.files.set(metadata!.storageKey, pdf)
  const removed = await f.service.remove(f.actor, draft.id, 2, file.id)
  assert.equal(removed.files.length, 0)
  assert.equal(f.storage.files.size, 1)
  assert.ok((await db.select().from(submissionFiles))[0]!.removedAt)
  await assert.rejects(() => f.service.download(f.actor.userId, draft.id, file.id), errorCode(404))
})
test('audit failure rolls back metadata/revision and cleans up newly stored original', async () => {
  const f = await fixture(),
    draft = await f.create()
  await db.execute(
    sql.raw(
      "CREATE FUNCTION s5t_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test audit unavailable'; END; $$",
    ),
  )
  await db.execute(
    sql.raw(
      "CREATE TRIGGER s5t_fail_audit BEFORE INSERT ON audit_logs FOR EACH ROW WHEN (NEW.action = 'SUBMISSION_EVIDENCE_ADD') EXECUTE FUNCTION s5t_fail_audit()",
    ),
  )
  await assert.rejects(() =>
    f.service.upload(f.actor, draft.id, 1, 'proof', pdf, 'a.pdf', 'application/pdf'),
  )
  assert.equal(f.storage.files.size, 0)
  assert.equal((await f.service.get(f.actor.userId, draft.id)).revision, 1)
  assert.equal((await db.select().from(submissionFiles)).length, 0)
})
async function httpFixture(t: { after: (fn: () => Promise<unknown>) => void }) {
  const f = await fixture()
  const app = buildApp({ submissionService: f.service })
  await app.ready()
  t.after(() => app.close())
  function cookie(userId = f.actor.userId, roles = ['STUDENT']) {
    return (
      'user_session=' +
      app.jwt.sign(
        {
          sub: userId,
          username: f.actor.username,
          roles,
          mustChangePassword: false,
          portal: 'user',
          aud: USER_JWT_AUDIENCE,
          iss: JWT_ISSUER,
        },
        { expiresIn: '5m' },
      )
    )
  }
  return { ...f, app, cookie }
}
function multipart(bytes: Buffer, name = 'a.pdf', extra = '') {
  const boundary = 's5t-boundary'
  return {
    headers: { 'content-type': 'multipart/form-data; boundary=' + boundary },
    payload: Buffer.concat([
      Buffer.from(
        '--' +
          boundary +
          '\r\nContent-Disposition: form-data; name="file"; filename="' +
          name +
          '"\r\nContent-Type: application/pdf\r\n\r\n',
      ),
      bytes,
      Buffer.from('\r\n' + extra + '--' + boundary + '--\r\n'),
    ]),
  }
}
test('HTTP auth, student role and Origin protection precede writes, including multipart', async (t) => {
  const f = await httpFixture(t)
  assert.equal((await f.app.inject({ url: '/api/v1/user/submissions' })).statusCode, 401)
  assert.equal(
    (
      await f.app.inject({
        url: '/api/v1/user/submissions',
        headers: { cookie: f.cookie(f.actor.userId, ['FACULTY_REVIEWER']) },
      })
    ).statusCode,
    403,
  )
  const payload = { serviceId: f.serviceId, versionId: f.version.id }
  for (const origin of [undefined, 'https://attacker.example'])
    assert.equal(
      (
        await f.app.inject({
          method: 'POST',
          url: '/api/v1/user/submissions',
          headers: { cookie: f.cookie(), ...(origin ? { origin } : {}) },
          payload,
        })
      ).statusCode,
      403,
    )
  const created = await f.app.inject({
    method: 'POST',
    url: '/api/v1/user/submissions',
    headers: { cookie: f.cookie(), origin: env.corsOrigin },
    payload,
  })
  assert.equal(created.statusCode, 200)
  const draft = created.json<DraftView>()
  const body = multipart(pdf)
  const rejected = await f.app.inject({
    method: 'POST',
    url: '/api/v1/user/submissions/' + draft.id + '/attachments/proof?revision=1',
    ...body,
    headers: { ...body.headers, cookie: f.cookie(), origin: 'https://attacker.example' },
  })
  assert.equal(rejected.statusCode, 403)
  assert.equal(f.storage.files.size, 0)
  await db.update(users).set({ status: 'INACTIVE' }).where(eq(users.id, f.actor.userId))
  assert.equal(
    (
      await f.app.inject({
        url: '/api/v1/user/submissions/' + draft.id,
        headers: { cookie: f.cookie() },
      })
    ).statusCode,
    403,
  )
})
test('HTTP enforces single multipart file/size and content check; private download rejects IDOR', async (t) => {
  const f = await httpFixture(t),
    draft = await f.create()
  const route = '/api/v1/user/submissions/' + draft.id + '/attachments/proof?revision=1'
  for (const body of [
    multipart(Buffer.alloc(5 * 1024 * 1024 + 1)),
    multipart(
      pdf,
      'a.pdf',
      '--s5t-boundary\r\nContent-Disposition: form-data; name="extra"\r\n\r\nx\r\n',
    ),
    multipart(Buffer.from('<html>bad</html>')),
  ]) {
    const response = await f.app.inject({
      method: 'POST',
      url: route,
      ...body,
      headers: { ...body.headers, cookie: f.cookie(), origin: env.corsOrigin },
    })
    assert.ok([413, 422].includes(response.statusCode), response.body)
    assert.equal(f.storage.files.size, 0)
  }
  const body = multipart(pdf)
  const uploaded = await f.app.inject({
    method: 'POST',
    url: route,
    ...body,
    headers: { ...body.headers, cookie: f.cookie(), origin: env.corsOrigin },
  })
  assert.equal(uploaded.statusCode, 200, uploaded.body)
  const file = uploaded.json<DraftView>().files[0]!
  const path = '/api/v1/user/submissions/' + draft.id + '/files/' + file.id
  assert.equal((await f.app.inject({ url: path })).statusCode, 401)
  assert.equal(
    (await f.app.inject({ url: path, headers: { cookie: f.cookie(f.otherId) } })).statusCode,
    404,
  )
  const download = await f.app.inject({ url: path, headers: { cookie: f.cookie() } })
  assert.equal(download.statusCode, 200)
  assert.equal(download.headers['cache-control'], 'private, no-store')
  assert.equal(download.headers['x-content-type-options'], 'nosniff')
  assert.match(String(download.headers['content-disposition']), /^attachment;/)
  assert.deepEqual(download.rawPayload, pdf)
})

test('per-file and aggregate configured limits are both enforced', async () => {
  const f = await fixture(),
    draft = await f.create()
  const large = Buffer.concat([pdf, Buffer.alloc(1100)])
  await assert.rejects(
    () => f.service.upload(f.actor, draft.id, 1, 'proof', large, 'a.pdf', 'application/pdf'),
    errorCode(422, 'ATTACHMENT_LIMIT'),
  )
  const part = Buffer.concat([pdf, Buffer.alloc(800 - pdf.length)])
  await f.service.upload(f.actor, draft.id, 1, 'proof', part, 'a.pdf', 'application/pdf')
  await assert.rejects(
    () => f.service.upload(f.actor, draft.id, 2, 'extraProof', part, 'b.pdf', 'application/pdf'),
    errorCode(422, 'ATTACHMENT_LIMIT'),
  )
  assert.equal(f.storage.files.size, 1)
})

test('HTTP preserves number/boolean/null JSON types and rejects malformed answers', async (t) => {
  const f = await httpFixture(t),
    draft = await f.create()
  const options = {
    method: 'PUT' as const,
    url: '/api/v1/user/submissions/' + draft.id,
    headers: { cookie: f.cookie(), origin: env.corsOrigin },
  }
  const response = await f.app.inject({
    ...options,
    payload: {
      expectedRevision: 1,
      values: { amount: 0, agreed: false, purpose: null, date: '2024-02-29' },
    },
  })
  assert.equal(response.statusCode, 200, response.body)
  assert.equal(response.json<DraftView>().values.amount, 0)
  assert.equal(response.json<DraftView>().values.agreed, false)
  assert.equal(response.json<DraftView>().values.purpose, null)
  for (const values of [
    { amount: '0' },
    { agreed: 'false' },
    { purpose: {} },
    { date: '2026-02-30' },
    { unexpected: 'value' },
    { fullName: 'Spoof' },
  ]) {
    const rejected = await f.app.inject({ ...options, payload: { expectedRevision: 2, values } })
    assert.equal(rejected.statusCode, 422, rejected.body)
  }
})

test('uncertain commit or database outage preserves the original instead of deleting evidence', async () => {
  const f = await fixture(),
    draft = await f.create()
  class LostAcknowledgementRepository extends DrizzleSubmissionRepository {
    override async addFile(
      ...args: Parameters<DrizzleSubmissionRepository['addFile']>
    ): Promise<DraftView> {
      await super.addFile(...args)
      throw new Error('Commit acknowledgement lost')
    }
  }
  const uncertain = new SubmissionService(new LostAcknowledgementRepository(), f.storage)
  await assert.rejects(
    () => uncertain.upload(f.actor, draft.id, 1, 'proof', pdf, 'a.pdf', 'application/pdf'),
    errorCode(503, 'STORAGE_RECONCILIATION'),
  )
  assert.equal(f.storage.files.size, 1)
  const committed = await f.service.get(f.actor.userId, draft.id)
  assert.equal(committed.files.length, 1)
  assert.deepEqual(
    (await f.service.download(f.actor.userId, draft.id, committed.files[0]!.id)).bytes,
    pdf,
  )
  class UnavailableRepository extends DrizzleSubmissionRepository {
    override async addFile(): Promise<DraftView> {
      throw new Error('Database unavailable')
    }
    override async hasStoredFile(): Promise<boolean> {
      throw new Error('Database unavailable')
    }
  }
  const unavailable = new SubmissionService(new UnavailableRepository(), f.storage)
  await assert.rejects(
    () => unavailable.upload(f.actor, draft.id, 2, 'proof', pdf, 'b.pdf', 'application/pdf'),
    errorCode(503, 'STORAGE_RECONCILIATION'),
  )
  assert.equal(f.storage.files.size, 2)
  assert.equal((await f.service.get(f.actor.userId, draft.id)).files.length, 1)
})

test('maximum configured Vietnamese field content fits the draft request limit', async (t) => {
  const f = await httpFixture(t)
  await db
    .update(procedureVersions)
    .set({ status: 'RETIRED' })
    .where(eq(procedureVersions.id, f.version.id))
  const fields = Array.from({ length: 50 }, (_, index) => ({
    key: 'field' + index,
    label: 'Nội dung ' + index,
    type: 'TEXTAREA' as const,
    source: 'STUDENT_INPUT' as const,
    profileKey: null,
    required: false,
    maxLength: 2000,
    options: [],
  }))
  const [version] = await db
    .insert(procedureVersions)
    .values({
      serviceId: f.serviceId,
      ownerUnitId: f.unitId,
      versionNumber: 2,
      status: 'PUBLISHED',
      publishedAt: new Date(),
      config: { ...f.version.config, fields },
      createdBy: f.actor.userId,
      updatedBy: f.actor.userId,
    })
    .returning()
  const draft = await f.service.create(f.actor, f.serviceId, version!.id)
  const values = Object.fromEntries(fields.map((field) => [field.key, 'ọ'.repeat(2000)]))
  const response = await f.app.inject({
    method: 'PUT',
    url: '/api/v1/user/submissions/' + draft.id,
    headers: { cookie: f.cookie(), origin: env.corsOrigin },
    payload: { expectedRevision: 1, values },
  })
  assert.equal(response.statusCode, 200, response.body)
  assert.deepEqual(response.json<DraftView>().values, values)
})

test('HTTP upload concurrency includes pending storage and releases slots after settlement', async (t) => {
  const f = await httpFixture(t)
  const draft = await f.create()
  const allStoring = Promise.withResolvers<void>()
  const fifthStoring = Promise.withResolvers<void>()
  const resumeStorage = Promise.withResolvers<void>()
  const originalPut = f.storage.put.bind(f.storage)
  let storing = 0
  f.storage.put = async (bytes) => {
    storing++
    if (storing === 4) allStoring.resolve()
    if (storing === 5) fifthStoring.resolve()
    await resumeStorage.promise
    return originalPut(bytes)
  }
  function upload(key = 'proof', revision = 1) {
    const body = multipart(pdf)
    return f.app.inject({
      method: 'POST',
      url: `/api/v1/user/submissions/${draft.id}/attachments/${key}?revision=${revision}`,
      payload: body.payload,
      headers: { ...body.headers, cookie: f.cookie(), origin: env.corsOrigin },
    })
  }
  const pending = Array.from({ length: 4 }, () => upload())
  let fifth: ReturnType<typeof upload> | undefined
  try {
    await allStoring.promise
    fifth = upload()
    const response = await Promise.race([fifth, fifthStoring.promise.then(() => null)])
    assert.ok(response, 'A fifth request must not enter storage while four uploads are pending')
    assert.equal(response.statusCode, 503, response.body)
    assert.equal(response.json<{ code: string }>().code, 'UPLOAD_BUSY')
    assert.equal(storing, 4)
  } finally {
    resumeStorage.resolve()
    await Promise.all([...pending, ...(fifth ? [fifth] : [])])
  }
  const responses = await Promise.all(pending)
  assert.equal(responses.filter((response) => response.statusCode === 200).length, 1)
  assert.equal(responses.filter((response) => response.statusCode === 409).length, 3)
  const retry = await upload('extraProof', 2)
  assert.equal(retry.statusCode, 200, retry.body)
})
