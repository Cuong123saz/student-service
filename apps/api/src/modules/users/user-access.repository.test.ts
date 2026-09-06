import assert from 'node:assert/strict'
import { and, eq, sql } from 'drizzle-orm'
import { after, beforeEach, test } from 'node:test'

import { databaseClient, db } from '../../db/client.js'
import { auditLogs } from '../audit/audit.schema.js'
import { SYSTEM_ROLES, type SystemRoleCode } from '../auth/auth.constants.js'
import { roles, userRoles, users } from '../auth/auth.schema.js'
import {
  authorizationScopes,
  permissions,
  rolePermissions,
  userRoleScopes,
} from '../auth/authorization.schema.js'
import {
  academicAdvisorAssignments,
  academicClasses,
  faculties,
  organizationalUnits,
  studentProfiles,
} from '../organizations/organization.schema.js'
import {
  DrizzleUserAccessRepository,
  UserAccessConflictError,
  UserAccessForbiddenError,
  UserAccessValidationError,
} from './user-access.repository.js'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl || new URL(databaseUrl).pathname !== '/student_service_test') {
  throw new Error('Integration tests must use the student_service_test database')
}

async function cleanDatabase() {
  await db.execute(sql`TRUNCATE TABLE ${auditLogs}`)
  await db.delete(academicAdvisorAssignments)
  await db.delete(studentProfiles)
  await db.delete(userRoleScopes)
  await db.delete(authorizationScopes)
  await db.delete(rolePermissions)
  await db.delete(permissions)
  await db.delete(userRoles)
  await db.delete(users)
  await db.delete(roles)
  await db.delete(academicClasses)
  await db.delete(faculties)
  await db.delete(organizationalUnits)
}

beforeEach(async () => {
  await cleanDatabase()
  await db.insert(roles).values([...SYSTEM_ROLES])
})

after(async () => {
  await cleanDatabase()
  await databaseClient.end()
})

async function roleId(code: SystemRoleCode) {
  const [role] = await db.select({ id: roles.id })
    .from(roles)
    .where(eq(roles.code, code))
  assert.ok(role)
  return role.id
}

async function createOrganization() {
  const [facultyA, facultyB] = await db.insert(faculties).values([
    { code: 'FAC-A', name: 'Khoa A' },
    { code: 'FAC-B', name: 'Khoa B' },
  ]).returning({ id: faculties.id, code: faculties.code })
  assert.ok(facultyA && facultyB)
  const [classA, classB] = await db.insert(academicClasses).values([
    { facultyId: facultyA.id, code: 'CLASS-A', name: 'Lớp A' },
    { facultyId: facultyB.id, code: 'CLASS-B', name: 'Lớp B' },
  ]).returning({ id: academicClasses.id, facultyId: academicClasses.facultyId })
  assert.ok(classA && classB)
  const [unit] = await db.insert(organizationalUnits).values({
    code: 'CTSV',
    name: 'Phòng Công tác sinh viên',
  }).returning({ id: organizationalUnits.id })
  assert.ok(unit)
  const scopeRows = await db.insert(authorizationScopes).values([
    { scopeType: 'GLOBAL' },
    { scopeType: 'FACULTY', facultyId: facultyA.id },
    { scopeType: 'FACULTY', facultyId: facultyB.id },
    { scopeType: 'CLASS', classId: classA.id },
    { scopeType: 'CLASS', classId: classB.id },
    { scopeType: 'ORGANIZATION', organizationalUnitId: unit.id },
  ]).returning({
    id: authorizationScopes.id,
    type: authorizationScopes.scopeType,
    facultyId: authorizationScopes.facultyId,
    classId: authorizationScopes.classId,
    organizationalUnitId: authorizationScopes.organizationalUnitId,
  })
  const findScope = (predicate: (row: typeof scopeRows[number]) => boolean) => {
    const scope = scopeRows.find(predicate)
    assert.ok(scope)
    return scope
  }
  return {
    facultyA,
    facultyB,
    classA,
    classB,
    unit,
    globalScope: findScope(row => row.type === 'GLOBAL'),
    facultyAScope: findScope(row => row.facultyId === facultyA.id),
    facultyBScope: findScope(row => row.facultyId === facultyB.id),
    classAScope: findScope(row => row.classId === classA.id),
    classBScope: findScope(row => row.classId === classB.id),
    unitScope: findScope(row => row.organizationalUnitId === unit.id),
  }
}

async function createActor(
  roleCode: 'SYSTEM_ADMIN' | 'ADMIN',
  scopeId: string,
) {
  const [actor] = await db.insert(users).values({
    username: `actor.${roleCode.toLowerCase()}.${crypto.randomUUID()}`,
    fullName: 'Người quản trị',
    status: 'ACTIVE',
    mustChangePassword: false,
  }).returning({ id: users.id, username: users.username })
  assert.ok(actor)
  const actorRoleId = await roleId(roleCode)
  const [permission] = await db.insert(permissions).values({
    code: 'role.manage',
    name: 'Quản lý vai trò',
  }).returning({ id: permissions.id })
  assert.ok(permission)
  await db.insert(userRoles).values({
    userId: actor.id,
    roleId: actorRoleId,
  })
  await db.insert(rolePermissions).values({
    roleId: actorRoleId,
    permissionId: permission.id,
  })
  await db.insert(userRoleScopes).values({
    userId: actor.id,
    roleId: actorRoleId,
    scopeId,
  })
  return {
    id: actor.id,
    userId: actor.id,
    username: actor.username,
  }
}

async function createStudent(
  suffix: string,
  classId: string,
) {
  const [user] = await db.insert(users).values({
    username: `student.${suffix}`,
    fullName: `Sinh viên ${suffix}`,
    email: `student.${suffix}@example.edu.vn`,
    status: 'ACTIVE',
    mustChangePassword: false,
  }).returning({ id: users.id })
  assert.ok(user)
  await db.insert(userRoles).values({
    userId: user.id,
    roleId: await roleId('STUDENT'),
  })
  await db.insert(studentProfiles).values({
    userId: user.id,
    studentCode: `SV-${suffix}`,
    classId,
  })
  return user
}

const audit = {
  requestId: 'access-test',
  ipAddress: '127.0.0.1',
  userAgent: 'node-test',
}

test('GLOBAL xem được catalog role, scope và người dùng', async () => {
  const organization = await createOrganization()
  const actor = await createActor('SYSTEM_ADMIN', organization.globalScope.id)
  const student = await createStudent('GLOBAL', organization.classA.id)
  const repository = new DrizzleUserAccessRepository()

  const snapshot = await repository.getSnapshot({ actorUserId: actor.id })

  assert.equal(snapshot.roles.length, 6)
  assert.equal(snapshot.scopes.length, 6)
  assert.ok(snapshot.users.some(user => user.id === student.id && user.canManage))
  assert.ok(snapshot.users.some(user => user.id === actor.id && !user.canManage))
})

test('ADMIN phạm vi khoa không nhìn hoặc sửa sinh viên ngoài khoa', async () => {
  const organization = await createOrganization()
  const actor = await createActor('ADMIN', organization.facultyAScope.id)
  const inside = await createStudent('INSIDE', organization.classA.id)
  const outside = await createStudent('OUTSIDE', organization.classB.id)
  const repository = new DrizzleUserAccessRepository()

  const snapshot = await repository.getSnapshot({ actorUserId: actor.id })
  assert.ok(snapshot.users.some(user => user.id === inside.id))
  assert.ok(!snapshot.users.some(user => user.id === outside.id))

  await assert.rejects(
    repository.replaceAssignments({
      actor,
      audit,
      targetUserId: outside.id,
      assignments: [{ roleCode: 'STUDENT', scopeIds: [] }],
      changedAt: new Date('2026-09-06T10:00:00.000Z'),
    }),
    UserAccessForbiddenError,
  )
})

test('thay role và scope ghi audit trong cùng transaction', async () => {
  const organization = await createOrganization()
  const actor = await createActor('SYSTEM_ADMIN', organization.globalScope.id)
  const target = await createStudent('CHANGE', organization.classA.id)
  const repository = new DrizzleUserAccessRepository()

  await repository.replaceAssignments({
    actor,
    audit,
    targetUserId: target.id,
    assignments: [
      { roleCode: 'STUDENT', scopeIds: [] },
      {
        roleCode: 'FACULTY_REVIEWER',
        scopeIds: [organization.facultyAScope.id],
      },
    ],
    changedAt: new Date('2026-09-06T11:00:00.000Z'),
  })

  const assigned = await db.select({
    roleCode: roles.code,
    scopeId: userRoleScopes.scopeId,
  }).from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .leftJoin(userRoleScopes, and(
      eq(userRoleScopes.userId, userRoles.userId),
      eq(userRoleScopes.roleId, userRoles.roleId),
    ))
    .where(eq(userRoles.userId, target.id))
    .orderBy(roles.code)
  assert.deepEqual(assigned, [
    {
      roleCode: 'FACULTY_REVIEWER',
      scopeId: organization.facultyAScope.id,
    },
    { roleCode: 'STUDENT', scopeId: null },
  ])
  const [event] = await db.select().from(auditLogs)
  assert.equal(event?.action, 'ROLE_ASSIGNMENT_UPDATE')
  assert.deepEqual(event?.after, {
    assignments: [
      `FACULTY_REVIEWER:${organization.facultyAScope.id}`,
      'STUDENT:NONE',
    ],
  })
})

test('scope không tương thích làm rollback role và audit', async () => {
  const organization = await createOrganization()
  const actor = await createActor('SYSTEM_ADMIN', organization.globalScope.id)
  const target = await createStudent('ROLLBACK', organization.classA.id)
  const repository = new DrizzleUserAccessRepository()

  await assert.rejects(
    repository.replaceAssignments({
      actor,
      audit,
      targetUserId: target.id,
      assignments: [
        { roleCode: 'STUDENT', scopeIds: [] },
        {
          roleCode: 'ACADEMIC_ADVISOR',
          scopeIds: [organization.facultyAScope.id],
        },
      ],
      changedAt: new Date('2026-09-06T12:00:00.000Z'),
    }),
    UserAccessValidationError,
  )
  const currentRoles = await db.select({ code: roles.code })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, target.id))
  assert.deepEqual(currentRoles, [{ code: 'STUDENT' }])
  assert.deepEqual(await db.select().from(auditLogs), [])
})

test('không cho người quản trị tự thay role và scope', async () => {
  const organization = await createOrganization()
  const actor = await createActor('SYSTEM_ADMIN', organization.globalScope.id)
  const repository = new DrizzleUserAccessRepository()

  await assert.rejects(
    repository.replaceAssignments({
      actor,
      audit,
      targetUserId: actor.id,
      assignments: [{
        roleCode: 'SYSTEM_ADMIN',
        scopeIds: [organization.globalScope.id],
      }],
      changedAt: new Date('2026-09-06T13:00:00.000Z'),
    }),
    UserAccessConflictError,
  )
})

test('không gán role STUDENT cho tài khoản thiếu hồ sơ sinh viên', async () => {
  const organization = await createOrganization()
  const actor = await createActor('SYSTEM_ADMIN', organization.globalScope.id)
  const [staff] = await db.insert(users).values({
    username: 'staff.without-profile',
    fullName: 'Cán bộ không có hồ sơ sinh viên',
    status: 'ACTIVE',
  }).returning({ id: users.id })
  assert.ok(staff)
  const repository = new DrizzleUserAccessRepository()

  await assert.rejects(
    repository.replaceAssignments({
      actor,
      audit,
      targetUserId: staff.id,
      assignments: [{ roleCode: 'STUDENT', scopeIds: [] }],
      changedAt: new Date('2026-09-06T13:30:00.000Z'),
    }),
    UserAccessValidationError,
  )
  assert.deepEqual(
    await db.select().from(userRoles).where(eq(userRoles.userId, staff.id)),
    [],
  )
})

test('phải kết thúc phân công cố vấn trước khi thu hồi role', async () => {
  const organization = await createOrganization()
  const actor = await createActor('SYSTEM_ADMIN', organization.globalScope.id)
  const [advisor] = await db.insert(users).values({
    username: 'advisor.active',
    fullName: 'Cố vấn đang phụ trách',
    status: 'ACTIVE',
  }).returning({ id: users.id })
  assert.ok(advisor)
  const advisorRoleId = await roleId('ACADEMIC_ADVISOR')
  await db.insert(userRoles).values({ userId: advisor.id, roleId: advisorRoleId })
  await db.insert(userRoleScopes).values({
    userId: advisor.id,
    roleId: advisorRoleId,
    scopeId: organization.classAScope.id,
  })
  await db.insert(academicAdvisorAssignments).values({
    advisorUserId: advisor.id,
    classId: organization.classA.id,
    validFrom: new Date('2026-01-01T00:00:00.000Z'),
  })
  const repository = new DrizzleUserAccessRepository()

  await assert.rejects(
    repository.replaceAssignments({
      actor,
      audit,
      targetUserId: advisor.id,
      assignments: [{
        roleCode: 'DOCUMENT_SIGNER',
        scopeIds: [organization.unitScope.id],
      }],
      changedAt: new Date('2026-09-06T14:00:00.000Z'),
    }),
    UserAccessConflictError,
  )
})
