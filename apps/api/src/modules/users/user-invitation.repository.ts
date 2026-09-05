import {
  eq,
  inArray,
} from 'drizzle-orm'

import {
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

import type {
  PersistInvitationInput,
  UserInvitationRepository,
} from './user-invitation.service.js'

export class InvitationRolesNotFoundError
extends Error {
  constructor(
    readonly missingRoles:
      readonly string[],
  ) {
    super(
      `Roles not found: ${
        missingRoles.join(', ')
      }`,
    )

    this.name =
      'InvitationRolesNotFoundError'
  }
}

export class InvitedUserNotFoundError
extends Error {
  constructor() {
    super('Invited user not found')

    this.name =
      'InvitedUserNotFoundError'
  }
}

export class DrizzleUserInvitationRepository
implements UserInvitationRepository {
  constructor(
    private readonly database:
      typeof db = db,
  ) {}

  async createInvitedUserWithToken(
    input: PersistInvitationInput,
  ): Promise<{
    userId: string
  }> {
    return this.database.transaction(
      async (transaction) => {
        const requestedRoles = [
          ...new Set(input.targetRoles),
        ]

        const roleRows =
          await transaction
            .select({
              id: roles.id,
              code: roles.code,
            })
            .from(roles)
            .where(
              inArray(
                roles.code,
                requestedRoles,
              ),
            )

        const foundRoleCodes =
          new Set(
            roleRows.map(
              (role) => role.code,
            ),
          )

        const missingRoles =
          requestedRoles.filter(
            (role) =>
              !foundRoleCodes.has(role),
          )

        if (missingRoles.length > 0) {
          throw new InvitationRolesNotFoundError(
            missingRoles,
          )
        }

        const insertedUsers =
          await transaction
            .insert(users)
            .values({
              username: input.username,
              email: input.email,
              fullName: input.fullName,
              passwordHash: null,
              status: 'INVITED',
              mustChangePassword: false,
              invitedAt: input.invitedAt,
              lastInvitationSentAt: null,
              activatedAt: null,
              createdAt: input.invitedAt,
              updatedAt: input.invitedAt,
            })
            .returning({
              id: users.id,
            })

        const insertedUser =
          insertedUsers[0]

        if (!insertedUser) {
          throw new Error(
            'Failed to create invited user',
          )
        }

        await transaction
          .insert(userRoles)
          .values(
            roleRows.map((role) => ({
              userId: insertedUser.id,
              roleId: role.id,
              assignedAt:
                input.invitedAt,
            })),
          )

        await transaction
          .insert(userActionTokens)
          .values({
            userId: insertedUser.id,
            purpose:
              'ACCOUNT_ACTIVATION',
            tokenHash:
              input.tokenHash,
            expiresAt:
              input.tokenExpiresAt,
            createdByUserId:
              input.createdByUserId,
            createdAt:
              input.invitedAt,
          })

        return {
          userId: insertedUser.id,
        }
      },
    )
  }

  async markInvitationSent(
    userId: string,
    sentAt: Date,
  ): Promise<void> {
    const updatedUsers =
      await this.database
        .update(users)
        .set({
          lastInvitationSentAt:
            sentAt,
          updatedAt: sentAt,
        })
        .where(
          eq(users.id, userId),
        )
        .returning({
          id: users.id,
        })

    if (!updatedUsers[0]) {
      throw new InvitedUserNotFoundError()
    }
  }
}