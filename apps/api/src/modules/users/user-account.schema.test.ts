import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { after, beforeEach, test } from 'node:test'

import { databaseClient, db } from '../../db/client.js'
import { roles, userRoles, users } from '../auth/auth.schema.js'
import { userActionTokens } from './user-account.schema.js'

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl || new URL(databaseUrl).pathname !== '/student_service_test') {
  throw new Error('Integration tests must use the student_service_test database')
}

beforeEach(async () => {
  await db.delete(userActionTokens)
  await db.delete(userRoles)
  await db.delete(users)
  await db.delete(roles)
})

after(async () => {
  await databaseClient.end()
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function expectPostgresConstraint(expectedCode: string, expectedConstraint: string) {
  return (error: unknown) => {
    if (!isRecord(error)) {
      throw new TypeError('Expected a Drizzle error object')
    }

    const cause = error['cause']

    if (!isRecord(cause)) {
      throw new TypeError('Expected a PostgreSQL cause')
    }

    assert.equal(cause['code'], expectedCode)

    assert.equal(cause['constraint_name'], expectedConstraint)

    return true
  }
}

async function createInvitedUser() {
  const insertedUsers = await db
    .insert(users)
    .values({
      username: 'student001',
      passwordHash: null,
      fullName: 'Sinh viên Test',
      email: 'student001@example.edu.vn',
      status: 'INVITED',
      mustChangePassword: false,
      invitedAt: new Date(),
    })
    .returning()

  const insertedUser = insertedUsers[0]

  assert.ok(insertedUser)

  return insertedUser
}

test('database từ chối token có purpose không hợp lệ', async () => {
  const user = await createInvitedUser()

  const createdAt = new Date()

  const expiresAt = new Date(createdAt.getTime() + 30 * 60 * 1000)

  await assert.rejects(
    async () => {
      await db.insert(userActionTokens).values({
        userId: user.id,
        purpose: 'SOMETHING_ELSE',
        tokenHash: 'a'.repeat(64),
        createdAt,
        expiresAt,
      })
    },
    expectPostgresConstraint('23514', 'user_action_tokens_purpose_check'),
  )
})

test('database chỉ cho một token đang mở trên mỗi user và purpose', async () => {
  const user = await createInvitedUser()

  const createdAt = new Date('2026-01-01T00:00:00.000Z')

  const expiresAt = new Date(createdAt.getTime() + 60 * 60 * 1000)

  const firstTokens = await db
    .insert(userActionTokens)
    .values({
      userId: user.id,
      purpose: 'ACCOUNT_ACTIVATION',
      tokenHash: 'a'.repeat(64),
      createdAt,
      expiresAt,
    })
    .returning({
      id: userActionTokens.id,
    })

  const firstToken = firstTokens[0]

  assert.ok(firstToken)

  // Đây chính là hành vi cốt lõi cần bảo vệ: một token
  // ACCOUNT_ACTIVATION khác, hợp lệ về purpose, vẫn phải bị
  // chặn nếu token đầu tiên chưa được revoke/consume.
  // tokenHash khác token đầu ('b' thay vì 'a') để đảm bảo
  // lỗi chắc chắn đến từ partial unique index, không phải
  // từ trùng tokenHash.
  await assert.rejects(
    async () => {
      await db.insert(userActionTokens).values({
        userId: user.id,
        purpose: 'ACCOUNT_ACTIVATION',
        tokenHash: 'b'.repeat(64),
        createdAt,
        expiresAt,
      })
    },
    expectPostgresConstraint('23505', 'user_action_tokens_one_open_idx'),
  )

  // Resend phải revoke token cũ
  await db
    .update(userActionTokens)
    .set({
      revokedAt: new Date(),
    })
    .where(eq(userActionTokens.id, firstToken.id))

  // Sau khi revoke, token mới được phép tạo
  await assert.doesNotReject(async () => {
    await db.insert(userActionTokens).values({
      userId: user.id,
      purpose: 'ACCOUNT_ACTIVATION',
      tokenHash: 'c'.repeat(64),
      createdAt,
      expiresAt,
    })
  })
})

test('database chấp nhận activation token trong hạn 72 giờ', async () => {
  const user = await createInvitedUser()

  const createdAt = new Date('2026-01-01T00:00:00.000Z')

  // Đúng biên trên cho phép (72h) — nếu constraint viết
  // lệch 1 (VD: "> 71 hours" thay vì "> 72 hours"), test
  // từ chối phía dưới sẽ không phát hiện được, nhưng test
  // này sẽ fail vì insert hợp lệ lại bị từ chối.
  const expiresAt = new Date(createdAt.getTime() + 72 * 60 * 60 * 1000)

  await assert.doesNotReject(async () => {
    await db.insert(userActionTokens).values({
      userId: user.id,
      purpose: 'ACCOUNT_ACTIVATION',
      tokenHash: 'e'.repeat(64),
      createdAt,
      expiresAt,
    })
  })
})

test('database từ chối activation token sống quá 72 giờ', async () => {
  const user = await createInvitedUser()

  const createdAt = new Date('2026-01-01T00:00:00.000Z')

  const expiresAt = new Date(createdAt.getTime() + 73 * 60 * 60 * 1000)

  await assert.rejects(
    async () => {
      await db.insert(userActionTokens).values({
        userId: user.id,
        purpose: 'ACCOUNT_ACTIVATION',
        tokenHash: 'c'.repeat(64),
        createdAt,
        expiresAt,
      })
    },
    expectPostgresConstraint('23514', 'user_action_tokens_expiration_policy_check'),
  )
})

test('database chấp nhận password reset token trong hạn 30 phút', async () => {
  const user = await createInvitedUser()

  const createdAt = new Date('2026-01-01T00:00:00.000Z')

  const expiresAt = new Date(createdAt.getTime() + 30 * 60 * 1000)

  await assert.doesNotReject(async () => {
    await db.insert(userActionTokens).values({
      userId: user.id,
      purpose: 'PASSWORD_RESET',
      tokenHash: 'f'.repeat(64),
      createdAt,
      expiresAt,
    })
  })
})

test('database từ chối password reset token sống quá 30 phút', async () => {
  const user = await createInvitedUser()

  const createdAt = new Date('2026-01-01T00:00:00.000Z')

  const expiresAt = new Date(createdAt.getTime() + 31 * 60 * 1000)

  await assert.rejects(
    async () => {
      await db.insert(userActionTokens).values({
        userId: user.id,
        purpose: 'PASSWORD_RESET',
        tokenHash: 'd'.repeat(64),
        createdAt,
        expiresAt,
      })
    },
    expectPostgresConstraint('23514', 'user_action_tokens_expiration_policy_check'),
  )
})
