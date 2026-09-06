import assert from 'node:assert/strict'
import {
  after,
  beforeEach,
  test,
} from 'node:test'

import {
  databaseClient,
  db,
} from '../../db/client.js'
import {
  academicClasses,
  faculties,
  organizationalUnits,
  studentProfiles,
} from '../organizations/organization.schema.js'
import {
  roles,
  userRoles,
  users,
} from './auth.schema.js'
import {
  authorizationScopes,
  permissions,
  rolePermissions,
  userRoleScopes,
} from './authorization.schema.js'
import {
  DrizzleScopeAuthorizationRepository,
} from './scope-authorization.repository.js'

const databaseUrl = process.env.DATABASE_URL

if (
  !databaseUrl
  || new URL(databaseUrl).pathname
    !== '/student_service_test'
) {
  throw new Error(
    'Integration tests must use the student_service_test database',
  )
}

beforeEach(async () => {
  await db.delete(userRoleScopes)
  await db.delete(authorizationScopes)
  await db.delete(rolePermissions)
  await db.delete(permissions)
  await db.delete(studentProfiles)
  await db.delete(academicClasses)
  await db.delete(faculties)
  await db.delete(organizationalUnits)
  await db.delete(userRoles)
  await db.delete(users)
  await db.delete(roles)
})

after(async () => {
  await databaseClient.end()
})

interface Fixture {
  actorUserId: string
  roleId: number
  firstFacultyId: string
  firstClassId: string
  siblingClassStudentId: string
  firstClassStudentId: string
  otherFacultyStudentId: string
}

async function createFixture(
  actorStatus = 'ACTIVE',
): Promise<Fixture> {
  const facultyRows = await db
    .insert(faculties)
    .values([
      {
        code: 'FACULTY-A',
        name: 'Khoa A',
      },
      {
        code: 'FACULTY-B',
        name: 'Khoa B',
      },
    ])
    .returning({ id: faculties.id })

  const firstFaculty = facultyRows[0]
  const otherFaculty = facultyRows[1]
  assert.ok(firstFaculty)
  assert.ok(otherFaculty)

  const classRows = await db
    .insert(academicClasses)
    .values([
      {
        facultyId: firstFaculty.id,
        code: 'CLASS-A1',
        name: 'Lớp A1',
      },
      {
        facultyId: firstFaculty.id,
        code: 'CLASS-A2',
        name: 'Lớp A2',
      },
      {
        facultyId: otherFaculty.id,
        code: 'CLASS-B1',
        name: 'Lớp B1',
      },
    ])
    .returning({ id: academicClasses.id })

  const firstClass = classRows[0]
  const siblingClass = classRows[1]
  const otherFacultyClass = classRows[2]
  assert.ok(firstClass)
  assert.ok(siblingClass)
  assert.ok(otherFacultyClass)

  const userRows = await db
    .insert(users)
    .values([
      {
        username: 'scope.actor',
        fullName: 'Actor kiểm thử',
        status: actorStatus,
      },
      {
        username: 'student.a1',
        fullName: 'Sinh viên A1',
        status: 'ACTIVE',
      },
      {
        username: 'student.a2',
        fullName: 'Sinh viên A2',
        status: 'ACTIVE',
      },
      {
        username: 'student.b1',
        fullName: 'Sinh viên B1',
        status: 'ACTIVE',
      },
    ])
    .returning({ id: users.id })

  const actor = userRows[0]
  const firstClassStudent = userRows[1]
  const siblingClassStudent = userRows[2]
  const otherFacultyStudent = userRows[3]
  assert.ok(actor)
  assert.ok(firstClassStudent)
  assert.ok(siblingClassStudent)
  assert.ok(otherFacultyStudent)

  await db.insert(studentProfiles).values([
    {
      userId: firstClassStudent.id,
      studentCode: 'STUDENT-A1',
      classId: firstClass.id,
    },
    {
      userId: siblingClassStudent.id,
      studentCode: 'STUDENT-A2',
      classId: siblingClass.id,
    },
    {
      userId: otherFacultyStudent.id,
      studentCode: 'STUDENT-B1',
      classId: otherFacultyClass.id,
    },
  ])

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
      code: 'student.read',
      name: 'Xem sinh viên',
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

  return {
    actorUserId: actor.id,
    roleId: role.id,
    firstFacultyId: firstFaculty.id,
    firstClassId: firstClass.id,
    firstClassStudentId: firstClassStudent.id,
    siblingClassStudentId:
      siblingClassStudent.id,
    otherFacultyStudentId:
      otherFacultyStudent.id,
  }
}

async function grantScope(
  fixture: Fixture,
  values:
    | { scopeType: 'GLOBAL' }
    | {
        scopeType: 'FACULTY'
        facultyId: string
      }
    | {
        scopeType: 'CLASS'
        classId: string
      }
    | {
        scopeType: 'ORGANIZATION'
        organizationalUnitId: string
      },
): Promise<void> {
  const [scope] = await db
    .insert(authorizationScopes)
    .values(values)
    .returning({ id: authorizationScopes.id })
  assert.ok(scope)

  await db.insert(userRoleScopes).values({
    userId: fixture.actorUserId,
    roleId: fixture.roleId,
    scopeId: scope.id,
  })
}

function canReadStudent(
  fixture: Fixture,
  studentUserId: string,
) {
  return new DrizzleScopeAuthorizationRepository()
    .canAccessStudent({
      actorUserId: fixture.actorUserId,
      permission: 'student.read',
      studentUserId,
    })
}

test(
  'GLOBAL scope đọc được sinh viên ở mọi khoa',
  async () => {
    const fixture = await createFixture()
    await grantScope(fixture, {
      scopeType: 'GLOBAL',
    })

    assert.equal(
      await canReadStudent(
        fixture,
        fixture.otherFacultyStudentId,
      ),
      true,
    )
  },
)

test(
  'FACULTY scope chỉ đọc sinh viên trong cùng khoa',
  async () => {
    const fixture = await createFixture()
    await grantScope(fixture, {
      scopeType: 'FACULTY',
      facultyId: fixture.firstFacultyId,
    })

    assert.equal(
      await canReadStudent(
        fixture,
        fixture.siblingClassStudentId,
      ),
      true,
    )
    assert.equal(
      await canReadStudent(
        fixture,
        fixture.otherFacultyStudentId,
      ),
      false,
    )
  },
)

test(
  'CLASS scope chỉ đọc sinh viên trong đúng lớp',
  async () => {
    const fixture = await createFixture()
    await grantScope(fixture, {
      scopeType: 'CLASS',
      classId: fixture.firstClassId,
    })

    assert.equal(
      await canReadStudent(
        fixture,
        fixture.firstClassStudentId,
      ),
      true,
    )
    assert.equal(
      await canReadStudent(
        fixture,
        fixture.siblingClassStudentId,
      ),
      false,
    )
  },
)

test(
  'ORGANIZATION scope không tự cấp quyền đọc sinh viên',
  async () => {
    const fixture = await createFixture()
    const [unit] = await db
      .insert(organizationalUnits)
      .values({
        code: 'FINANCE',
        name: 'Phòng Kế hoạch và Tài chính',
      })
      .returning({ id: organizationalUnits.id })
    assert.ok(unit)

    await grantScope(fixture, {
      scopeType: 'ORGANIZATION',
      organizationalUnitId: unit.id,
    })

    assert.equal(
      await canReadStudent(
        fixture,
        fixture.firstClassStudentId,
      ),
      false,
    )
  },
)

test(
  'scope không thay thế permission còn thiếu',
  async () => {
    const fixture = await createFixture()
    await grantScope(fixture, {
      scopeType: 'GLOBAL',
    })
    await db.delete(rolePermissions)

    assert.equal(
      await canReadStudent(
        fixture,
        fixture.firstClassStudentId,
      ),
      false,
    )
  },
)

test(
  'scope không cho tài khoản actor INACTIVE truy cập',
  async () => {
    const fixture =
      await createFixture('INACTIVE')
    await grantScope(fixture, {
      scopeType: 'GLOBAL',
    })

    assert.equal(
      await canReadStudent(
        fixture,
        fixture.firstClassStudentId,
      ),
      false,
    )
  },
)
