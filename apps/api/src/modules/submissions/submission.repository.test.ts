import { newDeclarationTemplateBinding } from './submission-document-template.js'
import type { SubmissionBundleManifest } from './submission-bundle.js'
import { unzipSync, strFromU8 } from 'fflate'
import { LocalSubmissionDocumentRenderer, LibreOfficePdfConverter } from './submission-document.js'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
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
import {
  authorizationScopes,
  permissions,
  rolePermissions,
  userRoleScopes,
} from '../auth/authorization.schema.js'
import { DrizzleProcedureRepository } from '../procedures/procedure.repository.js'
import { procedureVersions } from '../procedures/procedure.schema.js'
import type { ProcedureConfig } from '../procedures/procedure.contract.js'
import { DrizzleSubmissionRepository } from './submission.repository.js'
import { SubmissionService } from './submission.service.js'
import {
  SubmissionError,
  type SubmissionActor,
  type DraftView,
  type ReviewDetail,
  type ReviewQueuePage,
} from './submission.types.js'
import {
  submissionFiles,
  submissions,
  submissionRounds,
  submissionEvents,
} from './submission.schema.js'
import { DrizzleNotificationRepository } from '../notifications/notification.repository.js'
import { personalNotifications } from '../notifications/notification.schema.js'
import { buildApp } from '../../app.js'
import { ADMIN_JWT_AUDIENCE, JWT_ISSUER, USER_JWT_AUDIENCE } from '../auth/auth.constants.js'
const url = new URL(process.env.DATABASE_URL ?? 'http://invalid')
if (
  url.pathname !== '/student_service_test' ||
  !['localhost', '127.0.0.1'].includes(url.hostname) ||
  url.port !== '5434'
)
  throw new Error('Tests require local student_service_test on port 5434')
async function cleanup() {
  await db.execute(
    sql.raw('DROP TRIGGER IF EXISTS s5t_fail_notification ON personal_notifications'),
  )
  await db.execute(sql.raw('DROP FUNCTION IF EXISTS s5t_fail_notification()'))
  await db.execute(sql.raw('DROP TRIGGER IF EXISTS s5t_fail_event ON submission_events'))
  await db.execute(sql.raw('DROP FUNCTION IF EXISTS s5t_fail_event()'))
  await db.execute(sql.raw('DROP TRIGGER IF EXISTS s5t_fail_audit ON audit_logs'))
  await db.execute(sql.raw('DROP FUNCTION IF EXISTS s5t_fail_audit()'))
  await db.execute(
    sql.raw(
      'TRUNCATE personal_notifications, submission_events, submission_rounds, submission_files, submissions, procedure_versions',
    ),
  )
  await db.execute(sql.raw('TRUNCATE audit_logs'))
  await db.delete(users).where(like(users.username, 's5t-%'))
  await db.delete(roles).where(like(roles.code, 'S5T_%'))
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
async function fixture(mode: ProcedureConfig['processingMode'] = 'ONLINE', designated = false) {
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
  const designatedReviewer = designated ? await addReviewer(unitId) : null
  const config: ProcedureConfig = {
    processingMode: mode,
    processingUnitId: unitId,
    processorUserId: designatedReviewer?.userId ?? null,
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
    designatedReviewer,
    otherId,
    facultyId,
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
async function httpFixture(
  t: { after: (fn: () => Promise<unknown>) => void },
  setup?: (app: ReturnType<typeof buildApp>) => void,
) {
  const f = await fixture()
  const app = buildApp({ submissionService: f.service })
  setup?.(app)
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
async function addReviewer(
  unitId: string,
  scopeType: 'GLOBAL' | 'ORGANIZATION' = 'ORGANIZATION',
  existingUserId?: string,
) {
  const userId = existingUserId ?? randomUUID()
  const username = 's5t-' + randomUUID()
  if (!existingUserId)
    await db
      .insert(users)
      .values({ id: userId, username, fullName: 'Cán bộ kiểm thử', mustChangePassword: false })
  const [role] = await db
    .insert(roles)
    .values({ code: 'S5T_R_' + randomUUID(), name: 'Vai trò kiểm thử' })
    .returning()
  await db
    .insert(permissions)
    .values({ code: 'submission.review', name: 'Tiếp nhận hồ sơ' })
    .onConflictDoNothing()
  const [permission] = await db
    .select()
    .from(permissions)
    .where(eq(permissions.code, 'submission.review'))
  await db.insert(userRoles).values({ userId, roleId: role!.id })
  await db.insert(rolePermissions).values({ roleId: role!.id, permissionId: permission!.id })
  await db
    .insert(authorizationScopes)
    .values({ scopeType, organizationalUnitId: scopeType === 'ORGANIZATION' ? unitId : null })
    .onConflictDoNothing()
  const [scope] = await db
    .select()
    .from(authorizationScopes)
    .where(
      scopeType === 'GLOBAL'
        ? eq(authorizationScopes.scopeType, 'GLOBAL')
        : eq(authorizationScopes.organizationalUnitId, unitId),
    )
  await db.insert(userRoleScopes).values({ userId, roleId: role!.id, scopeId: scope!.id })
  return {
    userId,
    username,
    roleId: role!.id,
    permissionId: permission!.id,
    scopeId: scope!.id,
    requestId: 's5t-intake',
    ipAddress: null,
    userAgent: null,
  }
}
async function complete(f: Awaited<ReturnType<typeof fixture>>, actor = f.actor) {
  const draft = await f.service.create(actor, f.serviceId, f.version.id)
  const saved = await f.service.save(actor, draft.id, draft.revision, {
    purpose: 'Nội dung riêng tư',
    amount: 0,
    agreed: false,
  })
  return f.service.upload(
    actor,
    saved.id,
    saved.revision,
    'proof',
    pdf,
    'bản gốc.pdf',
    'application/pdf',
  )
}
function pauseRead(storage: MemoryStorage) {
  const entered = Promise.withResolvers<void>()
  const resume = Promise.withResolvers<void>()
  const original = storage.read.bind(storage)
  storage.read = async (key: string) => {
    entered.resolve()
    await resume.promise
    return original(key)
  }
  return {
    entered: entered.promise,
    resume: () => resume.resolve(),
    waitFor: (operation: Promise<unknown>) =>
      Promise.race([
        entered.promise,
        operation.then(
          () => {
            throw new Error('Operation finished before reaching storage barrier')
          },
          (error: unknown) => {
            throw error
          },
        ),
      ]),
  }
}
async function intakeAudit(action: string) {
  return db.select().from(auditLogs).where(eq(auditLogs.action, action))
}

test('submit requires all required answers/evidence, a current revision, and valid persisted types', async () => {
  const f = await fixture()
  await addReviewer(f.unitId)
  const draft = await f.create()
  await assert.rejects(
    () => f.service.submit(f.actor, draft.id, 1),
    (e: unknown) => {
      assert.ok(errorCode(422, 'INCOMPLETE_SUBMISSION')(e))
      assert.deepEqual((e as SubmissionError).issues.map((i) => i.path).sort(), [
        'attachments.proof',
        'values.purpose',
      ])
      return true
    },
  )
  const ready = await complete(f)
  await assert.rejects(
    () => f.service.submit(f.actor, draft.id, 1),
    errorCode(409, 'REVISION_CONFLICT'),
  )
  await db
    .update(submissions)
    .set({ values: { purpose: 'Đủ', amount: 'wrong' } })
    .where(eq(submissions.id, draft.id))
  await assert.rejects(
    () => f.service.submit(f.actor, draft.id, ready.revision),
    errorCode(422, 'INCOMPLETE_SUBMISSION'),
  )
  assert.equal((await f.service.get(f.actor.userId, draft.id)).status, 'DRAFT')
  assert.equal((await intakeAudit('SUBMISSION_SUBMIT')).length, 0)
})

test('submit snapshots the refreshed profile, is concurrent/idempotent, freezes student operations and hides routing metadata', async () => {
  const f = await fixture('HYBRID', true)
  const ready = await complete(f)
  const paused = pauseRead(f.storage)
  const pending = f.service.submit(f.actor, ready.id, ready.revision)
  const joined = pending.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  )
  try {
    await paused.waitFor(pending)
    await db.update(users).set({ fullName: 'Tên mới lúc gửi' }).where(eq(users.id, f.actor.userId))
    await db
      .update(studentProfiles)
      .set({ studentCode: 'S5T_REFRESH' })
      .where(eq(studentProfiles.userId, f.actor.userId))
  } finally {
    paused.resume()
  }
  const result = await joined
  assert.ok('value' in result, 'submit should succeed after profile refresh')
  const sent = result.value
  assert.equal(sent.status, 'SUBMITTED')
  assert.equal(sent.values.fullName, 'Tên mới lúc gửi')
  assert.equal(sent.revision, ready.revision + 1)
  assert.equal(sent.editable, false)
  assert.ok(sent.submittedAt)
  const [row] = await db.select().from(submissions).where(eq(submissions.id, sent.id))
  assert.equal(row!.studentSnapshot?.studentCode, 'S5T_REFRESH')
  assert.equal(row!.studentSnapshot?.fullName, 'Tên mới lúc gửi')
  assert.equal(row!.designatedReviewerId, f.designatedReviewer!.userId)
  const publicJson = JSON.stringify(sent)
  for (const secret of [
    'storageKey',
    'designatedReviewerId',
    'processorUserId',
    f.designatedReviewer!.userId,
  ])
    assert.ok(!publicJson.includes(secret))
  const duplicates = await Promise.all([
    f.service.submit(f.actor, ready.id, 1),
    f.service.submit(f.actor, ready.id, ready.revision),
  ])
  assert.ok(
    duplicates.every(
      (item) => item.revision === sent.revision && item.submittedAt === sent.submittedAt,
    ),
  )
  assert.equal((await intakeAudit('SUBMISSION_SUBMIT')).length, 1)
  await assert.rejects(
    () => f.service.save(f.actor, sent.id, sent.revision, { purpose: 'Sửa' }),
    errorCode(409, 'SUBMISSION_READ_ONLY'),
  )
  await assert.rejects(
    () => f.service.remove(f.actor, sent.id, sent.revision, sent.files[0]!.id),
    errorCode(409, 'SUBMISSION_READ_ONLY'),
  )
  await assert.rejects(
    () =>
      f.service.upload(
        f.actor,
        sent.id,
        sent.revision,
        'extraProof',
        pdf,
        'a.pdf',
        'application/pdf',
      ),
    errorCode(409, 'SUBMISSION_READ_ONLY'),
  )
  assert.equal(f.storage.files.size, 1)
  await db
    .update(procedureVersions)
    .set({ status: 'RETIRED' })
    .where(eq(procedureVersions.id, f.version.id))
  await db.update(services).set({ status: 'INACTIVE' }).where(eq(services.id, f.serviceId))
  assert.equal((await f.service.get(f.actor.userId, sent.id)).status, 'SUBMITTED')
  assert.equal(
    (await f.service.reviewGet(f.designatedReviewer!.userId, sent.id)).status,
    'SUBMITTED',
  )
  assert.deepEqual(
    (await f.service.download(f.actor.userId, sent.id, sent.files[0]!.id)).bytes,
    pdf,
  )
  const audit = JSON.stringify(await intakeAudit('SUBMISSION_SUBMIT'))
  assert.ok(
    !audit.includes('Nội dung riêng tư') &&
      !audit.includes('Tên mới lúc gửi') &&
      !audit.includes('storageKey'),
  )
})

for (const corruption of ['missing', 'size', 'hash'] as const) {
  test(`submit atomically rejects ${corruption} original evidence`, async () => {
    const f = await fixture()
    await addReviewer(f.unitId)
    const ready = await complete(f)
    const [file] = await db.select().from(submissionFiles)
    if (corruption === 'missing') f.storage.files.delete(file!.storageKey)
    else if (corruption === 'size')
      f.storage.files.set(file!.storageKey, Buffer.concat([pdf, Buffer.from('extra')]))
    else
      f.storage.files.set(
        file!.storageKey,
        Buffer.from(pdf.toString().replace('original', 'tampered')),
      )
    await assert.rejects(
      () => f.service.submit(f.actor, ready.id, ready.revision),
      errorCode(503, 'FILE_INTEGRITY'),
    )
    const current = await f.service.get(f.actor.userId, ready.id)
    assert.equal(current.status, 'DRAFT')
    assert.equal(current.revision, ready.revision)
    assert.equal(current.submittedAt, null)
    assert.equal((await intakeAudit('SUBMISSION_SUBMIT')).length, 0)
  })
}

for (const revoke of [
  'student-role',
  'student-status',
  'student-password',
  'class',
  'faculty',
  'reviewer-role',
  'reviewer-status',
  'reviewer-password',
  'reviewer-scope',
  'reviewer-permission',
  'unit',
] as const) {
  test(`submit rechecks ${revoke} after deferred storage I/O`, async () => {
    const f = await fixture()
    const reviewer = await addReviewer(f.unitId)
    const ready = await complete(f)
    const paused = pauseRead(f.storage)
    const pending = f.service.submit(f.actor, ready.id, ready.revision)
    const settled = pending.then(
      () => null,
      (error: unknown) => error,
    )
    try {
      await paused.waitFor(pending)
      if (revoke === 'student-role')
        await db
          .delete(userRoles)
          .where(and(eq(userRoles.userId, f.actor.userId), eq(userRoles.roleId, f.roleId)))
      if (revoke === 'student-status')
        await db.update(users).set({ status: 'INACTIVE' }).where(eq(users.id, f.actor.userId))
      if (revoke === 'student-password')
        await db.update(users).set({ mustChangePassword: true }).where(eq(users.id, f.actor.userId))
      if (revoke === 'class')
        await db
          .update(academicClasses)
          .set({ status: 'INACTIVE' })
          .where(eq(academicClasses.id, f.classId))
      if (revoke === 'faculty')
        await db.update(faculties).set({ status: 'INACTIVE' }).where(eq(faculties.id, f.facultyId))
      if (revoke === 'reviewer-role')
        await db
          .delete(userRoles)
          .where(and(eq(userRoles.userId, reviewer.userId), eq(userRoles.roleId, reviewer.roleId)))
      if (revoke === 'reviewer-status')
        await db.update(users).set({ status: 'INACTIVE' }).where(eq(users.id, reviewer.userId))
      if (revoke === 'reviewer-password')
        await db
          .update(users)
          .set({ mustChangePassword: true })
          .where(eq(users.id, reviewer.userId))
      if (revoke === 'reviewer-scope')
        await db.delete(userRoleScopes).where(eq(userRoleScopes.userId, reviewer.userId))
      if (revoke === 'reviewer-permission')
        await db.delete(rolePermissions).where(eq(rolePermissions.roleId, reviewer.roleId))
      if (revoke === 'unit')
        await db
          .update(organizationalUnits)
          .set({ status: 'INACTIVE' })
          .where(eq(organizationalUnits.id, f.unitId))
    } finally {
      paused.resume()
    }
    const error = await settled
    assert.ok(
      errorCode(
        ['student-role', 'student-status', 'student-password', 'class', 'faculty'].includes(revoke)
          ? 403
          : 409,
      )(error),
    )
    const [row] = await db.select().from(submissions).where(eq(submissions.id, ready.id))
    assert.equal(row!.status, 'DRAFT')
    assert.equal(row!.revision, ready.revision)
    assert.equal(row!.submittedAt, null)
    assert.equal((await intakeAudit('SUBMISSION_SUBMIT')).length, 0)
  })
}
test('review scope requires permission and scope on one role; self-review and DRAFT are hidden', async () => {
  const f = await fixture()
  const reviewer = await addReviewer(f.unitId)
  const selfReviewer = await addReviewer(f.unitId, 'GLOBAL', f.actor.userId)
  const ready = await complete(f)
  assert.deepEqual((await f.service.reviewList(reviewer.userId)).items, [])
  await assert.rejects(() => f.service.reviewGet(reviewer.userId, ready.id), errorCode(404))
  await assert.rejects(
    () => f.service.reviewDownload(reviewer.userId, ready.id, ready.files[0]!.id),
    errorCode(404),
  )
  await assert.rejects(() => f.service.claim(reviewer, ready.id, ready.revision), errorCode(404))
  const sent = await f.service.submit(f.actor, ready.id, ready.revision)
  assert.deepEqual((await f.service.reviewList(selfReviewer.userId)).items, [])
  await assert.rejects(() => f.service.reviewGet(selfReviewer.userId, sent.id), errorCode(404))
  await assert.rejects(() => f.service.claim(selfReviewer, sent.id, sent.revision), errorCode(404))
  await assert.rejects(
    () => f.service.reviewDownload(selfReviewer.userId, sent.id, sent.files[0]!.id),
    errorCode(404),
  )
  const [secondRole] = await db
    .insert(roles)
    .values({ code: 'S5T_' + randomUUID(), name: 'Có scope không có quyền' })
    .returning()
  await db.delete(userRoleScopes).where(eq(userRoleScopes.userId, reviewer.userId))
  await db.insert(userRoles).values({ userId: reviewer.userId, roleId: secondRole!.id })
  await db
    .insert(userRoleScopes)
    .values({ userId: reviewer.userId, roleId: secondRole!.id, scopeId: reviewer.scopeId })
  for (const operation of [
    () => f.service.reviewList(reviewer.userId),
    () => f.service.reviewGet(reviewer.userId, sent.id),
    () => f.service.claim(reviewer, sent.id, sent.revision),
    () => f.service.reviewDownload(reviewer.userId, sent.id, sent.files[0]!.id),
  ])
    await assert.rejects(operation, errorCode(403))
})

test('designated routing excludes other reviewers even with GLOBAL and never reroutes to the queue', async () => {
  const f = await fixture('ONLINE', true)
  const global = await addReviewer(f.unitId, 'GLOBAL')
  const ready = await complete(f)
  await db
    .update(users)
    .set({ mustChangePassword: true })
    .where(eq(users.id, f.designatedReviewer!.userId))
  await assert.rejects(
    () => f.service.submit(f.actor, ready.id, ready.revision),
    errorCode(409, 'ROUTING_UNAVAILABLE'),
  )
  await db
    .update(users)
    .set({ mustChangePassword: false })
    .where(eq(users.id, f.designatedReviewer!.userId))
  const sent = await f.service.submit(f.actor, ready.id, ready.revision)
  assert.equal((await f.service.reviewList(f.designatedReviewer!.userId)).items.length, 1)
  assert.deepEqual((await f.service.reviewList(global.userId)).items, [])
  await assert.rejects(() => f.service.reviewGet(global.userId, sent.id), errorCode(404))
  await assert.rejects(() => f.service.claim(global, sent.id, sent.revision), errorCode(404))
  await assert.rejects(
    () => f.service.reviewDownload(global.userId, sent.id, sent.files[0]!.id),
    errorCode(404),
  )
})

test('review filters current unit scope and rejects FACULTY/CLASS scopes and revoked current authority', async () => {
  const f = await fixture()
  const reviewer = await addReviewer(f.unitId)
  const foreignId = randomUUID()
  await db
    .insert(organizationalUnits)
    .values({ id: foreignId, code: 'S5T_' + randomUUID(), name: 'Đơn vị khác' })
  const outsider = await addReviewer(foreignId)
  const ready = await complete(f)
  const sent = await f.service.submit(f.actor, ready.id, ready.revision)
  assert.deepEqual((await f.service.reviewList(outsider.userId, { status: 'SUBMITTED' })).items, [])
  await assert.rejects(() => f.service.reviewGet(outsider.userId, sent.id), errorCode(404))
  await assert.rejects(
    () => f.service.reviewDownload(outsider.userId, sent.id, sent.files[0]!.id),
    errorCode(404),
  )
  for (const scopeType of ['CLASS', 'FACULTY'] as const) {
    await db.delete(userRoleScopes).where(eq(userRoleScopes.userId, outsider.userId))
    const [scope] = await db
      .insert(authorizationScopes)
      .values({
        scopeType,
        ...(scopeType === 'CLASS' ? { classId: f.classId } : { facultyId: f.facultyId }),
      })
      .onConflictDoNothing()
      .returning()
    const existing =
      scope ??
      (
        await db
          .select()
          .from(authorizationScopes)
          .where(
            scopeType === 'CLASS'
              ? eq(authorizationScopes.classId, f.classId)
              : eq(authorizationScopes.facultyId, f.facultyId),
          )
      )[0]!
    await db
      .insert(userRoleScopes)
      .values({ userId: outsider.userId, roleId: outsider.roleId, scopeId: existing.id })
    await assert.rejects(() => f.service.reviewList(outsider.userId), errorCode(403))
  }
  for (const mutation of [{ status: 'INACTIVE' }, { status: 'ACTIVE', mustChangePassword: true }]) {
    await db.update(users).set(mutation).where(eq(users.id, reviewer.userId))
    await assert.rejects(() => f.service.reviewList(reviewer.userId), errorCode(403))
    await assert.rejects(() => f.service.claim(reviewer, sent.id, sent.revision), errorCode(403))
  }
  await db
    .update(users)
    .set({ status: 'ACTIVE', mustChangePassword: false })
    .where(eq(users.id, reviewer.userId))
  await db
    .update(organizationalUnits)
    .set({ status: 'INACTIVE' })
    .where(eq(organizationalUnits.id, f.unitId))
  await assert.rejects(() => f.service.reviewGet(reviewer.userId, sent.id), errorCode(403))
  const global = await addReviewer(foreignId, 'GLOBAL')
  assert.deepEqual((await f.service.reviewList(global.userId)).items, [])
  await assert.rejects(() => f.service.claim(global, sent.id, sent.revision), errorCode(404))
})

test('claim races have one winner; same actor retries are idempotent and other scoped actors see progress', async () => {
  const f = await fixture()
  const reviewers = [await addReviewer(f.unitId), await addReviewer(f.unitId)]
  const ready = await complete(f)
  const sent = await f.service.submit(f.actor, ready.id, ready.revision)
  await assert.rejects(
    () => f.service.claim(reviewers[0]!, sent.id, 1),
    errorCode(409, 'REVISION_CONFLICT'),
  )
  const results = await Promise.allSettled(
    reviewers.map((actor) => f.service.claim(actor, sent.id, sent.revision)),
  )
  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1)
  const winnerIndex = results.findIndex((item) => item.status === 'fulfilled')
  const loserIndex = winnerIndex === 0 ? 1 : 0
  const rejected = results[loserIndex]!
  assert.ok(rejected.status === 'rejected' && errorCode(409, 'ALREADY_CLAIMED')(rejected.reason))
  const result = results[winnerIndex]!
  assert.ok(result.status === 'fulfilled')
  const claimed = result.value
  assert.equal(claimed.status, 'IN_REVIEW')
  assert.equal(claimed.revision, sent.revision + 1)
  assert.equal(claimed.canClaim, false)
  const again = await f.service.claim(reviewers[winnerIndex]!, sent.id, 1)
  assert.equal(again.reviewStartedAt, claimed.reviewStartedAt)
  assert.equal(again.revision, claimed.revision)
  assert.equal((await intakeAudit('SUBMISSION_CLAIM')).length, 1)
  assert.equal(
    (await f.service.reviewGet(reviewers[loserIndex]!.userId, sent.id)).status,
    'IN_REVIEW',
  )
  assert.deepEqual(
    (await f.service.reviewDownload(reviewers[loserIndex]!.userId, sent.id, sent.files[0]!.id))
      .bytes,
    pdf,
  )
  assert.equal((await f.service.get(f.actor.userId, sent.id)).status, 'IN_REVIEW')
  const audit = JSON.stringify(await intakeAudit('SUBMISSION_CLAIM'))
  assert.ok(!audit.includes('Nội dung riêng tư') && !audit.includes('storageKey'))
})

test('status filter applies before oldest-first limit so old claimed work cannot hide pending intake', async () => {
  const f = await fixture()
  const reviewer = await addReviewer(f.unitId)
  const ready = await complete(f)
  const sent = await f.service.submit(f.actor, ready.id, ready.revision)
  const [template] = await db.select().from(submissions).where(eq(submissions.id, sent.id))
  const studentIds = Array.from({ length: 51 }, () => randomUUID())
  await db.insert(users).values(
    studentIds.map((id) => ({
      id,
      username: 's5t-' + id,
      fullName: 'Sinh viên hàng đợi',
      mustChangePassword: false,
    })),
  )
  await db.insert(submissions).values(
    studentIds.map((studentUserId, index) => ({
      ...template!,
      id: randomUUID(),
      studentUserId,
      status: 'IN_REVIEW' as const,
      revision: sent.revision + 1,
      submittedAt: new Date(1700000000000 + index),
      reviewerUserId: reviewer.userId,
      reviewStartedAt: new Date(1700000001000 + index),
    })),
  )
  const all = await f.service.reviewList(reviewer.userId)
  assert.equal(all.items.length, 20)
  assert.ok(all.nextCursor)
  assert.ok(all.items.every((row) => row.status === 'IN_REVIEW'))
  const pending = await f.service.reviewList(reviewer.userId, { status: 'SUBMITTED' })
  assert.deepEqual(
    pending.items.map((row) => row.id),
    [sent.id],
  )
  const processing = await f.service.reviewList(reviewer.userId, { status: 'IN_REVIEW' })
  assert.equal(processing.items.length, 20)
  assert.ok(processing.items.every((row) => row.status === 'IN_REVIEW'))
  assert.ok(
    processing.items.every(
      (row, index) => !index || row.submittedAt >= processing.items[index - 1]!.submittedAt,
    ),
  )
})

for (const kind of ['submit', 'claim'] as const) {
  test(`${kind} audit failure rolls back status, receipt, revision and handler`, async () => {
    const f = await fixture()
    const reviewer = await addReviewer(f.unitId)
    const ready = await complete(f)
    const current =
      kind === 'claim' ? await f.service.submit(f.actor, ready.id, ready.revision) : ready
    const [before] = await db.select().from(submissions).where(eq(submissions.id, ready.id))
    await db.execute(
      sql.raw(
        "CREATE FUNCTION s5t_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test audit unavailable'; END; $$",
      ),
    )
    const action = kind === 'submit' ? 'SUBMISSION_SUBMIT' : 'SUBMISSION_CLAIM'
    await db.execute(
      sql.raw(
        "CREATE TRIGGER s5t_fail_audit BEFORE INSERT ON audit_logs FOR EACH ROW WHEN (NEW.action = '" +
          action +
          "') EXECUTE FUNCTION s5t_fail_audit()",
      ),
    )
    await assert.rejects(() =>
      kind === 'submit'
        ? f.service.submit(f.actor, current.id, current.revision)
        : f.service.claim(reviewer, current.id, current.revision),
    )
    const [after] = await db.select().from(submissions).where(eq(submissions.id, ready.id))
    assert.deepEqual(after, before)
    assert.equal((await intakeAudit(action)).length, 0)
    assert.equal(f.storage.files.size, 1)
  })
}
function constraintFailure(error: unknown) {
  const details = error as { code?: string; cause?: { code?: string } }
  return details.code === '23514' || details.cause?.code === '23514'
}

test('database freezes submitted content, bindings, routing and evidence through IN_REVIEW', async () => {
  const f = await fixture('ONLINE', true)
  const ready = await complete(f)
  const sent = await f.service.submit(f.actor, ready.id, ready.revision)
  const contentChanges = [
    sql`id = ${randomUUID()}`,
    sql`student_user_id = ${f.otherId}`,
    sql`service_id = ${f.serviceId + 999999}`,
    sql`procedure_version_id = ${randomUUID()}`,
    sql`service_name = 'changed'`,
    sql`procedure = '{}'::jsonb`,
    sql`values = '{"purpose":"changed"}'::jsonb`,
    sql`created_at = created_at + interval '1 day'`,
    sql`submitted_at = submitted_at + interval '1 day'`,
    sql`processing_unit_id = ${randomUUID()}`,
    sql`designated_reviewer_id = NULL`,
    sql`student_snapshot = '{}'::jsonb`,
  ]
  for (const status of ['SUBMITTED', 'IN_REVIEW']) {
    if (status === 'IN_REVIEW') await f.service.claim(f.designatedReviewer!, sent.id, sent.revision)
    const [before] = await db.select().from(submissions).where(eq(submissions.id, sent.id))
    for (const change of contentChanges)
      await assert.rejects(
        () => db.execute(sql`UPDATE submissions SET ${change} WHERE id = ${sent.id}`),
        constraintFailure,
      )
    await assert.rejects(
      () => db.delete(submissions).where(eq(submissions.id, sent.id)),
      constraintFailure,
    )
    await assert.rejects(
      () =>
        db.execute(
          sql`UPDATE submissions SET status = 'DRAFT', submitted_at = NULL, processing_unit_id = NULL, designated_reviewer_id = NULL, student_snapshot = NULL, reviewer_user_id = NULL, review_started_at = NULL WHERE id = ${sent.id}`,
        ),
      constraintFailure,
    )
    const fileId = sent.files[0]!.id
    for (const change of [
      sql`name = 'changed.pdf'`,
      sql`sha256 = ${'a'.repeat(64)}`,
      sql`size = size + 1`,
      sql`storage_key = ${randomUUID()}`,
      sql`removed_at = now()`,
      sql`attachment_key = 'extraProof'`,
      sql`mime_type = 'image/png'`,
      sql`id = ${randomUUID()}`,
      sql`created_at = created_at + interval '1 day'`,
    ])
      await assert.rejects(
        () => db.execute(sql`UPDATE submission_files SET ${change} WHERE id = ${fileId}`),
        constraintFailure,
      )
    await assert.rejects(
      () => db.delete(submissionFiles).where(eq(submissionFiles.id, fileId)),
      constraintFailure,
    )
    const [stored] = await db.select().from(submissionFiles).where(eq(submissionFiles.id, fileId))
    await assert.rejects(
      () =>
        db
          .insert(submissionFiles)
          .values({ ...stored!, id: randomUUID(), storageKey: randomUUID() }),
      constraintFailure,
    )
    const [after] = await db.select().from(submissions).where(eq(submissions.id, sent.id))
    assert.deepEqual(after, before)
    assert.deepEqual((await f.service.download(f.actor.userId, sent.id, fileId)).bytes, pdf)
  }
})

test('DRAFT to SUBMITTED cannot replace identity/configuration/binding on the transition', async () => {
  const f = await fixture()
  const ready = await complete(f)
  for (const change of [
    sql`id = ${randomUUID()}`,
    sql`student_user_id = ${f.otherId}`,
    sql`service_id = ${f.serviceId + 999999}`,
    sql`procedure_version_id = ${randomUUID()}`,
    sql`service_name = 'changed'`,
    sql`procedure = '{}'::jsonb`,
    sql`created_at = created_at + interval '1 day'`,
  ]) {
    await assert.rejects(
      () =>
        db.execute(
          sql`UPDATE submissions SET status = 'SUBMITTED', revision = revision + 1, submitted_at = now(), processing_unit_id = ${f.unitId}, student_snapshot = '{"fullName":"An","studentCode":"S","classCode":"C","facultyCode":"F"}'::jsonb, ${change} WHERE id = ${ready.id}`,
        ),
      constraintFailure,
    )
    assert.equal((await f.service.get(f.actor.userId, ready.id)).status, 'DRAFT')
  }
  const other = await f.service.create({ ...f.actor, userId: f.otherId }, f.serviceId, f.version.id)
  await assert.rejects(
    () =>
      db
        .update(submissionFiles)
        .set({ submissionId: other.id })
        .where(eq(submissionFiles.id, ready.files[0]!.id)),
    constraintFailure,
  )
})

test('concurrent submit requests commit one receipt and one audit', async () => {
  const f = await fixture()
  await addReviewer(f.unitId)
  const ready = await complete(f)
  const responses = await Promise.all([
    f.service.submit(f.actor, ready.id, ready.revision),
    f.service.submit(f.actor, ready.id, ready.revision),
  ])
  assert.equal(responses[0].revision, ready.revision + 1)
  assert.equal(responses[0].submittedAt, responses[1].submittedAt)
  assert.equal((await intakeAudit('SUBMISSION_SUBMIT')).length, 1)
})

for (const competitor of ['save', 'upload', 'remove', 'publish'] as const) {
  test(`submit serializes a competing ${competitor} while verifying original files`, async () => {
    const f = await fixture()
    const reviewer = await addReviewer(f.unitId)
    const ready = await complete(f)
    let nextVersionId: string | undefined
    if (competitor === 'publish') {
      await db
        .insert(permissions)
        .values({ code: 'service.configure', name: 'Cấu hình thủ tục' })
        .onConflictDoNothing()
      const [permission] = await db
        .select()
        .from(permissions)
        .where(eq(permissions.code, 'service.configure'))
      await db
        .insert(rolePermissions)
        .values({ roleId: reviewer.roleId, permissionId: permission!.id })
      const [next] = await db
        .insert(procedureVersions)
        .values({
          serviceId: f.serviceId,
          ownerUnitId: f.unitId,
          versionNumber: 2,
          status: 'DRAFT',
          config: f.version.config,
          createdBy: reviewer.userId,
          updatedBy: reviewer.userId,
        })
        .returning()
      nextVersionId = next!.id
    }
    const paused = pauseRead(f.storage)
    const pending = f.service.submit(f.actor, ready.id, ready.revision)
    const sentResult = pending.then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    )
    let competing: Promise<unknown> | undefined
    try {
      await paused.waitFor(pending)
      competing =
        competitor === 'save'
          ? f.service.save(f.actor, ready.id, ready.revision, { purpose: 'Sửa đồng thời' })
          : competitor === 'upload'
            ? f.service.upload(
                f.actor,
                ready.id,
                ready.revision,
                'extraProof',
                pdf,
                'a.pdf',
                'application/pdf',
              )
            : competitor === 'remove'
              ? f.service.remove(f.actor, ready.id, ready.revision, ready.files[0]!.id)
              : new DrizzleProcedureRepository().publish(reviewer, nextVersionId!, 1)
      // Attach a rejection handler before releasing the blocked operation.
      void competing.catch(() => undefined)
    } finally {
      paused.resume()
    }
    const result = await sentResult
    assert.ok('value' in result)
    assert.equal(result.value.values.purpose, 'Nội dung riêng tư')
    if (competitor === 'publish') {
      await competing
      assert.equal((await f.service.get(f.actor.userId, ready.id)).status, 'SUBMITTED')
      assert.equal(
        (
          await db.select().from(procedureVersions).where(eq(procedureVersions.id, f.version.id))
        )[0]!.status,
        'RETIRED',
      )
    } else await assert.rejects(() => competing, errorCode(409, 'SUBMISSION_READ_ONLY'))
    assert.equal(f.storage.files.size, 1)
    assert.equal((await intakeAudit('SUBMISSION_SUBMIT')).length, 1)
    assert.equal((await db.select().from(submissionFiles)).length, 1)
  })
}

test('upload awaiting storage loses to submit and removes only its unlinked original', async () => {
  const f = await fixture()
  await addReviewer(f.unitId)
  const ready = await complete(f)
  const originalPut = f.storage.put.bind(f.storage)
  const entered = Promise.withResolvers<void>(),
    resume = Promise.withResolvers<void>()
  f.storage.put = async (bytes) => {
    entered.resolve()
    await resume.promise
    return originalPut(bytes)
  }
  const pending = f.service.upload(
    f.actor,
    ready.id,
    ready.revision,
    'extraProof',
    pdf,
    'extra.pdf',
    'application/pdf',
  )
  const settled = pending.then(
    () => null,
    (error: unknown) => error,
  )
  try {
    await entered.promise
    await f.service.submit(f.actor, ready.id, ready.revision)
  } finally {
    resume.resolve()
  }
  assert.ok(errorCode(409, 'SUBMISSION_READ_ONLY')(await settled))
  assert.equal(f.storage.files.size, 1)
  assert.equal((await db.select().from(submissionFiles)).length, 1)
})

test('publish winning the service lock makes old draft submit fail without receipt', async () => {
  const f = await fixture()
  const reviewer = await addReviewer(f.unitId)
  await db
    .insert(permissions)
    .values({ code: 'service.configure', name: 'Cấu hình thủ tục' })
    .onConflictDoNothing()
  const [permission] = await db
    .select()
    .from(permissions)
    .where(eq(permissions.code, 'service.configure'))
  await db.insert(rolePermissions).values({ roleId: reviewer.roleId, permissionId: permission!.id })
  const ready = await complete(f)
  const [next] = await db
    .insert(procedureVersions)
    .values({
      serviceId: f.serviceId,
      ownerUnitId: f.unitId,
      versionNumber: 2,
      status: 'DRAFT',
      config: f.version.config,
      createdBy: reviewer.userId,
      updatedBy: reviewer.userId,
    })
    .returning()
  await new DrizzleProcedureRepository().publish(reviewer, next!.id, 1)
  await assert.rejects(
    () => f.service.submit(f.actor, ready.id, ready.revision),
    errorCode(409, 'PROCEDURE_UNAVAILABLE'),
  )
  assert.equal((await intakeAudit('SUBMISSION_SUBMIT')).length, 0)
})

for (const download of ['owner', 'reviewer'] as const) {
  test(`${download} download rechecks permission after deferred storage I/O`, async () => {
    const f = await fixture()
    const reviewer = await addReviewer(f.unitId)
    const ready = await complete(f)
    const sent = await f.service.submit(f.actor, ready.id, ready.revision)
    const paused = pauseRead(f.storage)
    const userId = download === 'owner' ? f.actor.userId : reviewer.userId
    const pending =
      download === 'owner'
        ? f.service.download(userId, sent.id, sent.files[0]!.id)
        : f.service.reviewDownload(userId, sent.id, sent.files[0]!.id)
    const settled = pending.then(
      () => null,
      (error: unknown) => error,
    )
    try {
      await paused.waitFor(pending)
      await db.update(users).set({ mustChangePassword: true }).where(eq(users.id, userId))
    } finally {
      paused.resume()
    }
    assert.ok(errorCode(403)(await settled))
  })
}

test('a required refreshed profile becoming blank during file verification blocks submit', async () => {
  const f = await fixture()
  await addReviewer(f.unitId)
  const ready = await complete(f)
  const paused = pauseRead(f.storage)
  const pending = f.service.submit(f.actor, ready.id, ready.revision)
  const settled = pending.then(
    () => null,
    (error: unknown) => error,
  )
  try {
    await paused.waitFor(pending)
    await db.update(users).set({ fullName: '   ' }).where(eq(users.id, f.actor.userId))
  } finally {
    paused.resume()
  }
  assert.ok(errorCode(422, 'INCOMPLETE_SUBMISSION')(await settled))
  assert.equal((await f.service.get(f.actor.userId, ready.id)).status, 'DRAFT')
})
function reviewCookie(
  app: ReturnType<typeof buildApp>,
  actor: SubmissionActor,
  portal: 'user' | 'admin',
  roles = portal === 'user' ? ['FACULTY_REVIEWER'] : ['ADMIN'],
  mustChangePassword = false,
) {
  return (
    `${portal}_session=` +
    app.jwt.sign(
      {
        sub: actor.userId,
        username: actor.username,
        roles,
        mustChangePassword,
        portal,
        aud: portal === 'user' ? USER_JWT_AUDIENCE : ADMIN_JWT_AUDIENCE,
        iss: JWT_ISSUER,
      },
      { expiresIn: '5m' },
    )
  )
}

test('HTTP submit uses owner session/current authority, Origin and expectedRevision contract', async (t) => {
  const f = await httpFixture(t)
  await addReviewer(f.unitId)
  const ready = await complete(f)
  const url = `/api/v1/user/submissions/${ready.id}/submit`
  assert.equal(
    (await f.app.inject({ method: 'POST', url, payload: { expectedRevision: ready.revision } }))
      .statusCode,
    401,
  )
  for (const origin of [undefined, 'https://attacker.example']) {
    const response = await f.app.inject({
      method: 'POST',
      url,
      headers: { cookie: f.cookie(), ...(origin ? { origin } : {}) },
      payload: { expectedRevision: ready.revision },
    })
    assert.equal(response.statusCode, 403, response.body)
  }
  for (const payload of [{}, { expectedRevision: 0 }])
    assert.equal(
      (
        await f.app.inject({
          method: 'POST',
          url,
          headers: { cookie: f.cookie(), origin: env.corsOrigin },
          payload,
        })
      ).statusCode,
      400,
    )
  const idor = await f.app.inject({
    method: 'POST',
    url,
    headers: { cookie: f.cookie(f.otherId), origin: env.corsOrigin },
    payload: { expectedRevision: ready.revision },
  })
  assert.equal(idor.statusCode, 404)
  const sent = await f.app.inject({
    method: 'POST',
    url,
    headers: { cookie: f.cookie(), origin: env.corsOrigin },
    payload: { expectedRevision: ready.revision },
  })
  assert.equal(sent.statusCode, 200, sent.body)
  assert.equal(sent.json<DraftView>().status, 'SUBMITTED')
  assert.equal(sent.json<DraftView>().editable, false)
  await db.update(users).set({ mustChangePassword: true }).where(eq(users.id, f.actor.userId))
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url,
        headers: { cookie: f.cookie(), origin: env.corsOrigin },
        payload: { expectedRevision: ready.revision },
      })
    ).statusCode,
    403,
  )
})

for (const portal of ['user', 'admin'] as const) {
  test(`HTTP ${portal} intake enforces portal, current DB scope, status filter, safe detail, private files and Origin`, async (t) => {
    const f = await httpFixture(t)
    const reviewer = await addReviewer(f.unitId)
    const ready = await complete(f)
    const sent = await f.service.submit(f.actor, ready.id, ready.revision)
    const base = `/api/v1/${portal}/review-submissions`
    const cookie = reviewCookie(f.app, reviewer, portal)
    assert.equal((await f.app.inject({ url: base })).statusCode, 401)
    assert.equal(
      (
        await f.app.inject({
          url: base,
          headers: { cookie: reviewCookie(f.app, reviewer, portal === 'user' ? 'admin' : 'user') },
        })
      ).statusCode,
      401,
    )
    assert.equal(
      (
        await f.app.inject({
          url: base,
          headers: {
            cookie: reviewCookie(
              f.app,
              reviewer,
              portal,
              portal === 'user' ? ['ADMIN'] : ['FACULTY_REVIEWER'],
            ),
          },
        })
      ).statusCode,
      403,
    )
    assert.equal(
      (
        await f.app.inject({
          url: base,
          headers: { cookie: reviewCookie(f.app, reviewer, portal, undefined, true) },
        })
      ).statusCode,
      403,
    )
    assert.equal(
      (await f.app.inject({ url: base, headers: { cookie: reviewCookie(f.app, f.actor, portal) } }))
        .statusCode,
      403,
    )
    const queue = await f.app.inject({ url: base + '?status=SUBMITTED', headers: { cookie } })
    assert.equal(queue.statusCode, 200, queue.body)
    assert.deepEqual(
      queue.json<ReviewQueuePage>().items.map((row) => row.id),
      [sent.id],
    )
    assert.equal(
      (await f.app.inject({ url: base + '?status=DRAFT', headers: { cookie } })).statusCode,
      400,
    )
    assert.deepEqual(
      (await f.app.inject({ url: base + '?status=IN_REVIEW', headers: { cookie } })).json(),
      { items: [], nextCursor: null },
    )
    const detail = await f.app.inject({ url: base + '/' + sent.id, headers: { cookie } })
    assert.equal(detail.statusCode, 200, detail.body)
    for (const secret of ['storageKey', 'designatedReviewerId', 'processorUserId', 'passwordHash'])
      assert.ok(!detail.body.includes(secret))
    assert.deepEqual(
      Object.keys(detail.json<{ studentSnapshot: object }>().studentSnapshot).sort(),
      ['classCode', 'facultyCode', 'fullName', 'studentCode'],
    )
    const filePath = base + '/' + sent.id + '/files/' + sent.files[0]!.id
    const downloaded = await f.app.inject({ url: filePath, headers: { cookie } })
    assert.equal(downloaded.statusCode, 200, downloaded.body)
    assert.equal(downloaded.headers['cache-control'], 'private, no-store')
    assert.equal(downloaded.headers['x-content-type-options'], 'nosniff')
    assert.match(String(downloaded.headers['content-disposition']), /^attachment;/)
    assert.deepEqual(downloaded.rawPayload, pdf)
    assert.equal(
      (
        await f.app.inject({
          url: base + '/' + randomUUID() + '/files/' + sent.files[0]!.id,
          headers: { cookie },
        })
      ).statusCode,
      404,
    )
    const [file] = await db.select().from(submissionFiles)
    f.storage.files.set(file!.storageKey, Buffer.concat([pdf, Buffer.from('extra')]))
    const corrupt = await f.app.inject({ url: filePath, headers: { cookie } })
    assert.equal(corrupt.statusCode, 503)
    assert.ok(!corrupt.body.includes(file!.storageKey))
    f.storage.files.set(file!.storageKey, pdf)
    const claimUrl = base + '/' + sent.id + '/claim'
    for (const origin of [undefined, 'https://attacker.example'])
      assert.equal(
        (
          await f.app.inject({
            method: 'POST',
            url: claimUrl,
            headers: { cookie, ...(origin ? { origin } : {}) },
            payload: { expectedRevision: sent.revision },
          })
        ).statusCode,
        403,
      )
    assert.equal(
      (
        await f.app.inject({
          method: 'POST',
          url: claimUrl,
          headers: { cookie, origin: env.corsOrigin },
          payload: { expectedRevision: 0 },
        })
      ).statusCode,
      400,
    )
    const claimed = await f.app.inject({
      method: 'POST',
      url: claimUrl,
      headers: { cookie, origin: env.corsOrigin },
      payload: { expectedRevision: sent.revision },
    })
    assert.equal(claimed.statusCode, 200, claimed.body)
    assert.equal(claimed.json<{ status: string }>().status, 'IN_REVIEW')
    assert.deepEqual(
      (await f.app.inject({ url: base + '?status=SUBMITTED', headers: { cookie } })).json(),
      { items: [], nextCursor: null },
    )
    await db.delete(rolePermissions).where(eq(rolePermissions.roleId, reviewer.roleId))
    for (const url of [base, base + '/' + sent.id, filePath])
      assert.equal((await f.app.inject({ url, headers: { cookie } })).statusCode, 403)
    assert.equal(
      (
        await f.app.inject({
          method: 'POST',
          url: claimUrl,
          headers: { cookie, origin: env.corsOrigin },
          payload: { expectedRevision: sent.revision },
        })
      ).statusCode,
      403,
    )
  })
}

test('HTTP failed submit emits no private answers/storage keys in response or error log and rolls back', async (t) => {
  const errors: unknown[][] = []
  const f = await httpFixture(t, (app) => {
    app.addHook('onRequest', async (request) => {
      request.log.error = (...args: unknown[]) => {
        errors.push(args)
      }
    })
  })
  await addReviewer(f.unitId)
  const ready = await complete(f)
  const [file] = await db.select().from(submissionFiles)
  await db.execute(
    sql.raw(
      "CREATE FUNCTION s5t_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test audit unavailable'; END; $$",
    ),
  )
  await db.execute(
    sql.raw(
      "CREATE TRIGGER s5t_fail_audit BEFORE INSERT ON audit_logs FOR EACH ROW WHEN (NEW.action = 'SUBMISSION_SUBMIT') EXECUTE FUNCTION s5t_fail_audit()",
    ),
  )
  const response = await f.app.inject({
    method: 'POST',
    url: `/api/v1/user/submissions/${ready.id}/submit`,
    headers: { cookie: f.cookie(), origin: env.corsOrigin },
    payload: { expectedRevision: ready.revision },
  })
  assert.equal(response.statusCode, 500)
  assert.equal(response.json<{ code: string }>().code, 'SUBMISSION_FAILED')
  assert.ok(response.json<{ requestId: string }>().requestId)
  assert.equal(errors.length, 1)
  const serialized = JSON.stringify(errors) + response.body
  for (const secret of [
    'Nội dung riêng tư',
    file!.storageKey,
    'test audit unavailable',
    'insert into',
  ])
    assert.ok(!serialized.includes(secret))
  assert.equal((await f.service.get(f.actor.userId, ready.id)).status, 'DRAFT')
})

async function grantReject(reviewer: { roleId: number }) {
  await db
    .insert(permissions)
    .values({ code: 'submission.reject', name: 'Không chấp thuận hồ sơ' })
    .onConflictDoNothing()
  const [permission] = await db
    .select()
    .from(permissions)
    .where(eq(permissions.code, 'submission.reject'))
  await db
    .insert(rolePermissions)
    .values({ roleId: reviewer.roleId, permissionId: permission!.id })
    .onConflictDoNothing()
  return permission!.id
}
async function resolutionFixture() {
  const f = await fixture('ONLINE', true)
  const reviewer = f.designatedReviewer!
  await grantReject(reviewer)
  const ready = await complete(f)
  const sent = await f.service.submit(f.actor, ready.id, ready.revision)
  const claimed = await f.service.claim(reviewer, sent.id, sent.revision)
  return { ...f, reviewer, ready, sent, claimed }
}
test('two supplement cycles keep submitted rounds private, original bytes/history, first intake and pinned retired form', async () => {
  const f = await resolutionFixture()
  assert.equal(f.sent.roundNumber, 1)
  assert.equal(f.sent.rounds[0]!.source, 'LIVE')
  assert.deepEqual(f.sent.rounds[0]!.declarationTemplate, newDeclarationTemplateBinding())
  assert.deepEqual(
    f.sent.events.map((event) => event.action),
    ['SUBMITTED'],
  )
  const oldFile = f.sent.files[0]!
  let request = await f.service.resolve(
    f.reviewer,
    f.sent.id,
    f.claimed.revision,
    'REQUEST_SUPPLEMENT',
    '  Bổ sung mục đích và minh chứng  ',
  )
  assert.equal(request.status, 'NEEDS_SUPPLEMENT')
  assert.equal(request.events.at(-1)!.note, 'Bổ sung mục đích và minh chứng')
  assert.deepEqual(request.allowedActions, [])
  assert.equal((await f.service.get(f.actor.userId, request.id)).editable, true)
  await db
    .update(procedureVersions)
    .set({ status: 'RETIRED' })
    .where(eq(procedureVersions.id, f.version.id))
  await db.update(services).set({ status: 'INACTIVE' }).where(eq(services.id, f.serviceId))
  let working = await f.service.save(f.actor, request.id, request.revision, {
    purpose: 'Nội dung bổ sung chưa gửi',
    agreed: false,
    amount: 0,
  })
  working = await f.service.remove(f.actor, working.id, working.revision, oldFile.id)
  const newPdf = Buffer.from('%PDF-1.4\nnew original evidence')
  working = await f.service.upload(
    f.actor,
    working.id,
    working.revision,
    'proof',
    newPdf,
    'bổ sung.pdf',
    'application/pdf',
  )
  const newFile = working.files[0]!
  const visible = await f.service.reviewGet(f.reviewer.userId, working.id)
  assert.equal(visible.values.purpose, 'Nội dung riêng tư')
  assert.deepEqual(
    visible.files.map((file) => file.id),
    [oldFile.id],
  )
  assert.ok(!JSON.stringify(visible).includes('Nội dung bổ sung chưa gửi'))
  assert.ok(!JSON.stringify(visible).includes(newFile.id))
  assert.deepEqual(
    (await f.service.reviewDownload(f.reviewer.userId, working.id, oldFile.id)).bytes,
    pdf,
  )
  await assert.rejects(
    () => f.service.reviewDownload(f.reviewer.userId, working.id, newFile.id),
    errorCode(404),
  )
  await assert.rejects(
    () => f.service.download(f.actor.userId, working.id, oldFile.id),
    errorCode(404),
  )
  assert.deepEqual(
    (await f.service.roundDownload(f.actor.userId, working.id, 1, oldFile.id)).bytes,
    pdf,
  )
  assert.deepEqual(
    (await f.service.reviewRoundDownload(f.reviewer.userId, working.id, 1, oldFile.id)).bytes,
    pdf,
  )
  await assert.rejects(
    () => f.service.submit(f.actor, working.id, request.revision),
    errorCode(409, 'REVISION_CONFLICT'),
  )
  let resubmitted = await f.service.submit(f.actor, working.id, working.revision)
  assert.equal(resubmitted.status, 'IN_REVIEW')
  assert.equal(resubmitted.roundNumber, 2)
  assert.equal(resubmitted.submittedAt, f.sent.submittedAt)
  assert.equal(resubmitted.reviewStartedAt, f.claimed.reviewStartedAt)
  assert.equal(resubmitted.rounds[0]!.values.purpose, 'Nội dung riêng tư')
  assert.equal(resubmitted.rounds[1]!.values.purpose, 'Nội dung bổ sung chưa gửi')
  await assert.rejects(
    () => f.service.reviewDownload(f.reviewer.userId, working.id, oldFile.id),
    errorCode(404),
  )
  assert.deepEqual(
    (await f.service.reviewDownload(f.reviewer.userId, working.id, newFile.id)).bytes,
    newPdf,
  )
  request = await f.service.resolve(
    f.reviewer,
    resubmitted.id,
    resubmitted.revision,
    'REQUEST_SUPPLEMENT',
    'Bổ sung lần hai',
  )
  working = await f.service.save(f.actor, request.id, request.revision, {
    purpose: 'Nội dung lần ba',
  })
  await db
    .update(users)
    .set({ fullName: 'Tên mới của sinh viên' })
    .where(eq(users.id, f.actor.userId))
  resubmitted = await f.service.submit(f.actor, working.id, working.revision)
  assert.equal(resubmitted.roundNumber, 3)
  assert.equal(resubmitted.rounds.length, 3)
  for (const round of resubmitted.rounds)
    assert.deepEqual(round.declarationTemplate, newDeclarationTemplateBinding())
  await assert.rejects(() =>
    db.execute(
      sql`UPDATE submission_rounds SET declaration_template = declaration_template WHERE submission_id = ${resubmitted.id}`,
    ),
  )
  assert.equal(resubmitted.rounds[0]!.studentSnapshot.fullName, 'Nguyễn Minh An')
  assert.equal(resubmitted.rounds[2]!.studentSnapshot.fullName, 'Tên mới của sinh viên')
  const approved = await f.service.resolve(
    f.reviewer,
    resubmitted.id,
    resubmitted.revision,
    'APPROVE',
    'Đã kiểm tra nội dung',
  )
  assert.equal(approved.status, 'APPROVED')
  assert.ok(approved.decisionAt)
  assert.deepEqual(approved.allowedActions, [])
  assert.equal((await f.service.get(f.actor.userId, approved.id)).editable, false)
  assert.deepEqual(
    approved.events.map((event) => event.action),
    [
      'SUBMITTED',
      'CLAIMED',
      'SUPPLEMENT_REQUESTED',
      'RESUBMITTED',
      'SUPPLEMENT_REQUESTED',
      'RESUBMITTED',
      'APPROVED',
    ],
  )
  assert.ok(
    approved.rounds.every((round) =>
      round.files.every((file) => file.signatureStatus === 'NOT_CHECKED'),
    ),
  )
  const publicJson = JSON.stringify(approved)
  assert.ok(
    !publicJson.includes('storageKey') &&
      !publicJson.includes('actorUserId') &&
      !publicJson.includes(f.reviewer.userId),
  )
  const [row] = await db.select().from(submissions).where(eq(submissions.id, approved.id))
  assert.equal(row!.reviewerUserId, f.reviewer.userId)
  assert.equal((await f.service.list(f.actor.userId))[0]!.roundNumber, 3)
  assert.deepEqual(
    (await f.service.reviewList(f.reviewer.userId, { status: 'APPROVED' })).items.map(
      (row) => row.id,
    ),
    [approved.id],
  )
  for (const operation of [
    () => f.service.save(f.actor, approved.id, approved.revision, { purpose: 'Đổi kết quả' }),
    () => f.service.remove(f.actor, approved.id, approved.revision, newFile.id),
    () => f.service.resolve(f.reviewer, approved.id, approved.revision, 'REJECT', 'Đổi quyết định'),
  ])
    await assert.rejects(operation, errorCode(409))
})
test('decision authority requires assigned reviewer; reject and scope on the same review role', async () => {
  const f = await fixture()
  const reviewer = await addReviewer(f.unitId),
    observer = await addReviewer(f.unitId)
  const ready = await complete(f),
    sent = await f.service.submit(f.actor, ready.id, ready.revision)
  const claimed = await f.service.claim(reviewer, sent.id, sent.revision)
  assert.deepEqual(claimed.allowedActions, ['APPROVE'])
  assert.deepEqual((await f.service.reviewGet(observer.userId, sent.id)).allowedActions, [])
  await assert.rejects(
    () => f.service.resolve(observer, sent.id, claimed.revision, 'APPROVE', 'Thay người đã nhận'),
    errorCode(403),
  )
  const otherRole = await db
    .insert(roles)
    .values({ code: 'S5T_SPLIT_' + randomUUID(), name: 'Reject only' })
    .returning()
  await db.insert(userRoles).values({ userId: reviewer.userId, roleId: otherRole[0]!.id })
  await grantReject({ roleId: otherRole[0]!.id })
  await db
    .insert(userRoleScopes)
    .values({ userId: reviewer.userId, roleId: otherRole[0]!.id, scopeId: reviewer.scopeId })
  assert.deepEqual((await f.service.reviewGet(reviewer.userId, sent.id)).allowedActions, [
    'APPROVE',
  ])
  for (const action of ['REQUEST_SUPPLEMENT', 'REJECT'] as const)
    await assert.rejects(
      () => f.service.resolve(reviewer, sent.id, claimed.revision, action, 'Đủ lý do'),
      errorCode(403),
    )
  await grantReject(reviewer)
  assert.deepEqual((await f.service.reviewGet(reviewer.userId, sent.id)).allowedActions, [
    'REQUEST_SUPPLEMENT',
    'APPROVE',
    'REJECT',
  ])
  await db
    .delete(userRoleScopes)
    .where(
      and(eq(userRoleScopes.userId, reviewer.userId), eq(userRoleScopes.roleId, reviewer.roleId)),
    )
  await assert.rejects(
    () =>
      f.service.resolve(reviewer, sent.id, claimed.revision, 'REJECT', 'Thiếu scope ở role review'),
    errorCode(403),
  )
})
test('decisions validate note, preserve it privately, normalize retry identity and race once', async () => {
  const f = await resolutionFixture()
  for (const note of ['', '  \n ', 'a'.repeat(2001)])
    await assert.rejects(
      () => f.service.resolve(f.reviewer, f.sent.id, f.claimed.revision, 'APPROVE', note),
      errorCode(422, 'INVALID_DECISION'),
    )
  const outcomes = await Promise.allSettled([
    f.service.resolve(f.reviewer, f.sent.id, f.claimed.revision, 'APPROVE', '  Lý do riêng tư  '),
    f.service.resolve(f.reviewer, f.sent.id, f.claimed.revision, 'REJECT', 'Lý do khác'),
  ])
  assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1)
  const winner = outcomes.find((outcome) => outcome.status === 'fulfilled')!
  assert.ok(winner.status === 'fulfilled')
  const decision = winner.value,
    action = decision.status === 'APPROVED' ? 'APPROVE' : 'REJECT',
    note = decision.events.at(-1)!.note!
  const retry = await f.service.resolve(
    f.reviewer,
    f.sent.id,
    f.claimed.revision,
    action,
    ' ' + note + ' ',
  )
  assert.equal(retry.revision, decision.revision)
  assert.equal(retry.events.length, 3)
  await assert.rejects(
    () => f.service.resolve(f.reviewer, f.sent.id, f.claimed.revision, action, note + '.'),
    errorCode(409, 'REVISION_CONFLICT'),
  )
  const audit = JSON.stringify(await db.select().from(auditLogs))
  assert.ok(!audit.includes(note) && !audit.includes('Lý do riêng tư'))
  await db.update(users).set({ mustChangePassword: true }).where(eq(users.id, f.reviewer.userId))
  await assert.rejects(
    () => f.service.resolve(f.reviewer, f.sent.id, f.claimed.revision, action, note),
    errorCode(403),
  )
})
test('a prior-cycle exact decision retry returns current state without creating a second request', async () => {
  const f = await resolutionFixture()
  const request = await f.service.resolve(
    f.reviewer,
    f.sent.id,
    f.claimed.revision,
    'REQUEST_SUPPLEMENT',
    'Bổ sung vòng một',
  )
  const sent = await f.service.submit(f.actor, request.id, request.revision)
  const retry = await f.service.resolve(
    f.reviewer,
    request.id,
    f.claimed.revision,
    'REQUEST_SUPPLEMENT',
    'Bổ sung vòng một',
  )
  assert.equal(retry.status, 'IN_REVIEW')
  assert.equal(retry.roundNumber, 2)
  assert.equal(retry.revision, sent.revision)
  assert.equal(retry.events.filter((event) => event.action === 'SUPPLEMENT_REQUESTED').length, 1)
  await assert.rejects(
    () =>
      f.service.resolve(
        f.reviewer,
        request.id,
        f.claimed.revision,
        'REQUEST_SUPPLEMENT',
        'Bổ sung vòng hai',
      ),
    errorCode(409),
  )
  const next = await f.service.resolve(
    f.reviewer,
    request.id,
    sent.revision,
    'REQUEST_SUPPLEMENT',
    'Bổ sung vòng hai',
  )
  assert.equal(next.events.filter((event) => event.action === 'SUPPLEMENT_REQUESTED').length, 2)
})

for (const failure of ['event', 'audit'] as const) {
  for (const operation of ['decision', 'resubmit'] as const) {
    test(
      failure + ' insertion failure rolls back ' + operation + ' revision/round/history atomically',
      async () => {
        const f = await resolutionFixture()
        const before =
          operation === 'decision'
            ? await f.service.get(f.actor.userId, f.sent.id)
            : await f.service.resolve(
                f.reviewer,
                f.sent.id,
                f.claimed.revision,
                'REQUEST_SUPPLEMENT',
                'Yêu cầu bổ sung',
              )
        const table = failure === 'event' ? 'submission_events' : 'audit_logs',
          name = 's5t_fail_' + failure
        await db.execute(
          sql.raw(
            'CREATE FUNCTION ' +
              name +
              "() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated private-data failure'; END; $$",
          ),
        )
        await db.execute(
          sql.raw(
            'CREATE TRIGGER ' +
              name +
              ' BEFORE INSERT ON ' +
              table +
              ' FOR EACH ROW EXECUTE FUNCTION ' +
              name +
              '()',
          ),
        )
        const revision = before.revision
        await assert.rejects(() =>
          operation === 'decision'
            ? f.service.resolve(f.reviewer, before.id, revision, 'APPROVE', 'Lý do riêng tư')
            : f.service.submit(f.actor, before.id, revision),
        )
        const current = await f.service.get(f.actor.userId, before.id)
        assert.equal(current.status, before.status)
        assert.equal(current.revision, revision)
        assert.equal(current.rounds.length, before.rounds.length)
        assert.equal(current.events.length, before.events.length)
      },
    )
  }
}
test('SQL freezes bindings/routing/reviewer and round/event history while allowing only soft removal of working evidence', async () => {
  const f = await resolutionFixture()
  const pending = await f.service.resolve(
    f.reviewer,
    f.sent.id,
    f.claimed.revision,
    'REQUEST_SUPPLEMENT',
    'Bổ sung',
  )
  for (const change of [
    sql`service_name = 'Đổi binding'`,
    sql`student_user_id = ${f.otherId}`,
    sql`processing_unit_id = NULL`,
    sql`designated_reviewer_id = NULL`,
    sql`review_started_at = now()`,
    sql`student_snapshot = '{}'::jsonb`,
    sql`round_number = 2`,
    sql`last_submitted_at = now()`,
    sql`submitted_at = now()`,
  ])
    await assert.rejects(() =>
      db.execute(
        sql`UPDATE submissions SET ${change}, revision = revision + 1 WHERE id = ${pending.id}`,
      ),
    )
  const file = f.sent.files[0]!
  for (const change of [
    sql`name = 'changed.pdf'`,
    sql`storage_key = ${randomUUID()}`,
    sql`sha256 = ${'b'.repeat(64)}`,
    sql`size = 100`,
    sql`attachment_key = 'extraProof'`,
  ])
    await assert.rejects(() =>
      db.execute(sql`UPDATE submission_files SET ${change} WHERE id = ${file.id}`),
    )
  await assert.rejects(() => db.execute(sql`DELETE FROM submission_files WHERE id = ${file.id}`))
  const removed = await f.service.remove(f.actor, pending.id, pending.revision, file.id)
  await assert.rejects(() =>
    db.execute(sql`UPDATE submission_files SET removed_at = NULL WHERE id = ${file.id}`),
  )
  await assert.rejects(() =>
    db.execute(sql`UPDATE submission_files SET removed_at = now() WHERE id = ${file.id}`),
  )
  await assert.rejects(() => db.execute(sql`DELETE FROM submission_files WHERE id = ${file.id}`))
  for (const table of ['submission_rounds', 'submission_events'])
    for (const operation of ['UPDATE ' + table + ' SET id = id', 'DELETE FROM ' + table])
      await assert.rejects(() =>
        db.execute(sql.raw(operation + " WHERE submission_id = '" + pending.id + "'")),
      )
  const replacement = await f.service.upload(
    f.actor,
    removed.id,
    removed.revision,
    'proof',
    pdf,
    'new.pdf',
    'application/pdf',
  )
  await assert.rejects(() =>
    db.execute(sql`DELETE FROM submission_files WHERE id = ${replacement.files[0]!.id}`),
  )
  assert.equal(removed.rounds[0]!.files[0]!.id, file.id)
  assert.deepEqual(
    (await f.service.roundDownload(f.actor.userId, pending.id, 1, file.id)).bytes,
    pdf,
  )
  const [round] = await db
    .select()
    .from(submissionRounds)
    .where(eq(submissionRounds.submissionId, pending.id))
  await assert.rejects(() => db.insert(submissionRounds).values({ ...round!, id: randomUUID() }))
  const [event] = await db
    .select()
    .from(submissionEvents)
    .where(eq(submissionEvents.submissionId, pending.id))
  await assert.rejects(() => db.insert(submissionEvents).values({ ...event!, id: randomUUID() }))
})
test('event composite FK rejects a round from another submission and history downloads reject wrong round or owner', async () => {
  const f = await resolutionFixture()
  const otherActor = { ...f.actor, userId: f.otherId }
  const ready = await complete(f, otherActor)
  const other = await f.service.submit(otherActor, ready.id, ready.revision)
  const [foreignRound] = await db
    .select()
    .from(submissionRounds)
    .where(eq(submissionRounds.submissionId, other.id))
  await assert.rejects(() =>
    db.insert(submissionEvents).values({
      submissionId: f.sent.id,
      roundId: foreignRound!.id,
      action: 'APPROVED',
      actorUserId: f.reviewer.userId,
      actorName: 'Cán bộ',
      note: 'Sai hồ sơ',
      fromRevision: 1000,
      toRevision: 1001,
    }),
  )
  const fileId = f.sent.files[0]!.id
  await assert.rejects(
    () => f.service.roundDownload(f.otherId, f.sent.id, 1, fileId),
    errorCode(404),
  )
  await assert.rejects(
    () => f.service.roundDownload(f.actor.userId, f.sent.id, 2, fileId),
    errorCode(404),
  )
  await assert.rejects(
    () => f.service.reviewRoundDownload(f.reviewer.userId, other.id, 1, fileId),
    errorCode(404),
  )
  await assert.rejects(
    () => f.service.reviewRoundDownload(f.reviewer.userId, f.sent.id, 2, fileId),
    errorCode(404),
  )
})
for (const download of ['owner', 'reviewer'] as const) {
  test(
    'historical ' + download + ' downloads verify size/hash and reauthorize after storage I/O',
    async () => {
      const f = await resolutionFixture(),
        fileId = f.sent.files[0]!.id
      const operation = () =>
        download === 'owner'
          ? f.service.roundDownload(f.actor.userId, f.sent.id, 1, fileId)
          : f.service.reviewRoundDownload(f.reviewer.userId, f.sent.id, 1, fileId)
      const [file] = await db.select().from(submissionFiles).where(eq(submissionFiles.id, fileId))
      f.storage.files.set(file!.storageKey, Buffer.from('x'.repeat(pdf.length)))
      await assert.rejects(operation, errorCode(503, 'FILE_INTEGRITY'))
      f.storage.files.set(file!.storageKey, Buffer.concat([pdf, Buffer.from('extra')]))
      await assert.rejects(operation, errorCode(503, 'FILE_INTEGRITY'))
      f.storage.files.set(file!.storageKey, pdf)
      const barrier = pauseRead(f.storage),
        pending = operation()
      const settled = pending.then(
        () => null,
        (error) => error as unknown,
      )
      try {
        await barrier.waitFor(pending)
        await db
          .update(users)
          .set({ mustChangePassword: true })
          .where(eq(users.id, download === 'owner' ? f.actor.userId : f.reviewer.userId))
      } finally {
        barrier.resume()
      }
      assert.ok(errorCode(403)(await settled))
    },
  )
}
for (const revoke of ['profile', 'reviewer', 'unit', 'reject-only'] as const) {
  test(
    'resubmit rechecks ' + revoke + ' after original byte verification without silent reassignment',
    async () => {
      const f = await resolutionFixture()
      const request = await f.service.resolve(
        f.reviewer,
        f.sent.id,
        f.claimed.revision,
        'REQUEST_SUPPLEMENT',
        'Bổ sung',
      )
      const barrier = pauseRead(f.storage),
        pending = f.service.submit(f.actor, request.id, request.revision)
      const settled = pending.then(
        () => null,
        (error) => error as unknown,
      )
      try {
        await barrier.waitFor(pending)
        if (revoke === 'profile')
          await db
            .update(users)
            .set({ mustChangePassword: true })
            .where(eq(users.id, f.actor.userId))
        if (revoke === 'reviewer')
          await db
            .delete(rolePermissions)
            .where(
              and(
                eq(rolePermissions.roleId, f.reviewer.roleId),
                eq(rolePermissions.permissionId, f.reviewer.permissionId),
              ),
            )
        if (revoke === 'unit')
          await db
            .update(organizationalUnits)
            .set({ status: 'INACTIVE' })
            .where(eq(organizationalUnits.id, f.unitId))
        if (revoke === 'reject-only') {
          const [permission] = await db
            .select()
            .from(permissions)
            .where(eq(permissions.code, 'submission.reject'))
          await db
            .delete(rolePermissions)
            .where(
              and(
                eq(rolePermissions.roleId, f.reviewer.roleId),
                eq(rolePermissions.permissionId, permission!.id),
              ),
            )
        }
      } finally {
        barrier.resume()
      }
      const result = await settled
      if (revoke === 'reject-only') {
        assert.equal(
          result,
          null,
          'Resubmission needs current review, not current reject permission',
        )
        assert.equal((await f.service.get(f.actor.userId, request.id)).roundNumber, 2)
      } else {
        assert.ok(
          errorCode(
            revoke === 'profile' ? 403 : 409,
            revoke === 'profile' ? 'STUDENT_UNAVAILABLE' : 'ROUTING_UNAVAILABLE',
          )(result),
        )
        const [row] = await db.select().from(submissions).where(eq(submissions.id, request.id))
        assert.equal(row!.status, 'NEEDS_SUPPLEMENT')
        assert.equal(row!.revision, request.revision)
        assert.equal(
          (
            await db
              .select()
              .from(submissionRounds)
              .where(eq(submissionRounds.submissionId, request.id))
          ).length,
          1,
        )
      }
    },
  )
}

for (const portal of ['user', 'admin'] as const) {
  test(
    'HTTP ' +
      portal +
      ' resolution validates session/Origin/note/current role and serves private round files',
    async (t) => {
      const f = await httpFixture(t),
        reviewer = await addReviewer(f.unitId),
        observer = await addReviewer(f.unitId)
      await grantReject(reviewer)
      const ready = await complete(f),
        sent = await f.service.submit(f.actor, ready.id, ready.revision)
      const claimed = await f.service.claim(reviewer, sent.id, sent.revision)
      const base = '/api/v1/' + portal + '/review-submissions',
        url = base + '/' + sent.id + '/resolve'
      const cookie = reviewCookie(f.app, reviewer, portal)
      const payload = {
        expectedRevision: claimed.revision,
        action: 'REQUEST_SUPPLEMENT',
        note: 'Bổ sung theo yêu cầu',
      }
      assert.equal((await f.app.inject({ method: 'POST', url, payload })).statusCode, 401)
      assert.equal(
        (
          await f.app.inject({
            method: 'POST',
            url,
            payload,
            headers: {
              cookie: reviewCookie(f.app, reviewer, portal === 'user' ? 'admin' : 'user'),
              origin: env.corsOrigin,
            },
          })
        ).statusCode,
        401,
      )
      assert.equal(
        (
          await f.app.inject({
            method: 'POST',
            url,
            payload,
            headers: {
              cookie: reviewCookie(f.app, reviewer, portal, ['ADMIN'], true),
              origin: env.corsOrigin,
            },
          })
        ).statusCode,
        403,
      )
      for (const origin of [undefined, 'https://attacker.example'])
        assert.equal(
          (
            await f.app.inject({
              method: 'POST',
              url,
              payload,
              headers: { cookie, ...(origin ? { origin } : {}) },
            })
          ).statusCode,
          403,
        )
      assert.equal(
        (
          await f.app.inject({
            method: 'POST',
            url,
            payload,
            headers: { cookie: reviewCookie(f.app, observer, portal), origin: env.corsOrigin },
          })
        ).statusCode,
        403,
      )
      for (const invalid of [
        { ...payload, action: 'SIGN' },
        { ...payload, expectedRevision: 0 },
      ])
        assert.equal(
          (
            await f.app.inject({
              method: 'POST',
              url,
              payload: invalid,
              headers: { cookie, origin: env.corsOrigin },
            })
          ).statusCode,
          400,
        )
      for (const note of [null, false, 123, {}, []])
        assert.equal(
          (
            await f.app.inject({
              method: 'POST',
              url,
              payload: { ...payload, note },
              headers: { cookie, origin: env.corsOrigin },
            })
          ).statusCode,
          422,
        )
      const invalidNote = await f.app.inject({
        method: 'POST',
        url,
        payload: { ...payload, note: '   ' },
        headers: { cookie, origin: env.corsOrigin },
      })
      assert.equal(invalidNote.statusCode, 422)
      assert.equal(invalidNote.json<{ issues: { path: string }[] }>().issues[0]!.path, 'note')
      const longNote = await f.app.inject({
        method: 'POST',
        url,
        payload: { ...payload, note: 'a'.repeat(2001) },
        headers: { cookie, origin: env.corsOrigin },
      })
      assert.equal(longNote.statusCode, 422)
      const validNote = 'a'.repeat(2000)
      const accepted = await f.app.inject({
        method: 'POST',
        url,
        payload: { ...payload, note: '  ' + validNote + '  ' },
        headers: { cookie, origin: env.corsOrigin },
      })
      assert.equal(accepted.statusCode, 200, accepted.body)
      const detail = accepted.json<DraftView>()
      assert.equal(detail.status, 'NEEDS_SUPPLEMENT')
      assert.equal(detail.events.at(-1)!.note, validNote)
      assert.ok(!accepted.body.includes('storageKey') && !accepted.body.includes('actorUserId'))
      assert.equal(
        (
          await f.app.inject({ url: base + '?status=NEEDS_SUPPLEMENT', headers: { cookie } })
        ).json<ReviewQueuePage>().items.length,
        1,
      )
      for (const state of ['APPROVED', 'REJECTED'])
        assert.deepEqual(
          (await f.app.inject({ url: base + '?status=' + state, headers: { cookie } })).json(),
          { items: [], nextCursor: null },
        )
      const filePath = base + '/' + sent.id + '/rounds/1/files/' + sent.files[0]!.id
      assert.equal((await f.app.inject({ url: filePath })).statusCode, 401)
      const original = await f.app.inject({ url: filePath, headers: { cookie } })
      assert.equal(original.statusCode, 200)
      assert.deepEqual(original.rawPayload, pdf)
      assert.equal(original.headers['cache-control'], 'private, no-store')
      assert.equal(original.headers['x-content-type-options'], 'nosniff')
      assert.match(String(original.headers['content-disposition']), /^attachment;/)
      assert.equal(
        (
          await f.app.inject({
            url: filePath.replace('/rounds/1/', '/rounds/2/'),
            headers: { cookie },
          })
        ).statusCode,
        404,
      )
      const ownerPath =
        '/api/v1/user/submissions/' + sent.id + '/rounds/1/files/' + sent.files[0]!.id
      assert.equal(
        (await f.app.inject({ url: ownerPath, headers: { cookie: f.cookie() } })).statusCode,
        200,
      )
      assert.equal(
        (await f.app.inject({ url: ownerPath, headers: { cookie: f.cookie(f.otherId) } }))
          .statusCode,
        404,
      )
      const resubmitted = await f.service.submit(f.actor, detail.id, detail.revision)
      const reject = await f.app.inject({
        method: 'POST',
        url,
        payload: {
          expectedRevision: resubmitted.revision,
          action: 'REJECT',
          note: 'Không đủ nội dung cần thiết',
        },
        headers: { cookie, origin: env.corsOrigin },
      })
      assert.equal(reject.statusCode, 200, reject.body)
      assert.equal(reject.json<{ status: string }>().status, 'REJECTED')
      assert.equal(
        (
          await f.app.inject({ url: base + '?status=REJECTED', headers: { cookie } })
        ).json<ReviewQueuePage>().items.length,
        1,
      )
      await db.delete(rolePermissions).where(eq(rolePermissions.roleId, reviewer.roleId))
      assert.equal((await f.app.inject({ url: filePath, headers: { cookie } })).statusCode, 403)
      assert.equal(
        (
          await f.app.inject({
            method: 'POST',
            url,
            payload: {
              expectedRevision: resubmitted.revision,
              action: 'REJECT',
              note: 'Không đủ nội dung cần thiết',
            },
            headers: { cookie, origin: env.corsOrigin },
          })
        ).statusCode,
        403,
      )
    },
  )
}
test('HTTP failed decision hides private note and storage keys, returning unknown outcome safely with rollback', async (t) => {
  const errors: unknown[][] = []
  const f = await httpFixture(t, (app) =>
    app.addHook('onRequest', async (request) => {
      request.log.error = (...args: unknown[]) => {
        errors.push(args)
      }
    }),
  )
  const reviewer = await addReviewer(f.unitId)
  const ready = await complete(f),
    sent = await f.service.submit(f.actor, ready.id, ready.revision)
  const claimed = await f.service.claim(reviewer, sent.id, sent.revision)
  const [file] = await db.select().from(submissionFiles)
  await db.execute(
    sql.raw(
      "CREATE FUNCTION s5t_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test audit unavailable'; END; $$",
    ),
  )
  await db.execute(
    sql.raw(
      'CREATE TRIGGER s5t_fail_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION s5t_fail_audit()',
    ),
  )
  const note = 'Nội dung quyết định riêng tư <script>alert(1)</script>'
  const response = await f.app.inject({
    method: 'POST',
    url: '/api/v1/user/review-submissions/' + sent.id + '/resolve',
    headers: { cookie: reviewCookie(f.app, reviewer, 'user'), origin: env.corsOrigin },
    payload: { expectedRevision: claimed.revision, action: 'APPROVE', note },
  })
  assert.equal(response.statusCode, 500)
  assert.equal(errors.length, 1)
  const serialized = JSON.stringify(errors) + response.body
  for (const secret of [note, 'Nội dung riêng tư', file!.storageKey, 'test audit unavailable'])
    assert.ok(!serialized.includes(secret))
  const current = await f.service.get(f.actor.userId, sent.id)
  assert.equal(current.status, 'IN_REVIEW')
  assert.equal(current.revision, claimed.revision)
  assert.equal(current.events.length, 2)
})

async function grantAssign(reviewer: { roleId: number }) {
  await db
    .insert(permissions)
    .values({ code: 'submission.assign', name: 'Bàn giao hồ sơ' })
    .onConflictDoNothing()
  const [permission] = await db
    .select()
    .from(permissions)
    .where(eq(permissions.code, 'submission.assign'))
  await db
    .insert(rolePermissions)
    .values({ roleId: reviewer.roleId, permissionId: permission!.id })
    .onConflictDoNothing()
  return permission!.id
}
async function portalRole(userId: string, code = 'FACULTY_REVIEWER') {
  await db.insert(roles).values({ code, name: 'Vai trò dùng cổng' }).onConflictDoNothing()
  const [role] = await db.select().from(roles).where(eq(roles.code, code))
  await db.insert(userRoles).values({ userId, roleId: role!.id }).onConflictDoNothing()
}
async function handoverFixture() {
  const f = await resolutionFixture()
  const supervisor = await addReviewer(f.unitId),
    next = await addReviewer(f.unitId)
  await grantAssign(supervisor)
  await grantReject(next)
  await portalRole(supervisor.userId, 'ADMIN')
  await portalRole(next.userId)
  await portalRole(f.reviewer.userId)
  return { ...f, supervisor, next, notices: new DrizzleNotificationRepository() }
}
test('reassignment preserves designated routing, working copy and original rounds; old reviewer loses private access and supplement goes to new reviewer', async () => {
  const f = await handoverFixture()
  const pending = await f.service.resolve(
    f.reviewer,
    f.sent.id,
    f.claimed.revision,
    'REQUEST_SUPPLEMENT',
    'Bổ sung riêng tư',
  )
  const working = await f.service.save(f.actor, pending.id, pending.revision, {
    purpose: 'Đang sửa riêng tư',
    amount: 0,
    agreed: false,
  })
  const [before] = await db.select().from(submissions).where(eq(submissions.id, pending.id))
  const candidates = await f.service.assignees(f.supervisor.userId, pending.id)
  assert.ok(candidates.candidates.some((p) => p.id === f.next.userId))
  assert.ok(!candidates.candidates.some((p) => [f.reviewer.userId, f.actor.userId].includes(p.id)))
  const transferred = await f.service.reassign(
    f.supervisor,
    pending.id,
    working.revision,
    f.next.userId,
    '  Cán bộ mới tiếp tục xử lý  ',
  )
  assert.equal(transferred.canReassign, true)
  assert.deepEqual(transferred.allowedActions, [])
  assert.equal(transferred.status, 'NEEDS_SUPPLEMENT')
  assert.equal(transferred.values.purpose, 'Nội dung riêng tư')
  const [afterRow] = await db.select().from(submissions).where(eq(submissions.id, pending.id))
  const stable = (row: typeof submissions.$inferSelect) => {
    const { reviewerUserId: _reviewer, revision: _revision, updatedAt: _updated, ...rest } = row
    return rest
  }
  assert.deepEqual(stable(afterRow!), stable(before!))
  assert.equal(afterRow!.reviewerUserId, f.next.userId)
  assert.equal(afterRow!.designatedReviewerId, f.reviewer.userId)
  assert.deepEqual(transferred.rounds, working.rounds)
  assert.deepEqual(transferred.events.at(-1)!.reassignment, {
    fromReviewerName: 'Cán bộ kiểm thử',
    toReviewerName: 'Cán bộ kiểm thử',
  })
  assert.equal(JSON.stringify(transferred).includes(f.next.userId), false)
  await assert.rejects(
    () => f.service.reviewGet(f.reviewer.userId, pending.id),
    (e: unknown) => e instanceof SubmissionError && e.statusCode === 404,
  )
  await assert.rejects(() =>
    f.service.reviewDownload(f.reviewer.userId, pending.id, f.ready.files[0]!.id),
  )
  await assert.rejects(() =>
    f.service.resolve(f.reviewer, pending.id, transferred.revision, 'APPROVE', 'Không được'),
  )
  await db.update(users).set({ status: 'INACTIVE' }).where(eq(users.id, f.reviewer.userId))
  const sent = await f.service.submit(f.actor, pending.id, transferred.revision)
  assert.equal(sent.status, 'IN_REVIEW')
  assert.equal(sent.roundNumber, 2)
  assert.equal(sent.values.purpose, 'Đang sửa riêng tư')
  const review = await f.service.reviewGet(f.next.userId, pending.id)
  assert.ok(review.allowedActions.includes('APPROVE'))
  const approved = await f.service.resolve(
    f.next,
    pending.id,
    sent.revision,
    'APPROVE',
    'Đủ điều kiện nội dung',
  )
  assert.equal(approved.canReassign, false)
  await assert.rejects(() => f.service.reviewGet(f.supervisor.userId, pending.id))
})
test('assign/review/scope must be on one role; candidates and transfer reject self, inactive or password-pending receivers', async () => {
  const f = await handoverFixture()
  const observer = await addReviewer(f.unitId)
  const [separate] = await db
    .insert(roles)
    .values({ code: 'S5T_A_' + randomUUID(), name: 'Assign only' })
    .returning()
  await db.insert(userRoles).values({ userId: observer.userId, roleId: separate!.id })
  await db
    .insert(userRoleScopes)
    .values({ userId: observer.userId, roleId: separate!.id, scopeId: observer.scopeId })
  await grantAssign({ roleId: separate!.id })
  await assert.rejects(() =>
    f.service.reassign(observer, f.sent.id, f.claimed.revision, f.next.userId, 'Không ghép quyền'),
  )
  assert.equal((await f.service.reviewGet(f.supervisor.userId, f.sent.id)).canReassign, true)
  for (const receiver of [f.actor.userId, f.reviewer.userId, randomUUID()])
    await assert.rejects(
      () => f.service.reassign(f.supervisor, f.sent.id, f.claimed.revision, receiver, 'Bàn giao'),
      (e: unknown) => e instanceof SubmissionError && e.code === 'INVALID_ASSIGNEE',
    )
  await db.update(users).set({ mustChangePassword: true }).where(eq(users.id, f.next.userId))
  await assert.rejects(() =>
    f.service.reassign(f.supervisor, f.sent.id, f.claimed.revision, f.next.userId, 'Bàn giao'),
  )
  assert.ok(
    !(await f.service.assignees(f.supervisor.userId, f.sent.id)).candidates.some(
      (c) => c.id === f.next.userId,
    ),
  )
  for (const note of [null, 3, '  ', 'a'.repeat(2001)])
    await assert.rejects(
      () => f.service.reassign(f.supervisor, f.sent.id, f.claimed.revision, f.next.userId, note),
      (e: unknown) => e instanceof SubmissionError && e.code === 'INVALID_REASSIGNMENT',
    )
  await db.update(users).set({ mustChangePassword: false }).where(eq(users.id, f.next.userId))
  await db
    .delete(rolePermissions)
    .where(
      and(
        eq(rolePermissions.roleId, f.next.roleId),
        eq(rolePermissions.permissionId, f.next.permissionId),
      ),
    )
  await assert.rejects(() =>
    f.service.reassign(f.supervisor, f.sent.id, f.claimed.revision, f.next.userId, 'Bàn giao'),
  )
})
test('exact reassignment retry is idempotent; changed payload and revoked supervisor are rejected', async () => {
  const f = await handoverFixture()
  const transferred = await f.service.reassign(
    f.supervisor,
    f.sent.id,
    f.claimed.revision,
    f.next.userId,
    'Lý do',
  )
  const repeated = await f.service.reassign(
    f.supervisor,
    f.sent.id,
    f.claimed.revision,
    f.next.userId,
    ' Lý do ',
  )
  assert.equal(repeated.revision, transferred.revision)
  const [eventCount] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(submissionEvents)
    .where(
      and(eq(submissionEvents.submissionId, f.sent.id), eq(submissionEvents.action, 'REASSIGNED')),
    )
  assert.equal(eventCount!.n, 1)
  const all = await f.notices.list(f.next.userId, 'user')
  assert.equal(all.items.length, 1)
  await assert.rejects(
    () =>
      f.service.reassign(f.supervisor, f.sent.id, f.claimed.revision, f.next.userId, 'Đổi lý do'),
    (e: unknown) => e instanceof SubmissionError && e.statusCode === 409,
  )
  const assign = await grantAssign(f.supervisor)
  await db
    .delete(rolePermissions)
    .where(
      and(
        eq(rolePermissions.roleId, f.supervisor.roleId),
        eq(rolePermissions.permissionId, assign),
      ),
    )
  await assert.rejects(() =>
    f.service.reassign(f.supervisor, f.sent.id, f.claimed.revision, f.next.userId, 'Lý do'),
  )
})
test('concurrent reassignment requests have one winner and one event with exactly two notifications', async () => {
  const f = await handoverFixture(),
    other = await addReviewer(f.unitId)
  const results = await Promise.allSettled([
    f.service.reassign(f.supervisor, f.sent.id, f.claimed.revision, f.next.userId, 'Người mới A'),
    f.service.reassign(f.supervisor, f.sent.id, f.claimed.revision, other.userId, 'Người mới B'),
  ])
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
  const [counts] = await db.execute<{ events: number; notifications: number }>(
    sql`SELECT (SELECT count(*)::int FROM submission_events WHERE submission_id=${f.sent.id} AND action='REASSIGNED') AS events,(SELECT count(*)::int FROM personal_notifications n JOIN submission_events e ON e.id=n.event_id WHERE e.submission_id=${f.sent.id} AND e.action='REASSIGNED') AS notifications`,
  )
  assert.equal(counts!.events, 1)
  assert.equal(counts!.notifications, 2)
})
test('reassignment racing a decision allows one transaction and keeps content intact', async () => {
  const f = await handoverFixture()
  const results = await Promise.allSettled([
    f.service.reassign(f.supervisor, f.sent.id, f.claimed.revision, f.next.userId, 'Chuyển xử lý'),
    f.service.resolve(f.reviewer, f.sent.id, f.claimed.revision, 'APPROVE', 'Duyệt nội dung'),
  ])
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
  const student = await f.service.get(f.actor.userId, f.sent.id)
  assert.equal(student.revision, f.claimed.revision + 1)
  assert.deepEqual(student.rounds, f.claimed.rounds)
})
test('reassignment racing resubmit retains one winner without losing the supplementary working copy', async () => {
  const f = await handoverFixture()
  const pending = await f.service.resolve(
    f.reviewer,
    f.sent.id,
    f.claimed.revision,
    'REQUEST_SUPPLEMENT',
    'Bổ sung',
  )
  const saved = await f.service.save(f.actor, pending.id, pending.revision, {
    purpose: 'Nội dung bổ sung',
    amount: 0,
    agreed: false,
  })
  const results = await Promise.allSettled([
    f.service.reassign(f.supervisor, pending.id, saved.revision, f.next.userId, 'Bàn giao'),
    f.service.submit(f.actor, pending.id, saved.revision),
  ])
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
  const student = await f.service.get(f.actor.userId, pending.id)
  assert.equal(student.values.purpose, 'Nội dung bổ sung')
  assert.equal(student.revision, saved.revision + 1)
})
test('notification failure rolls back assignment, event, audit and all notification recipients', async () => {
  const f = await handoverFixture()
  const before = await db.select().from(submissions).where(eq(submissions.id, f.sent.id))
  const auditBefore = await intakeAudit('SUBMISSION_REASSIGN')
  await db.execute(
    sql.raw(
      "CREATE FUNCTION s5t_fail_notification() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'notification fail'; END; $$",
    ),
  )
  await db.execute(
    sql.raw(
      'CREATE TRIGGER s5t_fail_notification BEFORE INSERT ON personal_notifications FOR EACH ROW EXECUTE FUNCTION s5t_fail_notification()',
    ),
  )
  await assert.rejects(() =>
    f.service.reassign(f.supervisor, f.sent.id, f.claimed.revision, f.next.userId, 'Bàn giao'),
  )
  assert.deepEqual(await db.select().from(submissions).where(eq(submissions.id, f.sent.id)), before)
  assert.deepEqual(await intakeAudit('SUBMISSION_REASSIGN'), auditBefore)
  const events = await db
    .select()
    .from(submissionEvents)
    .where(
      and(eq(submissionEvents.submissionId, f.sent.id), eq(submissionEvents.action, 'REASSIGNED')),
    )
  assert.equal(events.length, 0)
})
test('personal inbox isolates recipients and hides private data, stale role/scope, former reviewer and foreign read IDs', async () => {
  const f = await handoverFixture()
  const first = await f.notices.list(f.reviewer.userId, 'user')
  assert.equal(first.items.length, 2)
  assert.equal(first.unreadCount, 2)
  const pending = await f.service.resolve(
    f.reviewer,
    f.sent.id,
    f.claimed.revision,
    'REQUEST_SUPPLEMENT',
    'Riêng tư KHÔNG ghi trong thông báo',
  )
  const owner = await f.notices.list(f.actor.userId, 'user')
  assert.equal(owner.items.length, 1)
  assert.ok(!JSON.stringify(owner).includes('Riêng tư'))
  assert.ok(!JSON.stringify(owner).includes(f.actor.userId))
  assert.ok(owner.items[0]!.targetUrl.startsWith('/submissions/'))
  await assert.rejects(() => f.notices.read(f.next.userId, 'user', owner.items[0]!.id))
  const read = await f.notices.read(f.actor.userId, 'user', owner.items[0]!.id)
  assert.equal(read.unreadCount, 0)
  assert.equal((await f.notices.read(f.actor.userId, 'user', read.id)).readAt, read.readAt)
  assert.equal((await f.notices.list(f.actor.userId, 'user', { unreadOnly: true })).items.length, 0)
  await f.service.reassign(f.supervisor, pending.id, pending.revision, f.next.userId, 'Bàn giao')
  assert.equal((await f.notices.list(f.reviewer.userId, 'user')).items.length, 0)
  const inbox = await f.notices.list(f.next.userId, 'user')
  assert.equal(inbox.items.length, 1)
  await db.delete(userRoleScopes).where(eq(userRoleScopes.userId, f.next.userId))
  assert.equal((await f.notices.unreadCount(f.next.userId, 'user')).unreadCount, 0)
  await assert.rejects(() => f.notices.read(f.next.userId, 'user', inbox.items[0]!.id))
  await db.delete(userRoles).where(eq(userRoles.userId, f.next.userId))
  await assert.rejects(
    () => f.notices.list(f.next.userId, 'user'),
    (e: unknown) => e instanceof SubmissionError && e.statusCode === 403,
  )
})
test('notification filtering precedes pagination and keyset cursor preserves microsecond order without duplicates', async () => {
  const f = await handoverFixture()
  const [round] = await db
    .select()
    .from(submissionRounds)
    .where(eq(submissionRounds.submissionId, f.sent.id))
  for (let i = 0; i < 25; i++) {
    const [event] = await db
      .insert(submissionEvents)
      .values({
        submissionId: f.sent.id,
        roundId: round!.id,
        action: 'APPROVED',
        actorUserId: f.reviewer.userId,
        actorName: 'Cán bộ',
        note: 'Không đưa vào inbox',
        fromRevision: 100 + i,
        toRevision: 101 + i,
      })
      .returning()
    await db.insert(personalNotifications).values({
      eventId: event!.id,
      submissionId: f.sent.id,
      recipientUserId: f.actor.userId,
      recipientKind: 'OWNER',
      createdAt: sql`'2026-10-10T12:00:00Z'::timestamptz + ${i} * interval '1 microsecond'`,
    })
  }
  const first = await f.notices.list(f.actor.userId, 'user')
  assert.equal(first.items.length, 20)
  assert.equal(first.unreadCount, 25)
  assert.ok(first.nextCursor)
  const second = await f.notices.list(f.actor.userId, 'user', { cursor: first.nextCursor })
  assert.equal(second.items.length, 5)
  assert.equal(second.nextCursor, null)
  assert.equal(new Set([...first.items, ...second.items].map((n) => n.id)).size, 25)
  for (const raw of [
    'bad',
    'x'.repeat(301),
    Buffer.from(JSON.stringify(['2026-02-30T00:00:00.000000Z', randomUUID()])).toString(
      'base64url',
    ),
  ])
    await assert.rejects(() => f.notices.list(f.actor.userId, 'user', { cursor: raw }))
  await db.update(users).set({ status: 'INACTIVE' }).where(eq(users.id, f.actor.userId))
  await assert.rejects(() => f.notices.unreadCount(f.actor.userId, 'user'))
})
test('SQL transfer guards reject combined content changes and notification/history envelopes remain immutable', async () => {
  const f = await handoverFixture()
  for (const change of [
    sql`values='{}'::jsonb`,
    sql`round_number=2`,
    sql`review_started_at=now()`,
    sql`designated_reviewer_id=NULL`,
    sql`submitted_at=now()`,
  ])
    await assert.rejects(() =>
      db.execute(
        sql`UPDATE submissions SET reviewer_user_id=${f.next.userId},revision=revision+1,${change} WHERE id=${f.sent.id}`,
      ),
    )
  const inbox = await f.notices.list(f.reviewer.userId, 'user'),
    id = inbox.items[0]!.id
  for (const op of [
    sql`UPDATE personal_notifications SET recipient_user_id=${f.next.userId} WHERE id=${id}`,
    sql`UPDATE personal_notifications SET event_id=${randomUUID()} WHERE id=${id}`,
    sql`DELETE FROM personal_notifications WHERE id=${id}`,
  ])
    await assert.rejects(() => db.execute(op))
  const marked = await f.notices.read(f.reviewer.userId, 'user', id)
  await assert.rejects(() =>
    db.execute(sql`UPDATE personal_notifications SET read_at=NULL WHERE id=${marked.id}`),
  )
  const transferred = await f.service.reassign(
    f.supervisor,
    f.sent.id,
    f.claimed.revision,
    f.next.userId,
    'Bàn giao',
  )
  await assert.rejects(() =>
    db.execute(
      sql`UPDATE submission_events SET note='Đổi' WHERE submission_id=${transferred.id} AND action='REASSIGNED'`,
    ),
  )
})
for (const portal of ['user', 'admin'] as const)
  test(
    'HTTP reassignment and inbox enforce portal, Origin and current recipient for ' + portal,
    async (t) => {
      const f = await handoverFixture()
      if (portal === 'user') await portalRole(f.supervisor.userId)
      const app = buildApp({ submissionService: f.service })
      t.after(() => app.close())
      await app.ready()
      const cookie = reviewCookie(app, f.supervisor, portal),
        base = '/api/v1/' + portal
      const body = {
        expectedRevision: f.claimed.revision,
        reviewerUserId: f.next.userId,
        note: 'Bàn giao HTTP',
      }
      assert.equal(
        (
          await app.inject({
            method: 'POST',
            url: base + '/review-submissions/' + f.sent.id + '/reassign',
            headers: { cookie },
            payload: body,
          })
        ).statusCode,
        403,
      )
      assert.equal(
        (
          await app.inject({
            method: 'GET',
            url: base + '/notifications',
            headers: {
              cookie: reviewCookie(app, f.supervisor, portal === 'user' ? 'admin' : 'user'),
            },
          })
        ).statusCode,
        401,
      )
      const response = await app.inject({
        method: 'POST',
        url: base + '/review-submissions/' + f.sent.id + '/reassign',
        headers: { cookie, origin: env.corsOrigin },
        payload: body,
      })
      assert.equal(response.statusCode, 200, response.body)
      assert.equal(
        response.json<ReviewDetail>().events.at(-1)!.reassignment!.toReviewerName,
        'Cán bộ kiểm thử',
      )
      const bad = await app.inject({
        method: 'POST',
        url: base + '/review-submissions/' + f.sent.id + '/reassign',
        headers: { cookie, origin: env.corsOrigin },
        payload: { ...body, note: null },
      })
      assert.equal(bad.statusCode, 422)
      await portalRole(f.next.userId, 'ADMIN')
      const recipientCookie = reviewCookie(app, f.next, portal)
      const list = await app.inject({
        method: 'GET',
        url: base + '/notifications',
        headers: { cookie: recipientCookie },
      })
      assert.equal(list.statusCode, 200, list.body)
      assert.equal(
        list.json<Awaited<ReturnType<DrizzleNotificationRepository['list']>>>().items.length,
        1,
      )
      const item = list.json<Awaited<ReturnType<DrizzleNotificationRepository['list']>>>().items[0]!
      assert.equal(
        item.targetUrl,
        (portal === 'admin' ? '/admin' : '') + '/review-submissions/' + f.sent.id,
      )
      const read = await app.inject({
        method: 'POST',
        url: base + '/notifications/' + item.id + '/read',
        headers: { cookie: recipientCookie, origin: env.corsOrigin },
        payload: {},
      })
      assert.equal(read.statusCode, 200, read.body)
      assert.equal(read.json<{ unreadCount: number }>().unreadCount, 0)
      assert.equal(
        (
          await app.inject({
            method: 'POST',
            url: base + '/notifications/' + item.id + '/read',
            headers: { cookie: recipientCookie },
            payload: {},
          })
        ).statusCode,
        403,
      )
    },
  )

async function queueFixture(count = 67) {
  const f = await fixture()
  const reviewer = await addReviewer(f.unitId)
  const ready = await complete(f)
  const sent = await f.service.submit(f.actor, ready.id, ready.revision)
  const [template] = await db.select().from(submissions).where(eq(submissions.id, sent.id))
  const people = Array.from({ length: count }, () => randomUUID())
  await db.insert(users).values(
    people.map((id) => ({
      id,
      username: 's5t-' + id,
      fullName: 'Sinh viên hàng đợi',
      mustChangePassword: false,
    })),
  )
  await db.insert(submissions).values(
    people.map((studentUserId, index) => ({
      ...template!,
      id: randomUUID(),
      studentUserId,
      submittedAt: sql`'2024-01-01T00:00:00.000000Z'::timestamptz + ${Math.floor(index / 3)} * interval '1 microsecond'`,
      studentSnapshot: {
        ...template!.studentSnapshot!,
        fullName: 'Nguyễn An ' + index,
        studentCode: 'Q' + String(index).padStart(3, '0'),
      },
      serviceName: index === 65 ? 'Giấy 50%_\\test' : template!.serviceName,
    })),
  )
  return { ...f, reviewer, sent, template: template! }
}
test('queue seeks more than50 rows with tied microsecond timestamps and never skips or repeats', async () => {
  const f = await queueFixture()
  const expected = await db
    .select({ id: submissions.id })
    .from(submissions)
    .orderBy(submissions.submittedAt, submissions.id)
  const seen: string[] = []
  let cursor: string | undefined
  do {
    const page = await f.service.reviewList(f.reviewer.userId, {
      status: 'SUBMITTED',
      ...(cursor ? { cursor } : {}),
    })
    assert.ok(page.items.length <= 20)
    seen.push(...page.items.map((row) => row.id))
    if (page.nextCursor)
      assert.match(
        (JSON.parse(Buffer.from(page.nextCursor, 'base64url').toString('utf8')) as string[])[0]!,
        /\.\d{6}Z$/,
      )
    cursor = page.nextCursor ?? undefined
  } while (cursor)
  assert.deepEqual(
    seen,
    expected.map((row) => row.id),
  )
  assert.equal(new Set(seen).size, 68)
  const first = await f.service.reviewList(f.reviewer.userId, { status: 'SUBMITTED' })
  assert.ok(first.nextCursor)
  await assert.rejects(
    () =>
      f.service.reviewList(f.reviewer.userId, {
        status: 'SUBMITTED',
        q: 'An',
        cursor: first.nextCursor!,
      }),
    errorCode(400, 'INVALID_CURSOR'),
  )
  const other = await addReviewer(f.unitId)
  await assert.rejects(
    () => f.service.reviewList(other.userId, { status: 'SUBMITTED', cursor: first.nextCursor! }),
    errorCode(400, 'INVALID_CURSOR'),
  )
  await db.delete(userRoleScopes).where(eq(userRoleScopes.userId, f.reviewer.userId))
  await assert.rejects(
    () =>
      f.service.reviewList(f.reviewer.userId, { status: 'SUBMITTED', cursor: first.nextCursor! }),
    errorCode(403),
  )
})
test('queue search and assignment filter before limit, literal wildcards cannot expose answers or foreign scope', async () => {
  const f = await queueFixture()
  const target = await f.service.reviewList(f.reviewer.userId, { q: 'q065' })
  assert.equal(target.items.length, 1)
  assert.equal(target.items[0]!.student.studentCode, 'Q065')
  for (const q of ['50%_\\test', '%', '\\'])
    assert.equal((await f.service.reviewList(f.reviewer.userId, { q })).items.length, 1)
  for (const q of ["' OR 1=1 --", 'Nội dung riêng tư', 'Không tồn tại'])
    assert.deepEqual((await f.service.reviewList(f.reviewer.userId, { q })).items, [])
  assert.equal(
    (await f.service.reviewList(f.reviewer.userId, { q: 'nguyễn an 66' })).items.length,
    1,
  )
  assert.equal(
    (await f.service.reviewList(f.reviewer.userId, { assignment: 'MINE' })).items.length,
    0,
  )
  await f.service.claim(f.reviewer, f.sent.id, f.sent.revision)
  const mine = await f.service.reviewList(f.reviewer.userId, { assignment: 'MINE' })
  assert.deepEqual(
    mine.items.map((row) => row.id),
    [f.sent.id],
  )
  assert.equal(mine.nextCursor, null)
  assert.equal(
    (
      await f.service.reviewList(f.reviewer.userId, {
        status: 'SUBMITTED',
        assignment: 'UNASSIGNED',
      })
    ).items.length,
    20,
  )
  const outsiderUnit = randomUUID()
  await db
    .insert(organizationalUnits)
    .values({ id: outsiderUnit, code: 'S5T_' + randomUUID(), name: 'Khác' })
  const outsider = await addReviewer(outsiderUnit)
  assert.deepEqual((await f.service.reviewList(outsider.userId, { q: 'Q065' })).items, [])
  assert.deepEqual(
    Object.keys(target.items[0]!).sort(),
    [
      'id',
      'serviceName',
      'status',
      'revision',
      'submittedAt',
      'roundNumber',
      'lastSubmittedAt',
      'decisionAt',
      'processingUnitName',
      'student',
      'reviewerName',
      'canClaim',
    ].sort(),
  )
})
for (const portal of ['user', 'admin'] as const)
  test('HTTP paginated queue validates filters and cookies on ' + portal, async (t) => {
    const f = await queueFixture(23)
    await portalRole(f.reviewer.userId, portal === 'admin' ? 'ADMIN' : 'FACULTY_REVIEWER')
    const app = buildApp({ submissionService: f.service })
    t.after(() => app.close())
    await app.ready()
    const base = '/api/v1/' + portal + '/review-submissions',
      cookie = reviewCookie(app, f.reviewer, portal)
    const first = await app.inject({
      method: 'GET',
      url: base + '?status=SUBMITTED',
      headers: { cookie },
    })
    assert.equal(first.statusCode, 200, first.body)
    const page = first.json<ReviewQueuePage>()
    assert.equal(page.items.length, 20)
    assert.ok(page.nextCursor)
    const second = await app.inject({
      method: 'GET',
      url: base + '?status=SUBMITTED&cursor=' + page.nextCursor,
      headers: { cookie },
    })
    assert.equal(second.statusCode, 200, second.body)
    assert.equal(second.json<ReviewQueuePage>().items.length, 4)
    for (const query of [
      'status=DRAFT',
      'assignment=OTHER',
      'cursor=invalid',
      'q=' + 'a'.repeat(101),
      'limit=100',
      'offset=20',
      'status=SUBMITTED&status=IN_REVIEW',
    ]) {
      const response = await app.inject({
        method: 'GET',
        url: base + '?' + query,
        headers: { cookie },
      })
      assert.equal(response.statusCode, 400, query + ' ' + response.body)
    }
    assert.equal(
      (
        await app.inject({
          method: 'GET',
          url: base,
          headers: { cookie: reviewCookie(app, f.reviewer, portal === 'user' ? 'admin' : 'user') },
        })
      ).statusCode,
      401,
    )
  })

test('indexed queue search preserves short terms, Vietnamese accents and complete seek pages', async () => {
  const f = await queueFixture()
  for (const q of ['Q', 'Q0']) {
    const ids = new Set<string>()
    let cursor: string | undefined
    do {
      const page = await f.service.reviewList(f.reviewer.userId, {
        q,
        ...(cursor ? { cursor } : {}),
      })
      for (const row of page.items) {
        assert.match(row.student.studentCode, /^Q[0-9]{3}$/)
        assert.ok(!ids.has(row.id))
        ids.add(row.id)
      }
      cursor = page.nextCursor ?? undefined
    } while (cursor)
    assert.equal(ids.size, 67)
  }
  assert.equal(
    (await f.service.reviewList(f.reviewer.userId, { q: 'Nguyễn An 66' })).items.length,
    1,
  )
  assert.equal(
    (await f.service.reviewList(f.reviewer.userId, { q: 'Nguyen An 66' })).items.length,
    0,
  )
  assert.equal((await f.service.reviewList(f.reviewer.userId, { q: 'An 6' })).items.length, 8)
})

test('HTTP document downloads require current owner/scope and return private Word/PDF attachments', async (t) => {
  const f = await fixture()
  const reviewer = await addReviewer(f.unitId)
  const foreignUnit = randomUUID()
  await db
    .insert(organizationalUnits)
    .values({ id: foreignUnit, code: 'S5T_' + randomUUID(), name: 'Đơn vị ngoài' })
  const foreign = await addReviewer(foreignUnit)
  let conversions = 0
  const renderer = new LocalSubmissionDocumentRenderer({
    convert: () => {
      conversions++
      return Promise.resolve(Buffer.from('%PDF-1.7\n' + '.'.repeat(120) + '\n%%EOF'))
    },
  })
  const app = buildApp({
    submissionService: new SubmissionService(f.repository, f.storage, renderer),
  })
  await app.ready()
  t.after(() => app.close())
  const owner = reviewCookie(app, f.actor, 'user', ['STUDENT'])
  const other = reviewCookie(app, { ...f.actor, userId: f.otherId }, 'user', ['STUDENT'])
  const ready = await complete(f)
  const path = '/api/v1/user/submissions/' + ready.id + '/rounds/1/documents/'
  assert.equal(
    (await app.inject({ url: path + 'docx', headers: { cookie: owner } })).statusCode,
    404,
  )
  const sent = await f.service.submit(f.actor, ready.id, ready.revision)
  assert.equal((await app.inject({ url: path + 'docx' })).statusCode, 401)
  assert.equal(
    (await app.inject({ url: path + 'docx', headers: { cookie: other } })).statusCode,
    404,
  )
  assert.equal(
    (await app.inject({ url: path + 'exe', headers: { cookie: owner } })).statusCode,
    400,
  )
  assert.equal(
    (
      await app.inject({
        url: path.replace('/rounds/1/', '/rounds/0/') + 'docx',
        headers: { cookie: owner },
      })
    ).statusCode,
    400,
  )
  const word = await app.inject({ url: path + 'docx', headers: { cookie: owner } })
  assert.equal(word.statusCode, 200, word.body)
  assert.equal(
    word.headers['content-type'],
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  )
  assert.equal(word.headers['cache-control'], 'private, no-store')
  assert.equal(word.headers['x-content-type-options'], 'nosniff')
  assert.ok(String(word.headers['content-disposition']).includes('-lan-1.docx'))
  const content = strFromU8(unzipSync(word.rawPayload)['word/document.xml']!)
  assert.ok(content.includes('Nội dung riêng tư'))
  assert.ok(content.includes('Không'))
  assert.equal(conversions, 0)
  const pdfResponse = await app.inject({ url: path + 'pdf', headers: { cookie: owner } })
  assert.equal(pdfResponse.statusCode, 200)
  assert.equal(pdfResponse.headers['content-type'], 'application/pdf')
  assert.equal(conversions, 1)
  for (const portal of ['user', 'admin'] as const) {
    const reviewPath =
      '/api/v1/' + portal + '/review-submissions/' + sent.id + '/rounds/1/documents/docx'
    assert.equal(
      (
        await app.inject({
          url: reviewPath,
          headers: { cookie: reviewCookie(app, foreign, portal) },
        })
      ).statusCode,
      404,
    )
    assert.equal(
      (
        await app.inject({
          url: reviewPath,
          headers: { cookie: reviewCookie(app, reviewer, portal) },
        })
      ).statusCode,
      200,
    )
    assert.equal(
      (await app.inject({ url: reviewPath, headers: { cookie: owner } })).statusCode,
      portal === 'admin' ? 401 : 403,
    )
  }
  await db.update(users).set({ status: 'INACTIVE' }).where(eq(users.id, reviewer.userId))
  assert.equal(
    (
      await app.inject({
        url: '/api/v1/user/review-submissions/' + sent.id + '/rounds/1/documents/docx',
        headers: { cookie: reviewCookie(app, reviewer, 'user') },
      })
    ).statusCode,
    403,
  )
})

test('Word for an old round remains identical after supplementation and profile changes', async () => {
  const f = await resolutionFixture()
  const first = await f.service.documentDownload(f.actor.userId, f.sent.id, 1, 'docx')
  const requested = await f.service.resolve(
    f.reviewer,
    f.sent.id,
    f.claimed.revision,
    'REQUEST_SUPPLEMENT',
    'Bổ sung',
  )
  await db
    .update(users)
    .set({ fullName: 'Tên mới sau lần gửi đầu' })
    .where(eq(users.id, f.actor.userId))
  const working = await f.service.save(f.actor, f.sent.id, requested.revision, {
    purpose: 'Nội dung bổ sung mới',
    amount: 15,
    agreed: true,
  })
  const during = await f.service.documentDownload(f.actor.userId, f.sent.id, 1, 'docx')
  assert.deepEqual(during.bytes, first.bytes)
  const second = await f.service.submit(f.actor, f.sent.id, working.revision)
  assert.equal(second.roundNumber, 2)
  const old = await f.service.documentDownload(f.reviewer.userId, f.sent.id, 1, 'docx', true)
  assert.deepEqual(old.bytes, first.bytes)
  const latest = await f.service.documentDownload(f.actor.userId, f.sent.id, 2, 'docx')
  const content = strFromU8(unzipSync(latest.bytes)['word/document.xml']!)
  assert.ok(content.includes('Tên mới sau lần gửi đầu'))
  assert.ok(content.includes('Nội dung bổ sung mới'))
  assert.ok(
    !strFromU8(unzipSync(old.bytes)['word/document.xml']!).includes('Tên mới sau lần gửi đầu'),
  )
})

test('HTTP round bundles preserve private evidence and enforce owner, portal and current reviewer scope', async (t) => {
  const f = await resolutionFixture()
  const foreignUnit = randomUUID()
  await db
    .insert(organizationalUnits)
    .values({ id: foreignUnit, code: 'S5T_' + randomUUID(), name: 'Ngoài phạm vi' })
  const foreign = await addReviewer(foreignUnit)
  const renderer = new LocalSubmissionDocumentRenderer({
    convert: async () => Buffer.from('%PDF-1.7\n' + '.'.repeat(120) + '\n%%EOF'),
  })
  const app = buildApp({
    submissionService: new SubmissionService(f.repository, f.storage, renderer),
  })
  await app.ready()
  t.after(() => app.close())
  const owner = reviewCookie(app, f.actor, 'user', ['STUDENT']),
    other = reviewCookie(app, { ...f.actor, userId: f.otherId }, 'user', ['STUDENT'])
  const path = '/api/v1/user/submissions/' + f.sent.id + '/rounds/1/bundle'
  assert.equal((await app.inject({ url: path })).statusCode, 401)
  assert.equal((await app.inject({ url: path, headers: { cookie: other } })).statusCode, 404)
  assert.equal(
    (
      await app.inject({
        url: path.replace('/rounds/1/', '/rounds/0/'),
        headers: { cookie: owner },
      })
    ).statusCode,
    400,
  )
  assert.equal(
    (
      await app.inject({
        url: path.replace('/rounds/1/', '/rounds/99/'),
        headers: { cookie: owner },
      })
    ).statusCode,
    404,
  )
  const response = await app.inject({ url: path, headers: { cookie: owner } })
  assert.equal(response.statusCode, 200, response.body)
  assert.equal(response.headers['content-type'], 'application/zip')
  assert.equal(response.headers['cache-control'], 'private, no-store')
  assert.equal(response.headers['x-content-type-options'], 'nosniff')
  assert.ok(String(response.headers['content-disposition']).includes('-lan-1.zip'))
  const parts = unzipSync(response.rawPayload)
  const manifest = JSON.parse(strFromU8(parts['manifest.json']!)) as SubmissionBundleManifest
  const info = manifest.files.find((item) => item.kind === 'EVIDENCE')
  assert.ok(info?.fileId)
  const original = await f.service.roundDownload(f.actor.userId, f.sent.id, 1, info.fileId)
  assert.deepEqual(Buffer.from(parts[info.path]!), original.bytes)
  for (const item of manifest.files)
    assert.equal(createHash('sha256').update(parts[item.path]!).digest('hex'), item.sha256)
  for (const portal of ['user', 'admin'] as const) {
    const reviewPath = '/api/v1/' + portal + '/review-submissions/' + f.sent.id + '/rounds/1/bundle'
    assert.equal(
      (
        await app.inject({
          url: reviewPath,
          headers: { cookie: reviewCookie(app, foreign, portal) },
        })
      ).statusCode,
      404,
    )
    assert.equal(
      (
        await app.inject({
          url: reviewPath,
          headers: { cookie: reviewCookie(app, f.reviewer, portal) },
        })
      ).statusCode,
      200,
    )
    assert.equal(
      (await app.inject({ url: reviewPath, headers: { cookie: owner } })).statusCode,
      portal === 'admin' ? 401 : 403,
    )
  }
  const stored = await f.repository.roundFile(f.actor.userId, f.sent.id, 1, info.fileId)
  const oldBytes = await f.storage.read(stored.key)
  f.storage.files.set(stored.key, Buffer.alloc(oldBytes.length, 65))
  const corrupted = await app.inject({ url: path, headers: { cookie: owner } })
  assert.equal(corrupted.statusCode, 503)
  assert.equal(corrupted.json<{ code: string }>().code, 'FILE_INTEGRITY')
  f.storage.files.set(stored.key, oldBytes)
  await db.update(users).set({ status: 'INACTIVE' }).where(eq(users.id, f.reviewer.userId))
  assert.equal(
    (
      await app.inject({
        url: '/api/v1/admin/review-submissions/' + f.sent.id + '/rounds/1/bundle',
        headers: { cookie: reviewCookie(app, f.reviewer, 'admin') },
      })
    ).statusCode,
    403,
  )
})

test('20 MiB bundle keeps four maximum-size PDFs intact, rejects overflow and refuses later corruption', async (t) => {
  const f = await fixture()
  await addReviewer(f.unitId)
  const fileBytes = 5 * 1024 * 1024
  const original = await readFile(
    new URL('../../../scripts/fixtures/recovery/evidence-round-1.pdf', import.meta.url),
  )
  const marker = original.lastIndexOf(Buffer.from('startxref'))
  assert.ok(marker > 0)
  // PDF comments may separate the trailer and startxref. Existing object/xref offsets stay unchanged.
  const evidence = Buffer.concat([
    original.subarray(0, marker),
    Buffer.from('%' + 'X'.repeat(fileBytes - original.length - 2) + '\n'),
    original.subarray(marker),
  ])
  assert.equal(evidence.length, fileBytes)
  const config: ProcedureConfig = {
    ...structuredClone(f.version.config),
    attachments: f.version.config.attachments.map((item) => ({
      ...item,
      maxFiles: 3,
      maxBytes: fileBytes,
    })),
    maxTotalAttachmentBytes: 4 * fileBytes,
  }
  await db
    .update(procedureVersions)
    .set({ status: 'RETIRED' })
    .where(eq(procedureVersions.id, f.version.id))
  const [version] = await db
    .insert(procedureVersions)
    .values({
      serviceId: f.serviceId,
      ownerUnitId: f.unitId,
      versionNumber: 2,
      status: 'PUBLISHED',
      publishedAt: new Date(),
      config,
      createdBy: f.actor.userId,
      updatedBy: f.actor.userId,
    })
    .returning()
  const draft = await f.service.create(f.actor, f.serviceId, version!.id)
  let ready = await f.service.save(f.actor, draft.id, draft.revision, {
    purpose: 'Đo dung lượng bằng dữ liệu giả',
    amount: 0,
    agreed: false,
    date: '2026-10-11',
  })
  const realConverter = process.env.CAPACITY_REAL_CONVERTER === 'true'
  if (realConverter)
    assert.ok(
      process.env.LIBREOFFICE_PATH,
      'Real-converter profile requires an explicit LibreOffice path',
    )
  let conversions = 0
  const converter = realConverter
    ? new LibreOfficePdfConverter()
    : { convert: async () => Buffer.from('%PDF-1.7\n' + '.'.repeat(120) + '\n%%EOF') }
  const renderer = new LocalSubmissionDocumentRenderer({
    convert: (word) => {
      conversions++
      return converter.convert(word)
    },
  })
  const app = buildApp({
    submissionService: new SubmissionService(f.repository, f.storage, renderer),
  })
  await app.ready()
  t.after(() => app.close())
  const cookie = reviewCookie(app, f.actor, 'user', ['STUDENT'])
  const tooLarge = multipart(Buffer.concat([evidence, Buffer.from('X')]), 'too-large.pdf')
  const rejectedSize = await app.inject({
    method: 'POST',
    url: '/api/v1/user/submissions/' + draft.id + '/attachments/proof?revision=' + ready.revision,
    headers: { ...tooLarge.headers, cookie, origin: env.corsOrigin },
    payload: tooLarge.payload,
  })
  assert.equal(rejectedSize.statusCode, 413)
  assert.equal(f.storage.files.size, 0)
  for (let index = 0; index < 4; index++) {
    const body = multipart(evidence, 'capacity-fake-' + index + '.pdf')
    const uploaded = await app.inject({
      method: 'POST',
      url:
        '/api/v1/user/submissions/' +
        draft.id +
        '/attachments/' +
        (index < 3 ? 'proof' : 'extraProof') +
        '?revision=' +
        ready.revision,
      headers: { ...body.headers, cookie, origin: env.corsOrigin },
      payload: body.payload,
    })
    assert.equal(uploaded.statusCode, 200, uploaded.body)
    ready = uploaded.json<DraftView>()
  }
  assert.equal(
    ready.files.reduce((sum, file) => sum + file.size, 0),
    20 * 1024 * 1024,
  )
  const extra = multipart(original, 'overflow.pdf')
  const overflow = await app.inject({
    method: 'POST',
    url:
      '/api/v1/user/submissions/' + draft.id + '/attachments/extraProof?revision=' + ready.revision,
    headers: { ...extra.headers, cookie, origin: env.corsOrigin },
    payload: extra.payload,
  })
  assert.equal(overflow.statusCode, 422)
  assert.equal(overflow.json<{ code: string }>().code, 'ATTACHMENT_LIMIT')
  assert.equal(f.storage.files.size, 4)
  assert.equal((await f.service.get(f.actor.userId, draft.id)).revision, ready.revision)
  const submitted = await app.inject({
    method: 'POST',
    url: '/api/v1/user/submissions/' + draft.id + '/submit',
    headers: { cookie, origin: env.corsOrigin },
    payload: { expectedRevision: ready.revision },
  })
  assert.equal(submitted.statusCode, 200, submitted.body)
  const sent = submitted.json<DraftView>()
  const url = '/api/v1/user/submissions/' + sent.id + '/rounds/1/bundle'
  const started = performance.now()
  const response = await app.inject({ url, headers: { cookie } })
  const responseElapsedMs = Math.round(performance.now() - started)
  assert.equal(response.statusCode, 200)
  assert.ok(response.rawPayload.length > 20 * 1024 * 1024)
  assert.ok(response.rawPayload.length < 40 * 1024 * 1024)
  const parts = unzipSync(response.rawPayload),
    manifest = JSON.parse(strFromU8(parts['manifest.json']!)) as SubmissionBundleManifest
  assert.deepEqual(manifest.template, sent.rounds[0]!.declarationTemplate)
  const proofs = manifest.files.filter((item) => item.kind === 'EVIDENCE')
  assert.equal(proofs.length, 4)
  for (const item of proofs) {
    assert.equal(item.size, fileBytes)
    assert.deepEqual(Buffer.from(parts[item.path]!), evidence)
    assert.equal(createHash('sha256').update(parts[item.path]!).digest('hex'), item.sha256)
  }
  assert.equal(conversions, 1)
  const word = strFromU8(unzipSync(parts['phieu-ho-so.docx']!)['word/document.xml']!)
  assert.match(word, />0<\/w:t>/)
  assert.ok(word.includes('Không'))
  t.diagnostic(
    JSON.stringify({
      fakeDataOnly: true,
      evidenceBytes: 4 * fileBytes,
      archiveBytes: response.rawPayload.length,
      elapsedMs: responseElapsedMs,
      pdfConverter: realConverter ? 'REAL' : 'MOCK',
    }),
  )
  if (realConverter) {
    await mkdir(new URL('../../../../../run/', import.meta.url), { recursive: true })
    await writeFile(
      new URL('../../../../../run/capacity-full-20m.zip', import.meta.url),
      response.rawPayload,
    )
  }
  const stored = await f.repository.roundFile(f.actor.userId, draft.id, 1, proofs.at(-1)!.fileId!)
  const altered = f.storage.files.get(stored.key)!
  altered[altered.length - 1] = altered.at(-1)! ^ 1
  const corrupted = await app.inject({ url, headers: { cookie } })
  assert.equal(corrupted.statusCode, 503)
  assert.equal(corrupted.json<{ code: string }>().code, 'FILE_INTEGRITY')
  assert.equal(conversions, 1)
})
