import assert from 'node:assert/strict'
import { eq, sql } from 'drizzle-orm'
import { after, beforeEach, test } from 'node:test'

import { databaseClient, db } from '../../db/client.js'
import { auditLogs } from '../audit/audit.schema.js'
import { roles, userRoles, users } from './auth.schema.js'
import {
  authorizationScopes,
  permissions,
  rolePermissions,
  userRoleScopes,
} from './authorization.schema.js'
import {
  DrizzleRolePermissionRepository,
  RolePermissionConflictError,
  RolePermissionForbiddenError,
} from './role-permission.repository.js'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl || new URL(databaseUrl).pathname !== '/student_service_test') {
  throw new Error('Integration tests must use the student_service_test database')
}

async function cleanDatabase() {
  await db.execute(sql`TRUNCATE TABLE ${auditLogs}`)
  await db.delete(userRoleScopes)
  await db.delete(authorizationScopes)
  await db.delete(rolePermissions)
  await db.delete(permissions)
  await db.delete(userRoles)
  await db.delete(users)
  await db.delete(roles)
}

beforeEach(cleanDatabase)
after(async () => {
  await cleanDatabase()
  await databaseClient.end()
})

async function createFixture(actorRoleCode = 'SYSTEM_ADMIN') {
  const [actor] = await db
    .insert(users)
    .values({
      username: `permission.actor.${crypto.randomUUID()}`,
      fullName: 'Quản trị quyền',
      status: 'ACTIVE',
      mustChangePassword: false,
    })
    .returning({ id: users.id, username: users.username })
  assert.ok(actor)

  const [actorRole, targetRole] = await db
    .insert(roles)
    .values([
      {
        code: actorRoleCode,
        name: actorRoleCode === 'SYSTEM_ADMIN' ? 'Quản trị hệ thống' : 'Quản trị nghiệp vụ',
        isSystem: true,
      },
      {
        code: 'ACADEMIC_ADVISOR',
        name: 'Giảng viên cố vấn',
        isSystem: true,
      },
    ])
    .returning({ id: roles.id, code: roles.code })
  assert.ok(actorRole)
  assert.ok(targetRole)

  const permissionRows = await db
    .insert(permissions)
    .values([
      { code: 'role.manage', name: 'Quản lý vai trò', isSystem: true },
      { code: 'student.read', name: 'Xem sinh viên', isSystem: true },
      { code: 'audit.read', name: 'Xem audit', isSystem: true },
    ])
    .returning({ id: permissions.id, code: permissions.code })
  const roleManage = permissionRows.find((row) => row.code === 'role.manage')
  const studentRead = permissionRows.find((row) => row.code === 'student.read')
  assert.ok(roleManage)
  assert.ok(studentRead)

  await db.insert(userRoles).values({
    userId: actor.id,
    roleId: actorRole.id,
  })
  await db.insert(rolePermissions).values([
    { roleId: actorRole.id, permissionId: roleManage.id },
    { roleId: targetRole.id, permissionId: studentRead.id },
  ])
  const [globalScope] = await db
    .insert(authorizationScopes)
    .values({ scopeType: 'GLOBAL' })
    .returning({ id: authorizationScopes.id })
  assert.ok(globalScope)
  await db.insert(userRoleScopes).values({
    userId: actor.id,
    roleId: actorRole.id,
    scopeId: globalScope.id,
  })

  return { actor, actorRole, targetRole }
}

const audit = {
  requestId: 'role-permission-test',
  ipAddress: '127.0.0.1',
  userAgent: 'node-test',
}

test('SYSTEM_ADMIN GLOBAL thay quyền role và ghi audit cùng transaction', async () => {
  const { actor, targetRole } = await createFixture()
  const repository = new DrizzleRolePermissionRepository()

  await repository.replacePermissions({
    actor: { userId: actor.id, username: actor.username },
    audit,
    roleId: targetRole.id,
    permissionCodes: ['audit.read', 'student.read'],
    changedAt: new Date('2026-09-06T06:00:00.000Z'),
  })

  const snapshot = await repository.getSnapshot(actor.id)
  assert.deepEqual(snapshot.roles.find((role) => role.id === targetRole.id)?.permissionCodes, [
    'audit.read',
    'student.read',
  ])
  assert.equal(snapshot.roles.find((role) => role.code === 'SYSTEM_ADMIN')?.canManage, false)

  const [event] = await db
    .select({
      action: auditLogs.action,
      before: auditLogs.before,
      after: auditLogs.after,
    })
    .from(auditLogs)
  assert.equal(event?.action, 'ROLE_PERMISSION_UPDATE')
  assert.deepEqual(event?.before, {
    roleCode: 'ACADEMIC_ADVISOR',
    permissionCodes: ['student.read'],
  })
  assert.deepEqual(event?.after, {
    roleCode: 'ACADEMIC_ADVISOR',
    permissionCodes: ['audit.read', 'student.read'],
  })
})

test('ADMIN có role.manage và GLOBAL vẫn không được sửa catalog', async () => {
  const { actor, targetRole } = await createFixture('ADMIN')
  const repository = new DrizzleRolePermissionRepository()

  await assert.rejects(
    repository.replacePermissions({
      actor: { userId: actor.id, username: actor.username },
      audit,
      roleId: targetRole.id,
      permissionCodes: [],
      changedAt: new Date('2026-09-06T06:30:00.000Z'),
    }),
    RolePermissionForbiddenError,
  )
  assert.deepEqual(await db.select().from(auditLogs), [])
})

test('không cho thay permission của SYSTEM_ADMIN', async () => {
  const { actor, actorRole } = await createFixture()
  const repository = new DrizzleRolePermissionRepository()

  await assert.rejects(
    repository.replacePermissions({
      actor: { userId: actor.id, username: actor.username },
      audit,
      roleId: actorRole.id,
      permissionCodes: [],
      changedAt: new Date('2026-09-06T07:00:00.000Z'),
    }),
    RolePermissionConflictError,
  )

  const grants = await db
    .select()
    .from(rolePermissions)
    .where(eq(rolePermissions.roleId, actorRole.id))
  assert.equal(grants.length, 1)
  assert.deepEqual(await db.select().from(auditLogs), [])
})
