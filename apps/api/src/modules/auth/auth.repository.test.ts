import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
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
  DrizzleAuthUserRepository,
} from './auth.repository.js'

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
  await db.delete(userRoles)
  await db.delete(users)
  await db.delete(roles)
})

after(async () => {
  await databaseClient.end()
})

test(
  'findByUsername trả tài khoản cùng các role',
  async () => {
    const insertedUsers = await db
      .insert(users)
      .values({
        username: 'student001',
        passwordHash: 'stored-password-hash',
        fullName: 'Nguyễn Văn A',
        status: 'ACTIVE',
        mustChangePassword: true,
      })
      .returning()

    const insertedUser =
      insertedUsers[0]

    assert.ok(insertedUser)

    const insertedRoles = await db
      .insert(roles)
      .values([
        {
          code: 'STUDENT',
          name: 'Sinh viên',
          isSystem: true,
        },
        {
          code: 'DOCUMENT_SIGNER',
          name: 'Người ký văn bản',
          isSystem: true,
        },
      ])
      .returning()

    const studentRole =
      insertedRoles.find(
        (role) =>
          role.code === 'STUDENT',
      )

    const signerRole =
      insertedRoles.find(
        (role) =>
          role.code
            === 'DOCUMENT_SIGNER',
      )

    assert.ok(studentRole)
    assert.ok(signerRole)

    await db.insert(userRoles).values([
      {
        userId: insertedUser.id,
        roleId: studentRole.id,
      },
      {
        userId: insertedUser.id,
        roleId: signerRole.id,
      },
    ])

    const repository =
      new DrizzleAuthUserRepository()

    const result =
      await repository.findByUsername(
        'student001',
      )

    assert.ok(result)

    assert.equal(
      result.id,
      insertedUser.id,
    )
    assert.equal(
      result.passwordHash,
      'stored-password-hash',
    )
    assert.equal(
      result.mustChangePassword,
      true,
    )

    assert.deepEqual(
      [...result.roles].sort(),
      [
        'DOCUMENT_SIGNER',
        'STUDENT',
      ],
    )
  },
)

test(
  'findByUsername trả null khi không tồn tại',
  async () => {
    const repository =
      new DrizzleAuthUserRepository()

    const result =
      await repository.findByUsername(
        'unknown',
      )

    assert.equal(result, null)
  },
)
test(
  'findPasswordStateById trả trạng thái mật khẩu',
  async () => {
    const insertedUsers = await db
      .insert(users)
      .values({
        username: 'admin001',
        passwordHash: 'old-hash',
        fullName: 'Admin Test',
        status: 'ACTIVE',
        mustChangePassword: true,
      })
      .returning()

    const insertedUser =
      insertedUsers[0]

    assert.ok(insertedUser)

    const repository =
      new DrizzleAuthUserRepository()

    const result =
      await repository
        .findPasswordStateById(
          insertedUser.id,
        )

    assert.deepEqual(result, {
      id: insertedUser.id,
      passwordHash: 'old-hash',
      status: 'ACTIVE',
    })
  },
)

test(
  'updatePassword cập nhật hash và hoàn thành đổi mật khẩu',
  async () => {
    const insertedUsers = await db
      .insert(users)
      .values({
        username: 'admin001',
        passwordHash: 'old-hash',
        fullName: 'Admin Test',
        status: 'ACTIVE',
        mustChangePassword: true,
      })
      .returning()

    const insertedUser =
      insertedUsers[0]

    assert.ok(insertedUser)

    const repository =
      new DrizzleAuthUserRepository()

    const updated =
      await repository.updatePassword(
        insertedUser.id,
        'new-hash',
      )

    assert.equal(updated, true)

    const rows = await db
      .select({
        passwordHash:
          users.passwordHash,
        mustChangePassword:
          users.mustChangePassword,
      })
      .from(users)
      .where(
        eq(users.id, insertedUser.id),
      )

    assert.deepEqual(rows[0], {
      passwordHash: 'new-hash',
      mustChangePassword: false,
    })
  },
)

test(
  'updatePassword trả false khi user không tồn tại',
  async () => {
    const repository =
      new DrizzleAuthUserRepository()

    const updated =
      await repository.updatePassword(
        '85ca4291-c7bd-4370-a117-976bf237261c',
        'new-hash',
      )

    assert.equal(updated, false)
  },
)