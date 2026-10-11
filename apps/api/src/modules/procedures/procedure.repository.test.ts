import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, afterEach, beforeEach, test } from 'node:test'
import { eq, like, sql } from 'drizzle-orm'
import { databaseClient, db } from '../../db/client.js'
import { env } from '../../config/env.js'
import { services } from '../../db/schema.js'
import { users, userRoles, roles } from '../auth/auth.schema.js'
import {
  permissions,
  rolePermissions,
  authorizationScopes,
  userRoleScopes,
} from '../auth/authorization.schema.js'
import { organizationalUnits } from '../organizations/organization.schema.js'
import { auditLogs } from '../audit/audit.schema.js'
import { DrizzleProcedureRepository } from './procedure.repository.js'
import { procedureVersions } from './procedure.schema.js'
import type { ProcedureActor } from './procedure.contract.js'
import { ProcedureError } from './procedure.errors.js'
import { buildApp } from '../../app.js'
import { ProcedureService } from './procedure.service.js'
import {
  ADMIN_JWT_AUDIENCE,
  ADMIN_SESSION_COOKIE_NAME,
  JWT_ISSUER,
} from '../auth/auth.constants.js'

const testUrl = new URL(process.env.DATABASE_URL ?? 'http://invalid')
if (
  testUrl.pathname !== '/student_service_test' ||
  !['localhost', '127.0.0.1'].includes(testUrl.hostname) ||
  testUrl.port !== '5434'
)
  throw new Error('Tests require local student_service_test on port 5434')

async function cleanup() {
  await db.execute(
    sql.raw(
      'TRUNCATE submission_document_jobs, submission_documents, submission_document_sets, personal_notifications, submission_events, submission_rounds, submission_files, submissions, procedure_versions',
    ),
  )
  // Dedicated test database only; production audit rows are append-only.
  await db.execute(sql.raw('TRUNCATE audit_logs'))
  await db.delete(users).where(like(users.username, 'p4t-%'))
  await db.delete(roles).where(like(roles.code, 'P4T_%'))
  await db.delete(services).where(like(services.code, 'P4T_%'))
  await db.delete(organizationalUnits).where(like(organizationalUnits.code, 'P4T_%'))
}
beforeEach(cleanup)
afterEach(cleanup)
after(async () => {
  await databaseClient.end()
})
async function fixture(scope: 'GLOBAL' | 'ORGANIZATION' | 'NONE' = 'GLOBAL', grant = true) {
  const suffix = randomUUID()
  const ownerUnitId = randomUUID(),
    otherUnitId = randomUUID(),
    userId = randomUUID()
  await db.insert(organizationalUnits).values([
    { id: ownerUnitId, code: 'P4T_' + suffix, name: 'Phòng CTSV test' },
    { id: otherUnitId, code: 'P4T_' + randomUUID(), name: 'Phòng khác' },
  ])
  const service = (
    await db
      .insert(services)
      .values({
        code: 'P4T_' + suffix,
        name: 'Giấy xác nhận',
        description: 'Demo',
        processingDays: 3,
      })
      .returning()
  )[0]!
  await db.insert(users).values({
    id: userId,
    username: 'p4t-' + suffix,
    fullName: 'Admin test',
    status: 'ACTIVE',
    mustChangePassword: false,
  })
  const role = (
    await db
      .insert(roles)
      .values({ code: 'P4T_' + suffix, name: 'Role test' })
      .returning()
  )[0]!
  await db.insert(userRoles).values({ userId, roleId: role.id })
  await db
    .insert(permissions)
    .values({ code: 'service.configure', name: 'Cấu hình dịch vụ' })
    .onConflictDoNothing()
  const permission = (
    await db.select().from(permissions).where(eq(permissions.code, 'service.configure'))
  )[0]!
  if (grant)
    await db.insert(rolePermissions).values({ roleId: role.id, permissionId: permission.id })
  if (scope !== 'NONE') {
    let scopeId: string
    if (scope === 'GLOBAL') {
      await db.insert(authorizationScopes).values({ scopeType: 'GLOBAL' }).onConflictDoNothing()
      scopeId = (
        await db
          .select()
          .from(authorizationScopes)
          .where(eq(authorizationScopes.scopeType, 'GLOBAL'))
      )[0]!.id
    } else
      scopeId = (
        await db
          .insert(authorizationScopes)
          .values({ scopeType: 'ORGANIZATION', organizationalUnitId: ownerUnitId })
          .returning()
      )[0]!.id
    await db.insert(userRoleScopes).values({ userId, roleId: role.id, scopeId })
  }
  const actor: ProcedureActor = {
    userId,
    username: 'p4t-' + suffix,
    requestId: 'req-p4',
    ipAddress: null,
    userAgent: null,
  }
  const repository = new DrizzleProcedureRepository()
  const create = () =>
    repository.create(actor, { serviceId: service.id, ownerUnitId, cloneVersionId: null })
  return {
    actor,
    repository,
    create,
    serviceId: service.id,
    ownerUnitId,
    otherUnitId,
    roleId: role.id,
  }
}
test('OFFLINE publishes without online reviewer and public response excludes staff identity', async () => {
  const f = await fixture()
  const draft = await f.create()
  const published = await f.repository.publish(f.actor, draft.id, draft.revision)
  assert.equal(published.status, 'PUBLISHED')
  const view = await f.repository.published(f.serviceId)
  assert.equal(view?.processingMode, 'OFFLINE')
  assert.equal(view?.processingUnitName, 'Phòng CTSV test')
  assert.ok(view && !('processorUserId' in view) && !('createdBy' in view))
})
test('two concurrent creates leave exactly one draft', async () => {
  const f = await fixture()
  const results = await Promise.allSettled([f.create(), f.create()])
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
  assert.equal((await f.repository.list(f.actor.userId, f.serviceId)).length, 1)
})
test('two updates using one revision produce one success and one conflict', async () => {
  const f = await fixture(),
    draft = await f.create()
  const config = { ...draft.config, contactInstructions: 'Đến Phòng CTSV' }
  const results = await Promise.allSettled([
    f.repository.update(f.actor, draft.id, { expectedRevision: 1, config }),
    f.repository.update(f.actor, draft.id, { expectedRevision: 1, config }),
  ])
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
  const failed = results.find((r) => r.status === 'rejected')
  assert.ok(
    failed?.status === 'rejected' &&
      failed.reason instanceof ProcedureError &&
      failed.reason.statusCode === 409,
  )
})
test('two publishes commit once and create one publish audit', async () => {
  const f = await fixture(),
    draft = await f.create()
  const results = await Promise.allSettled([
    f.repository.publish(f.actor, draft.id, 1),
    f.repository.publish(f.actor, draft.id, 1),
  ])
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
  const events = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.action, 'PROCEDURE_VERSION_PUBLISH'))
  assert.equal(events.length, 1)
})
test('published versions cannot be changed or deleted even through direct SQL', async () => {
  const f = await fixture(),
    draft = await f.create()
  await f.repository.publish(f.actor, draft.id, 1)
  await assert.rejects(() =>
    f.repository.update(f.actor, draft.id, { expectedRevision: 2, config: draft.config }),
  )
  await assert.rejects(() =>
    db
      .update(procedureVersions)
      .set({ config: { ...draft.config, contactInstructions: 'Tampered' } })
      .where(eq(procedureVersions.id, draft.id)),
  )
  await assert.rejects(() => db.delete(procedureVersions).where(eq(procedureVersions.id, draft.id)))
  assert.equal(
    (await f.repository.published(f.serviceId))?.contactInstructions,
    draft.config.contactInstructions,
  )
})
test('clone and publish preserve old content and retire the previous version', async () => {
  const f = await fixture(),
    first = await f.create()
  await f.repository.publish(f.actor, first.id, 1)
  const cloned = await f.repository.create(f.actor, {
    serviceId: f.serviceId,
    ownerUnitId: f.ownerUnitId,
    cloneVersionId: first.id,
  })
  const updated = await f.repository.update(f.actor, cloned.id, {
    expectedRevision: 1,
    config: { ...cloned.config, contactInstructions: 'Hướng dẫn mới' },
  })
  await f.repository.publish(f.actor, updated.id, updated.revision)
  const versions = await f.repository.list(f.actor.userId, f.serviceId)
  assert.equal(versions.find((v) => v.id === first.id)?.status, 'RETIRED')
  assert.equal(
    versions.find((v) => v.id === first.id)?.config.contactInstructions,
    first.config.contactInstructions,
  )
  assert.equal((await f.repository.published(f.serviceId))?.contactInstructions, 'Hướng dẫn mới')
})
test('audit failure rolls back publish and retirement together', async () => {
  const f = await fixture(),
    first = await f.create()
  await f.repository.publish(f.actor, first.id, 1)
  const cloned = await f.repository.create(f.actor, {
    serviceId: f.serviceId,
    ownerUnitId: f.ownerUnitId,
    cloneVersionId: first.id,
  })
  await db.execute(
    sql.raw(
      "ALTER TABLE audit_logs ADD CONSTRAINT p4t_block_publish CHECK (action <> 'PROCEDURE_VERSION_PUBLISH') NOT VALID",
    ),
  )
  try {
    await assert.rejects(() => f.repository.publish(f.actor, cloned.id, 1))
    const versions = await f.repository.list(f.actor.userId, f.serviceId)
    assert.equal(versions.find((v) => v.id === first.id)?.status, 'PUBLISHED')
    assert.equal(versions.find((v) => v.id === cloned.id)?.status, 'DRAFT')
  } finally {
    await db.execute(sql.raw('ALTER TABLE audit_logs DROP CONSTRAINT p4t_block_publish'))
  }
})
test('ONLINE cannot publish without a scoped active reviewer', async () => {
  const f = await fixture(),
    draft = await f.create()
  const updated = await f.repository.update(f.actor, draft.id, {
    expectedRevision: 1,
    config: { ...draft.config, processingMode: 'ONLINE' },
  })
  await assert.rejects(
    () => f.repository.publish(f.actor, draft.id, updated.revision),
    (e: unknown) => e instanceof ProcedureError && e.statusCode === 422,
  )
})
test('permission and scope on different role assignments are not combined', async () => {
  const f = await fixture('NONE')
  const otherRole = (
    await db
      .insert(roles)
      .values({ code: 'P4T_' + randomUUID(), name: 'Scope only' })
      .returning()
  )[0]!
  await db.insert(userRoles).values({ userId: f.actor.userId, roleId: otherRole.id })
  await db.insert(authorizationScopes).values({ scopeType: 'GLOBAL' }).onConflictDoNothing()
  const scope = (
    await db.select().from(authorizationScopes).where(eq(authorizationScopes.scopeType, 'GLOBAL'))
  )[0]!
  await db
    .insert(userRoleScopes)
    .values({ userId: f.actor.userId, roleId: otherRole.id, scopeId: scope.id })
  await assert.rejects(
    () => f.repository.catalog(f.actor.userId),
    (e: unknown) => e instanceof ProcedureError && e.statusCode === 403,
  )
})
test('organization configurator cannot reroute the procedure to another unit', async () => {
  const f = await fixture(),
    draft = await f.create()
  await db.delete(userRoleScopes).where(eq(userRoleScopes.userId, f.actor.userId))
  const scope = (
    await db
      .insert(authorizationScopes)
      .values({ scopeType: 'ORGANIZATION', organizationalUnitId: f.ownerUnitId })
      .returning()
  )[0]!
  await db
    .insert(userRoleScopes)
    .values({ userId: f.actor.userId, roleId: f.roleId, scopeId: scope.id })
  await assert.rejects(
    () =>
      f.repository.update(f.actor, draft.id, {
        expectedRevision: 1,
        config: { ...draft.config, processingUnitId: f.otherUnitId },
      }),
    (e: unknown) => e instanceof ProcedureError && e.statusCode === 403,
  )
})
test('inactive actor is denied even with previously granted permission', async () => {
  const f = await fixture()
  await db.update(users).set({ status: 'INACTIVE' }).where(eq(users.id, f.actor.userId))
  await assert.rejects(
    () => f.repository.catalog(f.actor.userId),
    (e: unknown) => e instanceof ProcedureError && e.statusCode === 403,
  )
})
test('inactive processing unit is rejected and no public procedure is returned', async () => {
  const f = await fixture(),
    draft = await f.create()
  await db
    .update(organizationalUnits)
    .set({ status: 'INACTIVE' })
    .where(eq(organizationalUnits.id, f.ownerUnitId))
  await assert.rejects(
    () => f.repository.publish(f.actor, draft.id, 1),
    (e: unknown) => e instanceof ProcedureError && e.statusCode === 422,
  )
  assert.equal(await f.repository.published(f.serviceId), null)
})
test('API guards return 401/403 and validate input before mutation', async (t) => {
  const f = await fixture('GLOBAL', false)
  const app = buildApp({ procedureService: new ProcedureService(f.repository) })
  t.after(() => app.close())
  const preflight = await app.inject({
    method: 'OPTIONS',
    url: '/api/v1/admin/procedure-versions/' + randomUUID(),
    headers: {
      origin: env.corsOrigin,
      'access-control-request-method': 'PUT',
      'access-control-request-headers': 'content-type',
    },
  })
  assert.equal(preflight.statusCode, 204)
  assert.equal(preflight.headers['access-control-allow-origin'], env.corsOrigin)
  assert.ok(
    String(preflight.headers['access-control-allow-methods'])
      .split(',')
      .map((method) => method.trim())
      .includes('PUT'),
  )
  const missing = await app.inject({ method: 'GET', url: '/api/v1/admin/procedure-catalog' })
  assert.equal(missing.statusCode, 401)
  await app.ready()
  const token = app.jwt.sign(
    {
      sub: f.actor.userId,
      username: f.actor.username,
      roles: ['ADMIN'],
      mustChangePassword: false,
      portal: 'admin',
      aud: ADMIN_JWT_AUDIENCE,
      iss: JWT_ISSUER,
    },
    { expiresIn: 900 },
  )
  const cookie = ADMIN_SESSION_COOKIE_NAME + '=' + token
  const denied = await app.inject({
    method: 'GET',
    url: '/api/v1/admin/procedure-catalog',
    headers: { cookie },
  })
  assert.equal(denied.statusCode, 403)
  const permission = (
    await db.select().from(permissions).where(eq(permissions.code, 'service.configure'))
  )[0]!
  await db.insert(rolePermissions).values({ roleId: f.roleId, permissionId: permission.id })
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/services/' + f.serviceId + '/procedure-versions',
    headers: { cookie },
    payload: { ownerUnitId: f.ownerUnitId, cloneVersionId: null },
  })
  assert.equal(created.statusCode, 201, created.body)
  const draft = created.json<{ id: string; config: object }>()
  const invalid = await app.inject({
    method: 'PUT',
    url: '/api/v1/admin/procedure-versions/' + draft.id,
    headers: { cookie },
    payload: { expectedRevision: 1, config: { ...draft.config, processingMode: 'SHELL_SCRIPT' } },
  })
  assert.equal(invalid.statusCode, 400)
})

test('organization configurator can maintain and clone their own published version', async () => {
  const f = await fixture(),
    draft = await f.create()
  await db.delete(userRoleScopes).where(eq(userRoleScopes.userId, f.actor.userId))
  const scope = (
    await db
      .insert(authorizationScopes)
      .values({ scopeType: 'ORGANIZATION', organizationalUnitId: f.ownerUnitId })
      .returning()
  )[0]!
  await db
    .insert(userRoleScopes)
    .values({ userId: f.actor.userId, roleId: f.roleId, scopeId: scope.id })
  const updated = await f.repository.update(f.actor, draft.id, {
    expectedRevision: 1,
    config: { ...draft.config, contactInstructions: 'Đến trực tiếp Phòng CTSV.' },
  })
  await f.repository.publish(f.actor, updated.id, updated.revision)
  const clone = await f.repository.create(f.actor, {
    serviceId: f.serviceId,
    ownerUnitId: f.ownerUnitId,
    cloneVersionId: draft.id,
  })
  assert.equal(clone.status, 'DRAFT')
  assert.equal(clone.config.contactInstructions, updated.config.contactInstructions)
  assert.equal((await f.repository.catalog(f.actor.userId)).canCreate, false)
})
test('ONLINE accepts a real active reviewer with permission and scope in the processing unit', async () => {
  const f = await fixture(),
    draft = await f.create()
  const reviewer = await fixture('ORGANIZATION', false)
  await db.delete(userRoleScopes).where(eq(userRoleScopes.userId, reviewer.actor.userId))
  const scope = (
    await db
      .insert(authorizationScopes)
      .values({ scopeType: 'ORGANIZATION', organizationalUnitId: f.ownerUnitId })
      .returning()
  )[0]!
  await db
    .insert(userRoleScopes)
    .values({ userId: reviewer.actor.userId, roleId: reviewer.roleId, scopeId: scope.id })
  await db
    .insert(permissions)
    .values({ code: 'submission.review', name: 'Xét duyệt' })
    .onConflictDoNothing()
  const permission = (
    await db.select().from(permissions).where(eq(permissions.code, 'submission.review'))
  )[0]!
  await db.insert(rolePermissions).values({ roleId: reviewer.roleId, permissionId: permission.id })
  const updated = await f.repository.update(f.actor, draft.id, {
    expectedRevision: 1,
    config: { ...draft.config, processingMode: 'ONLINE', processorUserId: reviewer.actor.userId },
  })
  assert.equal(
    (await f.repository.publish(f.actor, updated.id, updated.revision)).status,
    'PUBLISHED',
  )
})
test('public configuration hides a published procedure when its owner becomes inactive', async () => {
  const f = await fixture(),
    draft = await f.create()
  const updated = await f.repository.update(f.actor, draft.id, {
    expectedRevision: 1,
    config: { ...draft.config, processingUnitId: f.otherUnitId },
  })
  await f.repository.publish(f.actor, updated.id, updated.revision)
  await db
    .update(organizationalUnits)
    .set({ status: 'INACTIVE' })
    .where(eq(organizationalUnits.id, f.ownerUnitId))
  assert.equal(await f.repository.published(f.serviceId), null)
})
