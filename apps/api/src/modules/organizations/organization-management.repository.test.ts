import assert from 'node:assert/strict'
import { eq, sql } from 'drizzle-orm'
import { after, beforeEach, test } from 'node:test'

import { databaseClient, db } from '../../db/client.js'
import { auditLogs } from '../audit/audit.schema.js'
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
} from './organization.schema.js'
import {
  DrizzleOrganizationManagementRepository,
  OrganizationConflictError,
  OrganizationForbiddenError,
} from './organization-management.repository.js'

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl || new URL(databaseUrl).pathname !== '/student_service_test') {
  throw new Error('Integration tests must use the student_service_test database')
}

const auditContext = {
  requestId: 'organization-test',
  ipAddress: '127.0.0.1',
  userAgent: 'node-test',
}

async function cleanDatabase() {
  await db.execute(sql`TRUNCATE TABLE ${auditLogs}`)
  await db.delete(userRoleScopes)
  await db.delete(authorizationScopes)
  await db.delete(rolePermissions)
  await db.delete(permissions)
  await db.delete(academicAdvisorAssignments)
  await db.delete(studentProfiles)
  await db.delete(academicClasses)
  await db.delete(faculties)
  await db.delete(organizationalUnits)
  await db.delete(userRoles)
  await db.delete(users)
  await db.delete(roles)
}

beforeEach(cleanDatabase)

after(async () => {
  await cleanDatabase()
  await databaseClient.end()
})

async function createActor(
  scope:
    | { scopeType: 'GLOBAL' }
    | { scopeType: 'FACULTY'; facultyId: string }
    | { scopeType: 'CLASS'; classId: string }
    | {
        scopeType: 'ORGANIZATION'
        organizationalUnitId: string
      },
) {
  const [actor] = await db
    .insert(users)
    .values({
      username: `organization.actor.${crypto.randomUUID()}`,
      fullName: 'Quản trị cơ cấu',
      status: 'ACTIVE',
      mustChangePassword: false,
    })
    .returning({ id: users.id, username: users.username })
  assert.ok(actor)

  const [role] = await db
    .insert(roles)
    .values({
      code: 'ADMIN',
      name: 'Quản trị nghiệp vụ',
      isSystem: true,
    })
    .returning({ id: roles.id })
  assert.ok(role)

  const [permission] = await db
    .insert(permissions)
    .values({
      code: 'organization.manage',
      name: 'Quản lý cơ cấu',
      isSystem: true,
    })
    .returning({ id: permissions.id })
  assert.ok(permission)

  await db.insert(userRoles).values({
    userId: actor.id,
    roleId: role.id,
  })
  await db.insert(rolePermissions).values({
    roleId: role.id,
    permissionId: permission.id,
  })

  const [authorizationScope] = await db
    .insert(authorizationScopes)
    .values(scope)
    .returning({ id: authorizationScopes.id })
  assert.ok(authorizationScope)

  await db.insert(userRoleScopes).values({
    userId: actor.id,
    roleId: role.id,
    scopeId: authorizationScope.id,
  })

  return actor
}

async function createFacultyAndClass(suffix: string) {
  const [faculty] = await db
    .insert(faculties)
    .values({
      code: `FAC-${suffix}`,
      name: `Khoa ${suffix}`,
    })
    .returning({ id: faculties.id })
  assert.ok(faculty)

  const [academicClass] = await db
    .insert(academicClasses)
    .values({
      facultyId: faculty.id,
      code: `CLASS-${suffix}`,
      name: `Lớp ${suffix}`,
    })
    .returning({ id: academicClasses.id })
  assert.ok(academicClass)

  return { faculty, academicClass }
}

async function createAdvisor(suffix: string, advisorRoleId?: number) {
  let roleId = advisorRoleId

  if (!roleId) {
    const [advisorRole] = await db
      .insert(roles)
      .values({
        code: 'ACADEMIC_ADVISOR',
        name: 'Giảng viên cố vấn',
        isSystem: true,
      })
      .returning({ id: roles.id })
    assert.ok(advisorRole)
    roleId = advisorRole.id
  }

  const [advisor] = await db
    .insert(users)
    .values({
      username: `advisor.${suffix}`,
      fullName: `Cố vấn ${suffix}`,
      email: `advisor.${suffix}@example.edu.vn`,
      status: 'ACTIVE',
      mustChangePassword: false,
    })
    .returning({ id: users.id })
  assert.ok(advisor)

  await db.insert(userRoles).values({
    userId: advisor.id,
    roleId,
  })

  return { ...advisor, roleId }
}

test('GLOBAL tạo khoa và lớp cùng scope và audit trong transaction', async () => {
  const actor = await createActor({ scopeType: 'GLOBAL' })
  const repository = new DrizzleOrganizationManagementRepository()
  const changedAt = new Date('2026-09-06T01:00:00.000Z')

  const faculty = await repository.createFaculty({
    actor: { userId: actor.id, username: actor.username },
    audit: auditContext,
    changedAt,
    code: 'cntt',
    name: 'Khoa Công nghệ thông tin',
  })
  const academicClass = await repository.createAcademicClass({
    actor: { userId: actor.id, username: actor.username },
    audit: auditContext,
    changedAt,
    facultyId: faculty.id,
    code: 'cntt-k1',
    name: 'Lớp CNTT K1',
  })

  const scopes = await db
    .select({
      type: authorizationScopes.scopeType,
      facultyId: authorizationScopes.facultyId,
      classId: authorizationScopes.classId,
    })
    .from(authorizationScopes)
  assert.ok(scopes.some((scope) => scope.type === 'FACULTY' && scope.facultyId === faculty.id))
  assert.ok(scopes.some((scope) => scope.type === 'CLASS' && scope.classId === academicClass.id))

  const events = await db
    .select({
      action: auditLogs.action,
    })
    .from(auditLogs)
  assert.deepEqual(events.map((event) => event.action).sort(), [
    'ACADEMIC_CLASS_CREATE',
    'FACULTY_CREATE',
  ])
})

test('FACULTY scope không thể sửa khoa nằm ngoài phạm vi', async () => {
  const first = await createFacultyAndClass('A')
  const second = await createFacultyAndClass('B')
  const actor = await createActor({
    scopeType: 'FACULTY',
    facultyId: first.faculty.id,
  })
  const repository = new DrizzleOrganizationManagementRepository()

  await assert.rejects(
    repository.updateFaculty({
      actor: { userId: actor.id, username: actor.username },
      audit: auditContext,
      changedAt: new Date('2026-09-06T02:00:00.000Z'),
      facultyId: second.faculty.id,
      name: 'Tên không được ghi',
    }),
    OrganizationForbiddenError,
  )

  const [unchanged] = await db
    .select({ name: faculties.name })
    .from(faculties)
    .where(eq(faculties.id, second.faculty.id))
  assert.equal(unchanged?.name, 'Khoa B')
  assert.deepEqual(await db.select().from(auditLogs), [])
})

test('thay cố vấn đóng kỳ cũ, mở kỳ mới và snapshot trả cố vấn hiện tại', async () => {
  const target = await createFacultyAndClass('ADVISOR')
  const actor = await createActor({ scopeType: 'GLOBAL' })
  const firstAdvisor = await createAdvisor('one')
  const secondAdvisor = await createAdvisor('two', firstAdvisor.roleId)
  const repository = new DrizzleOrganizationManagementRepository()
  const firstAt = new Date('2026-01-01T00:00:00.000Z')
  const secondAt = new Date('2026-06-01T00:00:00.000Z')

  await repository.setAcademicAdvisor({
    actor: { userId: actor.id, username: actor.username },
    audit: auditContext,
    changedAt: firstAt,
    effectiveAt: firstAt,
    classId: target.academicClass.id,
    advisorUserId: firstAdvisor.id,
  })
  await repository.setAcademicAdvisor({
    actor: { userId: actor.id, username: actor.username },
    audit: auditContext,
    changedAt: secondAt,
    effectiveAt: secondAt,
    classId: target.academicClass.id,
    advisorUserId: secondAdvisor.id,
  })

  const assignments = await db
    .select({
      advisorUserId: academicAdvisorAssignments.advisorUserId,
      validFrom: academicAdvisorAssignments.validFrom,
      validTo: academicAdvisorAssignments.validTo,
    })
    .from(academicAdvisorAssignments)
    .where(eq(academicAdvisorAssignments.classId, target.academicClass.id))
  assert.equal(assignments.length, 2)
  assert.equal(
    assignments.find((row) => row.advisorUserId === firstAdvisor.id)?.validTo?.toISOString(),
    secondAt.toISOString(),
  )

  const snapshot = await repository.getSnapshot(actor.id, new Date('2026-09-06T00:00:00.000Z'))
  assert.equal(snapshot.faculties[0]?.classes[0]?.currentAdvisor?.userId, secondAdvisor.id)
  assert.equal(snapshot.advisors.length, 2)
})

test('cố vấn không hợp lệ không làm mất phân công hiện tại', async () => {
  const target = await createFacultyAndClass('ROLLBACK')
  const actor = await createActor({ scopeType: 'GLOBAL' })
  const advisor = await createAdvisor('valid')
  const [ordinaryUser] = await db
    .insert(users)
    .values({
      username: 'ordinary.user',
      fullName: 'Người dùng thường',
      status: 'ACTIVE',
    })
    .returning({ id: users.id })
  assert.ok(ordinaryUser)
  const repository = new DrizzleOrganizationManagementRepository()
  const firstAt = new Date('2026-01-01T00:00:00.000Z')

  await repository.setAcademicAdvisor({
    actor: { userId: actor.id, username: actor.username },
    audit: auditContext,
    changedAt: firstAt,
    effectiveAt: firstAt,
    classId: target.academicClass.id,
    advisorUserId: advisor.id,
  })

  await assert.rejects(
    repository.setAcademicAdvisor({
      actor: { userId: actor.id, username: actor.username },
      audit: auditContext,
      changedAt: new Date('2026-06-01T00:00:00.000Z'),
      effectiveAt: new Date('2026-06-01T00:00:00.000Z'),
      classId: target.academicClass.id,
      advisorUserId: ordinaryUser.id,
    }),
    OrganizationConflictError,
  )

  const [assignment] = await db
    .select({
      advisorUserId: academicAdvisorAssignments.advisorUserId,
      validTo: academicAdvisorAssignments.validTo,
    })
    .from(academicAdvisorAssignments)
  assert.equal(assignment?.advisorUserId, advisor.id)
  assert.equal(assignment?.validTo, null)
})

test('GLOBAL tạo đơn vị hành chính cùng scope và audit trong transaction', async () => {
  const actor = await createActor({ scopeType: 'GLOBAL' })
  const repository = new DrizzleOrganizationManagementRepository()
  const changedAt = new Date('2026-09-06T04:00:00.000Z')

  const unit = await repository.createOrganizationalUnit({
    actor: { userId: actor.id, username: actor.username },
    audit: auditContext,
    changedAt,
    code: 'pctsv',
    name: 'Phòng Công tác sinh viên',
  })

  const [storedUnit] = await db
    .select({
      code: organizationalUnits.code,
      name: organizationalUnits.name,
    })
    .from(organizationalUnits)
    .where(eq(organizationalUnits.id, unit.id))
  assert.deepEqual(storedUnit, {
    code: 'PCTSV',
    name: 'Phòng Công tác sinh viên',
  })

  const [scope] = await db
    .select({
      scopeType: authorizationScopes.scopeType,
      organizationalUnitId: authorizationScopes.organizationalUnitId,
    })
    .from(authorizationScopes)
    .where(eq(authorizationScopes.organizationalUnitId, unit.id))
  assert.deepEqual(scope, {
    scopeType: 'ORGANIZATION',
    organizationalUnitId: unit.id,
  })

  const [event] = await db
    .select({
      action: auditLogs.action,
      resourceType: auditLogs.resourceType,
    })
    .from(auditLogs)
    .where(eq(auditLogs.resourceId, unit.id))
  assert.deepEqual(event, {
    action: 'ORGANIZATIONAL_UNIT_CREATE',
    resourceType: 'ORGANIZATIONAL_UNIT',
  })
})

test('ORGANIZATION scope chỉ sửa và nhìn thấy đúng đơn vị được giao', async () => {
  const [target, outside] = await db
    .insert(organizationalUnits)
    .values([
      { code: 'PDT', name: 'Phòng Đào tạo' },
      { code: 'PKHTC', name: 'Phòng Kế hoạch và Tài chính' },
    ])
    .returning({ id: organizationalUnits.id })
  assert.ok(target)
  assert.ok(outside)
  const actor = await createActor({
    scopeType: 'ORGANIZATION',
    organizationalUnitId: target.id,
  })
  await createAdvisor('hidden-from-organization-scope')
  const repository = new DrizzleOrganizationManagementRepository()
  const changedAt = new Date('2026-09-06T05:00:00.000Z')

  await repository.updateOrganizationalUnit({
    actor: { userId: actor.id, username: actor.username },
    audit: auditContext,
    changedAt,
    organizationalUnitId: target.id,
    name: 'Phòng Đào tạo và Bồi dưỡng',
  })

  await assert.rejects(
    repository.updateOrganizationalUnit({
      actor: { userId: actor.id, username: actor.username },
      audit: auditContext,
      changedAt,
      organizationalUnitId: outside.id,
      name: 'Không được cập nhật',
    }),
    OrganizationForbiddenError,
  )

  const snapshot = await repository.getSnapshot(actor.id, changedAt)
  assert.deepEqual(
    snapshot.organizationalUnits.map((unit) => unit.id),
    [target.id],
  )
  assert.equal(snapshot.organizationalUnits[0]?.name, 'Phòng Đào tạo và Bồi dưỡng')
  assert.equal(snapshot.capabilities.canCreateOrganizationalUnit, false)
  assert.deepEqual(snapshot.faculties, [])
  assert.deepEqual(snapshot.advisors, [])
})
