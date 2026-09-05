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
  roles,
  userRoles,
  users,
} from '../auth/auth.schema.js'

import {
  userActionTokens,
} from './user-account.schema.js'

import {
  DrizzleUserInvitationRepository,
} from './user-invitation.repository.js'

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

const invitedAt =
  new Date('2026-01-01T00:00:00.000Z')

beforeEach(async () => {
  await db.delete(userActionTokens)
  await db.delete(userRoles)
  await db.delete(users)
  await db.delete(roles)
})

after(async () => {
  await databaseClient.end()
})

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === 'object'
    && value !== null
  )
}

async function createActor() {
  const insertedActors =
    await db
      .insert(users)
      .values({
        username: 'system.admin',
        email: 'admin@example.edu.vn',
        passwordHash: 'not-used',
        fullName: 'System Admin',
        status: 'ACTIVE',
        mustChangePassword: false,
      })
      .returning({
        id: users.id,
      })

  const actor =
    insertedActors[0]

  assert.ok(actor)

  return actor
}

async function createStudentRole() {
  await db
    .insert(roles)
    .values({
      code: 'STUDENT',
      name: 'Sinh viên',
      isSystem: true,
    })
}

test(
  'tạo user INVITED cùng role và activation token trong một transaction',
  async () => {
    await createStudentRole()

    const actor =
      await createActor()

    const repository =
      new DrizzleUserInvitationRepository()

    const tokenHash =
      'a'.repeat(64)

    const tokenExpiresAt =
      new Date(
        invitedAt.getTime()
        + 72 * 60 * 60 * 1000,
      )

    const result =
      await repository
        .createInvitedUserWithToken({
          username: 'student001',
          email:
            'student001@example.edu.vn',
          fullName: 'Nguyễn Văn A',
          targetRoles: ['STUDENT'],
          invitedAt,
          tokenHash,
          tokenExpiresAt,
          createdByUserId: actor.id,
        })

    const invitedUsers =
      await db
        .select({
          id: users.id,
          username: users.username,
          email: users.email,
          passwordHash:
            users.passwordHash,
          status: users.status,
          mustChangePassword:
            users.mustChangePassword,
          invitedAt: users.invitedAt,
          lastInvitationSentAt:
            users.lastInvitationSentAt,
          activatedAt:
            users.activatedAt,
        })
        .from(users)
        .where(
          eq(users.id, result.userId),
        )

    assert.deepEqual(
      invitedUsers[0],
      {
        id: result.userId,
        username: 'student001',
        email:
          'student001@example.edu.vn',
        passwordHash: null,
        status: 'INVITED',
        mustChangePassword: false,
        invitedAt,
        lastInvitationSentAt: null,
        activatedAt: null,
      },
    )

    const assignedRoles =
      await db
        .select({
          code: roles.code,
        })
        .from(userRoles)
        .innerJoin(
          roles,
          eq(
            userRoles.roleId,
            roles.id,
          ),
        )
        .where(
          eq(
            userRoles.userId,
            result.userId,
          ),
        )

    assert.deepEqual(
      assignedRoles,
      [
        {
          code: 'STUDENT',
        },
      ],
    )

    const storedTokens =
      await db
        .select({
          purpose:
            userActionTokens.purpose,
          tokenHash:
            userActionTokens.tokenHash,
          expiresAt:
            userActionTokens.expiresAt,
          createdAt:
            userActionTokens.createdAt,
          createdByUserId:
            userActionTokens
              .createdByUserId,
        })
        .from(userActionTokens)
        .where(
          eq(
            userActionTokens.userId,
            result.userId,
          ),
        )

    assert.deepEqual(
      storedTokens[0],
      {
        purpose:
          'ACCOUNT_ACTIVATION',
        tokenHash,
        expiresAt: tokenExpiresAt,
        createdAt: invitedAt,
        createdByUserId: actor.id,
      },
    )

    const sentAt =
      new Date(
        '2026-01-01T00:01:00.000Z',
      )

    await repository
      .markInvitationSent(
        result.userId,
        sentAt,
      )

    const updatedUsers =
      await db
        .select({
          lastInvitationSentAt:
            users.lastInvitationSentAt,
          updatedAt:
            users.updatedAt,
        })
        .from(users)
        .where(
          eq(users.id, result.userId),
        )

    assert.deepEqual(
      updatedUsers[0],
      {
        lastInvitationSentAt:
          sentAt,
        updatedAt: sentAt,
      },
    )
  },
)

test(
  'rollback user và role khi activation token vi phạm constraint',
  async () => {
    await createStudentRole()

    const actor =
      await createActor()

    const repository =
      new DrizzleUserInvitationRepository()

    const invalidTokenHash =
      'b'.repeat(64)

    const invalidExpiresAt =
      new Date(
        invitedAt.getTime()
        + 73 * 60 * 60 * 1000,
      )

    await assert.rejects(
      () =>
        repository
          .createInvitedUserWithToken({
            username: 'student002',
            email:
              'student002@example.edu.vn',
            fullName: 'Trần Văn B',
            targetRoles: ['STUDENT'],
            invitedAt,
            tokenHash:
              invalidTokenHash,
            tokenExpiresAt:
              invalidExpiresAt,
            createdByUserId:
              actor.id,
          }),
      (error: unknown) => {
        assert.ok(isRecord(error))

        const cause =
          error['cause']

        assert.ok(isRecord(cause))

        assert.equal(
          cause['code'],
          '23514',
        )

        assert.equal(
          cause['constraint_name'],
          'user_action_tokens_expiration_policy_check',
        )

        return true
      },
    )

    const rolledBackUsers =
      await db
        .select({
          id: users.id,
        })
        .from(users)
        .where(
          eq(
            users.username,
            'student002',
          ),
        )

    assert.deepEqual(
      rolledBackUsers,
      [],
    )

    const rolledBackTokens =
      await db
        .select({
          id: userActionTokens.id,
        })
        .from(userActionTokens)
        .where(
          eq(
            userActionTokens.tokenHash,
            invalidTokenHash,
          ),
        )

    assert.deepEqual(
      rolledBackTokens,
      [],
    )

    const roleAssignments =
      await db
        .select()
        .from(userRoles)

    assert.deepEqual(
      roleAssignments,
      [],
    )
  },
)