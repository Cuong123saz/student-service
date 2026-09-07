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
  roles,
  userRoles,
  users,
} from '../auth/auth.schema.js'
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
  DrizzleStudentExportRepository,
  StudentExportRowLimitExceededError,
} from './student-export.repository.js'

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

test(
  'export chỉ lấy sinh viên thuộc FACULTY scope và permission export',
  async () => {
    const facultyRows = await db
      .insert(faculties)
      .values([
        { code: 'EXPORT-A', name: 'Khoa A' },
        { code: 'EXPORT-B', name: 'Khoa B' },
      ])
      .returning({ id: faculties.id })
    const facultyA = facultyRows[0]
    const facultyB = facultyRows[1]
    assert.ok(facultyA)
    assert.ok(facultyB)

    const classRows = await db
      .insert(academicClasses)
      .values([
        {
          facultyId: facultyA.id,
          code: 'EXPORT-A1',
          name: 'Lớp A1',
        },
        {
          facultyId: facultyB.id,
          code: 'EXPORT-B1',
          name: 'Lớp B1',
        },
      ])
      .returning({ id: academicClasses.id })
    const classA = classRows[0]
    const classB = classRows[1]
    assert.ok(classA)
    assert.ok(classB)

    const userRows = await db
      .insert(users)
      .values([
        {
          username: 'export.actor',
          fullName: 'Export Actor',
          status: 'ACTIVE',
        },
        {
          username: 'export.student.a',
          fullName: 'Sinh viên A',
          status: 'ACTIVE',
        },
        {
          username: 'export.student.b',
          fullName: 'Sinh viên B',
          status: 'ACTIVE',
        },
      ])
      .returning({ id: users.id })
    const actor = userRows[0]
    const studentA = userRows[1]
    const studentB = userRows[2]
    assert.ok(actor)
    assert.ok(studentA)
    assert.ok(studentB)

    await db.insert(studentProfiles).values([
      {
        userId: studentA.id,
        studentCode: 'EXPORT001',
        classId: classA.id,
      },
      {
        userId: studentB.id,
        studentCode: 'EXPORT002',
        classId: classB.id,
      },
    ])

    const [role] = await db.insert(roles).values({
      code: 'ADMIN',
      name: 'Quản trị nghiệp vụ',
      isSystem: true,
    }).returning({ id: roles.id })
    const [permission] = await db
      .insert(permissions)
      .values({
        code: 'student.export',
        name: 'Export sinh viên',
        isSystem: true,
      })
      .returning({ id: permissions.id })
    assert.ok(role)
    assert.ok(permission)

    await db.insert(userRoles).values({
      userId: actor.id,
      roleId: role.id,
    })
    await db.insert(rolePermissions).values({
      roleId: role.id,
      permissionId: permission.id,
    })
    const [scope] = await db
      .insert(authorizationScopes)
      .values({
        scopeType: 'FACULTY',
        facultyId: facultyA.id,
      })
      .returning({ id: authorizationScopes.id })
    assert.ok(scope)
    await db.insert(userRoleScopes).values({
      userId: actor.id,
      roleId: role.id,
      scopeId: scope.id,
    })

    const repository =
      new DrizzleStudentExportRepository()
    const result = await repository
      .listVisibleForExport({
        actorUserId: actor.id,
        maxRows: 10,
      })

    assert.deepEqual(
      result.map((student) => student.studentCode),
      ['EXPORT001'],
    )

    await assert.rejects(
      repository.listVisibleForExport({
        actorUserId: actor.id,
        maxRows: 0,
      }),
      StudentExportRowLimitExceededError,
    )

    await db.delete(rolePermissions)
    const withoutPermission = await repository
      .listVisibleForExport({
        actorUserId: actor.id,
        maxRows: 10,
      })
    assert.deepEqual(withoutPermission, [])
  },
)
