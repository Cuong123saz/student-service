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
} from './auth.schema.js'
import {
  DrizzleAuthorizationRepository,
} from './authorization.repository.js'
import {
  permissions,
  rolePermissions,
} from './authorization.schema.js'

const databaseUrl =
  process.env.DATABASE_URL

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
  await db.delete(rolePermissions)
  await db.delete(permissions)
  await db.delete(userRoles)
  await db.delete(users)
  await db.delete(roles)
})

after(async () => {
  await databaseClient.end()
})

async function createAssignment(
  status:
    | 'ACTIVE'
    | 'INACTIVE'
    | 'SUSPENDED',
  roleCode:
    | 'ADMIN'
    | 'SYSTEM_ADMIN' = 'ADMIN',
) {
  const insertedUsers = await db
    .insert(users)
    .values({
      username:
        `admin-${status.toLowerCase()}`,
      passwordHash: 'stored-hash',
      fullName: 'Admin Test',
      status,
      mustChangePassword: false,
    })
    .returning({ id: users.id })

  const user = insertedUsers[0]
  assert.ok(user)

  const insertedRoles = await db
    .insert(roles)
    .values({
      code: roleCode,
      name: 'Quản trị nghiệp vụ',
      isSystem: true,
    })
    .returning({ id: roles.id })

  const role = insertedRoles[0]
  assert.ok(role)

  const insertedPermissions = await db
    .insert(permissions)
    .values({
      code: 'audit.read',
      name: 'Xem nhật ký audit',
      isSystem: true,
    })
    .returning({ id: permissions.id })

  const permission =
    insertedPermissions[0]
  assert.ok(permission)

  await db.insert(userRoles).values({
    userId: user.id,
    roleId: role.id,
  })

  await db
    .insert(rolePermissions)
    .values({
      roleId: role.id,
      permissionId: permission.id,
    })

  return user.id
}

test(
  'hasPermission chấp nhận user active có permission qua role',
  async () => {
    const userId =
      await createAssignment('ACTIVE')
    const repository =
      new DrizzleAuthorizationRepository()

    const allowed = await repository
      .hasPermission({
        userId,
        permission: 'audit.read',
      })

    assert.equal(allowed, true)
  },
)

test(
  'hasPermission từ chối user inactive dù token cũ còn role',
  async () => {
    const userId =
      await createAssignment(
        'INACTIVE',
        'SYSTEM_ADMIN',
      )
    const repository =
      new DrizzleAuthorizationRepository()

    const allowed = await repository
      .hasPermission({
        userId,
        permission: 'audit.read',
      })

    assert.equal(allowed, false)
  },
)

test(
  'hasPermission từ chối user suspended dù token cũ còn role',
  async () => {
    const userId =
      await createAssignment(
        'SUSPENDED',
        'SYSTEM_ADMIN',
      )
    const repository =
      new DrizzleAuthorizationRepository()

    const allowed = await repository
      .hasPermission({
        userId,
        permission: 'audit.read',
      })

    assert.equal(allowed, false)
  },
)

test(
  'hasPermission deny by default khi role chưa được cấp permission',
  async () => {
    const userId =
      await createAssignment('ACTIVE')

    await db.delete(rolePermissions)

    const repository =
      new DrizzleAuthorizationRepository()

    const allowed = await repository
      .hasPermission({
        userId,
        permission: 'audit.read',
      })

    assert.equal(allowed, false)
  },
)
