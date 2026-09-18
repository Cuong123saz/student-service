import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'

import { databaseClient, db } from '../../db/client.js'
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
import { DrizzleAcademicCatalogRepository } from './academic-catalog.repository.js'

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl || new URL(databaseUrl).pathname !== '/student_service_test') {
  throw new Error('Integration tests must use the student_service_test database')
}

beforeEach(async () => {
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
})

after(async () => {
  await databaseClient.end()
})

interface Fixture {
  actorUserId: string
  roleId: number
  firstFacultyId: string
  firstClassId: string
  siblingClassId: string
}

async function createFixture(): Promise<Fixture> {
  const facultyRows = await db
    .insert(faculties)
    .values([
      {
        code: 'CATALOG-FACULTY-A',
        name: 'Khoa A',
      },
      {
        code: 'CATALOG-FACULTY-B',
        name: 'Khoa B',
      },
      {
        code: 'CATALOG-FACULTY-INACTIVE',
        name: 'Khoa ngừng hoạt động',
        status: 'INACTIVE',
      },
    ])
    .returning({ id: faculties.id })
  const firstFaculty = facultyRows[0]
  const secondFaculty = facultyRows[1]
  const inactiveFaculty = facultyRows[2]
  assert.ok(firstFaculty)
  assert.ok(secondFaculty)
  assert.ok(inactiveFaculty)

  const classRows = await db
    .insert(academicClasses)
    .values([
      {
        facultyId: firstFaculty.id,
        code: 'CATALOG-A1',
        name: 'Lớp A1',
      },
      {
        facultyId: firstFaculty.id,
        code: 'CATALOG-A2',
        name: 'Lớp A2',
      },
      {
        facultyId: secondFaculty.id,
        code: 'CATALOG-B1',
        name: 'Lớp B1',
      },
      {
        facultyId: firstFaculty.id,
        code: 'CATALOG-INACTIVE-CLASS',
        name: 'Lớp ngừng hoạt động',
        status: 'INACTIVE',
      },
      {
        facultyId: inactiveFaculty.id,
        code: 'CATALOG-INACTIVE-FACULTY-CLASS',
        name: 'Lớp thuộc khoa ngừng hoạt động',
      },
    ])
    .returning({ id: academicClasses.id })
  const firstClass = classRows[0]
  const siblingClass = classRows[1]
  assert.ok(firstClass)
  assert.ok(siblingClass)

  const [actor] = await db
    .insert(users)
    .values({
      username: 'catalog.actor',
      fullName: 'Actor kiểm thử catalog',
      status: 'ACTIVE',
    })
    .returning({ id: users.id })
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
    siblingClassId: siblingClass.id,
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
      },
) {
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

test('GLOBAL scope trả mọi khoa và lớp đang hoạt động', async () => {
  const fixture = await createFixture()
  await grantScope(fixture, {
    scopeType: 'GLOBAL',
  })

  const result = await new DrizzleAcademicCatalogRepository().listVisibleTo(fixture.actorUserId)

  assert.deepEqual(
    result.map((faculty) => ({
      code: faculty.code,
      classes: faculty.classes.map((academicClass) => academicClass.code),
    })),
    [
      {
        code: 'CATALOG-FACULTY-A',
        classes: ['CATALOG-A1', 'CATALOG-A2'],
      },
      {
        code: 'CATALOG-FACULTY-B',
        classes: ['CATALOG-B1'],
      },
    ],
  )
})

test('FACULTY scope không trả khoa khác', async () => {
  const fixture = await createFixture()
  await grantScope(fixture, {
    scopeType: 'FACULTY',
    facultyId: fixture.firstFacultyId,
  })

  const result = await new DrizzleAcademicCatalogRepository().listVisibleTo(fixture.actorUserId)

  assert.deepEqual(
    result.map((faculty) => ({
      code: faculty.code,
      classes: faculty.classes.map((academicClass) => academicClass.code),
    })),
    [
      {
        code: 'CATALOG-FACULTY-A',
        classes: ['CATALOG-A1', 'CATALOG-A2'],
      },
    ],
  )
})

test('CLASS scope chỉ trả đúng lớp được giao', async () => {
  const fixture = await createFixture()
  await grantScope(fixture, {
    scopeType: 'CLASS',
    classId: fixture.siblingClassId,
  })

  const result = await new DrizzleAcademicCatalogRepository().listVisibleTo(fixture.actorUserId)

  assert.deepEqual(
    result.map((faculty) => ({
      code: faculty.code,
      classes: faculty.classes.map((academicClass) => academicClass.code),
    })),
    [
      {
        code: 'CATALOG-FACULTY-A',
        classes: ['CATALOG-A2'],
      },
    ],
  )
})

test('thiếu permission hoặc scope thì catalog rỗng', async () => {
  const fixture = await createFixture()
  const repository = new DrizzleAcademicCatalogRepository()

  assert.deepEqual(await repository.listVisibleTo(fixture.actorUserId), [])

  await grantScope(fixture, {
    scopeType: 'CLASS',
    classId: fixture.firstClassId,
  })
  await db.delete(rolePermissions)

  assert.deepEqual(await repository.listVisibleTo(fixture.actorUserId), [])
})
