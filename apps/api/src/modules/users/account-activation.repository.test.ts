import assert from 'node:assert/strict'
import {
  eq,
} from 'drizzle-orm'
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
  users,
} from '../auth/auth.schema.js'

import {
  userActionTokens,
} from './user-account.schema.js'

import {
  DrizzleAccountActivationRepository,
  type ActivationRepositoryLogger,
} from './account-activation.repository.js'

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

const tokenHash =
  'a'.repeat(64)

const checkedAt =
  new Date('2026-01-01T00:00:00.000Z')

const activatedAt =
  new Date('2026-01-01T00:00:02.000Z')

class FakeActivationLogger
implements ActivationRepositoryLogger {
  warnings: Array<{
    context: {
      event:
        'ACTIVATION_USER_STATE_CONFLICT'
      tokenId: string
      userId: string
    }
    message: string
  }> = []

  warn(
    context: {
      event:
        'ACTIVATION_USER_STATE_CONFLICT'
      tokenId: string
      userId: string
    },
    message: string,
  ): void {
    this.warnings.push({
      context,
      message,
    })
  }
}

beforeEach(async () => {
  await db.delete(userActionTokens)
  await db.delete(users)
})

after(async () => {
  await databaseClient.end()
})

async function createInvitedAccount(
  expiresAt =
    new Date(
      checkedAt.getTime()
      + 60 * 60 * 1000,
    ),
) {
  const insertedUsers =
    await db
      .insert(users)
      .values({
        username:
          'activation.student',
        email:
          'activation.student@example.edu.vn',
        fullName:
          'Sinh viên Activation',
        passwordHash: null,
        status: 'INVITED',
        mustChangePassword: false,
        invitedAt: checkedAt,
      })
      .returning({
        id: users.id,
      })

  const user =
    insertedUsers[0]

  assert.ok(user)

  const insertedTokens =
    await db
      .insert(userActionTokens)
      .values({
        userId: user.id,
        purpose:
          'ACCOUNT_ACTIVATION',
        tokenHash,
        createdAt: checkedAt,
        expiresAt,
      })
      .returning({
        id: userActionTokens.id,
      })

  const token =
    insertedTokens[0]

  assert.ok(token)

  return {
    userId: user.id,
    tokenId: token.id,
  }
}

test(
  'kích hoạt user và consume token trong cùng transaction',
  async () => {
    const account =
      await createInvitedAccount()

    const logger =
      new FakeActivationLogger()

    const repository =
      new DrizzleAccountActivationRepository(
        logger,
      )

    const candidate =
      await repository
        .findUsableActivationToken(
          tokenHash,
          checkedAt,
        )

    assert.deepEqual(candidate, {
      tokenId: account.tokenId,
      userId: account.userId,
    })

    const completed =
      await repository
        .completeActivation({
          tokenId:
            account.tokenId,
          userId:
            account.userId,
          tokenHash,
          passwordHash:
            'argon2-hash-for-test',
          activatedAt,
        })

    assert.equal(completed, true)

    const activatedUsers =
      await db
        .select({
          status: users.status,
          passwordHash:
            users.passwordHash,
          activatedAt:
            users.activatedAt,
          mustChangePassword:
            users.mustChangePassword,
        })
        .from(users)
        .where(
          eq(
            users.id,
            account.userId,
          ),
        )

    assert.deepEqual(
      activatedUsers[0],
      {
        status: 'ACTIVE',
        passwordHash:
          'argon2-hash-for-test',
        activatedAt,
        mustChangePassword: false,
      },
    )

    const consumedTokens =
      await db
        .select({
          consumedAt:
            userActionTokens.consumedAt,
        })
        .from(userActionTokens)
        .where(
          eq(
            userActionTokens.id,
            account.tokenId,
          ),
        )

    assert.deepEqual(
      consumedTokens[0],
      {
        consumedAt: activatedAt,
      },
    )

    // Token đã dùng lần thứ hai chỉ trả false,
    // không tạo warning bất thường.
    const secondAttempt =
      await repository
        .completeActivation({
          tokenId:
            account.tokenId,
          userId:
            account.userId,
          tokenHash,
          passwordHash:
            'another-hash',
          activatedAt,
        })

    assert.equal(secondAttempt, false)
    assert.deepEqual(
      logger.warnings,
      [],
    )
  },
)

test(
  'token hết hạn trong lúc hash password không được consume',
  async () => {
    const expiresAt =
      new Date(
        checkedAt.getTime()
        + 1_000,
      )

    const account =
      await createInvitedAccount(
        expiresAt,
      )

    const logger =
      new FakeActivationLogger()

    const repository =
      new DrizzleAccountActivationRepository(
        logger,
      )

    const candidate =
      await repository
        .findUsableActivationToken(
          tokenHash,
          checkedAt,
        )

    assert.ok(candidate)

    const completed =
      await repository
        .completeActivation({
          tokenId:
            account.tokenId,
          userId:
            account.userId,
          tokenHash,
          passwordHash:
            'argon2-hash-for-test',

          // Sau thời điểm expiresAt.
          activatedAt,
        })

    assert.equal(completed, false)

    const tokenRows =
      await db
        .select({
          consumedAt:
            userActionTokens.consumedAt,
        })
        .from(userActionTokens)
        .where(
          eq(
            userActionTokens.id,
            account.tokenId,
          ),
        )

    assert.equal(
      tokenRows[0]?.consumedAt,
      null,
    )

    const userRows =
      await db
        .select({
          status: users.status,
          passwordHash:
            users.passwordHash,
        })
        .from(users)
        .where(
          eq(
            users.id,
            account.userId,
          ),
        )

    assert.deepEqual(
      userRows[0],
      {
        status: 'INVITED',
        passwordHash: null,
      },
    )

    assert.deepEqual(
      logger.warnings,
      [],
    )
  },
)

test(
  'user state conflict rollback consumedAt và tạo warning nội bộ',
  async () => {
    const account =
      await createInvitedAccount()

    const logger =
      new FakeActivationLogger()

    const repository =
      new DrizzleAccountActivationRepository(
        logger,
      )

    const candidate =
      await repository
        .findUsableActivationToken(
          tokenHash,
          checkedAt,
        )

    assert.ok(candidate)

    // Mô phỏng một luồng khác kích hoạt user
    // sau pre-check nhưng trước CAS cuối.
    await db
      .update(users)
      .set({
        status: 'ACTIVE',
        passwordHash:
          'hash-from-another-flow',
        activatedAt: checkedAt,
      })
      .where(
        eq(
          users.id,
          account.userId,
        ),
      )

    const completed =
      await repository
        .completeActivation({
          tokenId:
            account.tokenId,
          userId:
            account.userId,
          tokenHash,
          passwordHash:
            'argon2-hash-for-test',
          activatedAt,
        })

    assert.equal(completed, false)

    const tokenRows =
      await db
        .select({
          consumedAt:
            userActionTokens.consumedAt,
        })
        .from(userActionTokens)
        .where(
          eq(
            userActionTokens.id,
            account.tokenId,
          ),
        )

    // Token update xảy ra trước user update,
    // nhưng transaction phải rollback nó.
    assert.equal(
      tokenRows[0]?.consumedAt,
      null,
    )

    assert.deepEqual(
      logger.warnings,
      [
        {
          context: {
            event:
              'ACTIVATION_USER_STATE_CONFLICT',
            tokenId:
              account.tokenId,
            userId:
              account.userId,
          },
          message:
            'Activation token was claimable but user was not activatable',
        },
      ],
    )
  },
)