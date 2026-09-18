import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { after, beforeEach, test } from 'node:test'

import { databaseClient, db } from '../../db/client.js'
import {
  academicAdvisorAssignments,
  academicClasses,
  faculties,
  organizationalUnits,
  studentProfiles,
} from '../organizations/organization.schema.js'
import { roles, userRoles, users } from '../auth/auth.schema.js'
import {
  authorizationScopes,
  permissions,
  rolePermissions,
  userRoleScopes,
} from '../auth/authorization.schema.js'
import { DrizzleAdminStudentRepository } from './admin-student.repository.js'
import { auditLogs } from '../audit/audit.schema.js'

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl || new URL(databaseUrl).pathname !== '/student_service_test') {
  throw new Error('Integration tests must use the student_service_test database')
}

beforeEach(async () => {
  await db.delete(auditLogs)
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
  firstStudentUserId: string
}

async function createFixture(): Promise<Fixture> {
  const facultyRows = await db
    .insert(faculties)
    .values([
      {
        code: 'DIRECTORY-FACULTY-A',
        name: 'Khoa A',
      },
      {
        code: 'DIRECTORY-FACULTY-B',
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
        code: 'DIRECTORY-A1',
        name: 'Lớp A1',
      },
      {
        facultyId: firstFaculty.id,
        code: 'DIRECTORY-A2',
        name: 'Lớp A2',
      },
      {
        facultyId: otherFaculty.id,
        code: 'DIRECTORY-B1',
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
        username: 'directory.actor',
        fullName: 'Actor kiểm thử',
        status: 'ACTIVE',
      },
      {
        username: 'directory.student.001',
        fullName: 'Nguyễn An',
        email: 'directory.001@example.edu.vn',
        status: 'ACTIVE',
      },
      {
        username: 'directory.student.002',
        fullName: 'Trần Bình',
        email: 'directory.002@example.edu.vn',
        status: 'INVITED',
      },
      {
        username: 'directory.student.003',
        fullName: 'Lê Chi',
        email: null,
        status: 'ACTIVE',
      },
    ])
    .returning({ id: users.id })
  const actor = userRows[0]
  const firstStudent = userRows[1]
  const siblingStudent = userRows[2]
  const otherFacultyStudent = userRows[3]
  assert.ok(actor)
  assert.ok(firstStudent)
  assert.ok(siblingStudent)
  assert.ok(otherFacultyStudent)

  await db.insert(studentProfiles).values([
    {
      userId: firstStudent.id,
      studentCode: 'SV001',
      classId: firstClass.id,
    },
    {
      userId: siblingStudent.id,
      studentCode: 'SV002',
      classId: siblingClass.id,
    },
    {
      userId: otherFacultyStudent.id,
      studentCode: 'SV003',
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

  const permissionRows = await db
    .insert(permissions)
    .values([
      {
        code: 'student.read',
        name: 'Xem sinh viên',
        isSystem: true,
      },
      {
        code: 'student.update',
        name: 'Cập nhật sinh viên',
        isSystem: true,
      },
    ])
    .returning({ id: permissions.id })
  assert.equal(permissionRows.length, 2)

  await db.insert(userRoles).values({
    userId: actor.id,
    roleId: role.id,
  })
  await db.insert(rolePermissions).values(
    permissionRows.map((permission) => ({
      roleId: role.id,
      permissionId: permission.id,
    })),
  )

  return {
    actorUserId: actor.id,
    roleId: role.id,
    firstFacultyId: firstFaculty.id,
    firstClassId: firstClass.id,
    siblingClassId: siblingClass.id,
    firstStudentUserId: firstStudent.id,
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

test('CLASS scope chỉ liệt kê sinh viên trong đúng lớp', async () => {
  const fixture = await createFixture()
  await grantScope(fixture, {
    scopeType: 'CLASS',
    classId: fixture.firstClassId,
  })

  const result = await new DrizzleAdminStudentRepository().listVisibleTo({
    actorUserId: fixture.actorUserId,
    limit: 20,
  })

  assert.deepEqual(
    result.students.map((student) => student.studentCode),
    ['SV001'],
  )
  assert.equal(result.nextCursor, null)
})

test('FACULTY scope liệt kê mọi lớp trong khoa nhưng không vượt khoa', async () => {
  const fixture = await createFixture()
  await grantScope(fixture, {
    scopeType: 'FACULTY',
    facultyId: fixture.firstFacultyId,
  })

  const result = await new DrizzleAdminStudentRepository().listVisibleTo({
    actorUserId: fixture.actorUserId,
    limit: 20,
  })

  assert.deepEqual(
    result.students.map((student) => student.studentCode),
    ['SV001', 'SV002'],
  )
})

test('GLOBAL scope hỗ trợ cursor, status và search', async () => {
  const fixture = await createFixture()
  await grantScope(fixture, {
    scopeType: 'GLOBAL',
  })
  const repository = new DrizzleAdminStudentRepository()

  const firstPage = await repository.listVisibleTo({
    actorUserId: fixture.actorUserId,
    limit: 1,
  })
  assert.deepEqual(
    firstPage.students.map((student) => student.studentCode),
    ['SV001'],
  )
  assert.equal(firstPage.nextCursor, 'SV001')

  const secondPage = await repository.listVisibleTo({
    actorUserId: fixture.actorUserId,
    limit: 20,
    afterStudentCode: firstPage.nextCursor ?? undefined,
    status: 'INVITED',
    search: 'Trần',
  })
  assert.deepEqual(
    secondPage.students.map((student) => student.studentCode),
    ['SV002'],
  )
  assert.equal(secondPage.nextCursor, null)
})

test('permission hoặc scope thiếu thì danh sách rỗng', async () => {
  const fixture = await createFixture()
  const repository = new DrizzleAdminStudentRepository()

  const withoutScope = await repository.listVisibleTo({
    actorUserId: fixture.actorUserId,
    limit: 20,
  })
  assert.deepEqual(withoutScope.students, [])

  await grantScope(fixture, {
    scopeType: 'CLASS',
    classId: fixture.siblingClassId,
  })
  await db.delete(rolePermissions)

  const withoutPermission = await repository.listVisibleTo({
    actorUserId: fixture.actorUserId,
    limit: 20,
  })
  assert.deepEqual(withoutPermission.students, [])
})

test('cập nhật tên, mã số và lớp trong một transaction kèm audit', async () => {
  const fixture = await createFixture()
  await grantScope(fixture, {
    scopeType: 'FACULTY',
    facultyId: fixture.firstFacultyId,
  })
  const changedAt = new Date('2026-09-09T01:00:00.000Z')

  await new DrizzleAdminStudentRepository().updateStudent({
    actorUserId: fixture.actorUserId,
    actorUsername: 'directory.actor',
    userId: fixture.firstStudentUserId,
    studentCode: '001234',
    fullName: 'Nguyễn An mới',
    facultyId: fixture.firstFacultyId,
    classId: fixture.siblingClassId,
    changedAt,
    audit: {
      requestId: 'request-update-student',
      ipAddress: '127.0.0.1',
      userAgent: 'node-test',
    },
  })

  const [updated] = await db
    .select({
      fullName: users.fullName,
      studentCode: studentProfiles.studentCode,
      classId: studentProfiles.classId,
    })
    .from(users)
    .innerJoin(studentProfiles, eq(users.id, studentProfiles.userId))
    .where(eq(users.id, fixture.firstStudentUserId))
  assert.deepEqual(updated, {
    fullName: 'Nguyễn An mới',
    studentCode: '001234',
    classId: fixture.siblingClassId,
  })

  const [audit] = await db
    .select({
      action: auditLogs.action,
      before: auditLogs.before,
      after: auditLogs.after,
    })
    .from(auditLogs)
    .where(eq(auditLogs.resourceId, fixture.firstStudentUserId))
  assert.equal(audit?.action, 'STUDENT_PROFILE_UPDATE')
  assert.equal(audit?.before?.['studentCode'], 'SV001')
  assert.equal(audit?.after?.['studentCode'], '001234')
})
