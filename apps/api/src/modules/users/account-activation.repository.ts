import {
  and,
  eq,
  gt,
  isNull,
} from 'drizzle-orm'

import {
  db,
} from '../../db/client.js'

import {
  users,
} from '../auth/auth.schema.js'

import {
  userActionTokens,
} from './user-account.schema.js'

import type {
  AccountActivationRepository,
  CompleteActivationInput,
} from './account-activation.service.js'

type ActivationCasFailureReason =
  | 'TOKEN_STATE_CHANGED'
  | 'USER_STATE_CONFLICT'

export interface ActivationRepositoryLogger {
  warn(
    context: {
      event:
        'ACTIVATION_USER_STATE_CONFLICT'
      tokenId: string
      userId: string
    },
    message: string,
  ): void
}

class ActivationCompareAndSetFailedError
extends Error {
  constructor(
    readonly reason:
      ActivationCasFailureReason,
  ) {
    super(
      'Activation compare-and-set failed',
    )

    this.name =
      'ActivationCompareAndSetFailedError'
  }
}

export class DrizzleAccountActivationRepository
implements AccountActivationRepository {
  constructor(
    private readonly logger:
      ActivationRepositoryLogger,

    private readonly database:
      typeof db = db,
  ) {}

/**
 * Pre-check rẻ để tránh chạy argon2 cho token rõ ràng không hợp lệ.
 * KHÔNG phải nguồn sự thật cuối cùng — completeActivation() tự
 * re-check toàn bộ điều kiện này một lần nữa qua compare-and-set
 * atomic trong transaction, vì trạng thái có thể đổi giữa 2 lệnh gọi.
 */
  async findUsableActivationToken(
    tokenHash: string,
    now: Date,
  ) {
    const rows =
      await this.database
        .select({
          tokenId:
            userActionTokens.id,
          userId:
            userActionTokens.userId,
        })
        .from(userActionTokens)
        .innerJoin(
          users,
          eq(
            userActionTokens.userId,
            users.id,
          ),
        )
        .where(
          and(
            eq(
              userActionTokens.tokenHash,
              tokenHash,
            ),

            eq(
              userActionTokens.purpose,
              'ACCOUNT_ACTIVATION',
            ),

            isNull(
              userActionTokens.consumedAt,
            ),

            isNull(
              userActionTokens.revokedAt,
            ),

            gt(
              userActionTokens.expiresAt,
              now,
            ),

            eq(
              users.status,
              'INVITED',
            ),

            isNull(
              users.passwordHash,
            ),

            isNull(
              users.activatedAt,
            ),
          ),
        )
        .limit(1)

    return rows[0] ?? null
  }

  async completeActivation(
    input: CompleteActivationInput,
  ): Promise<boolean> {
    try {
      await this.database.transaction(
        async (transaction) => {
          const consumedTokens =
            await transaction
              .update(userActionTokens)
              .set({
                consumedAt:
                  input.activatedAt,
              })
              .where(
                and(
                  eq(
                    userActionTokens.id,
                    input.tokenId,
                  ),

                  eq(
                    userActionTokens.userId,
                    input.userId,
                  ),

                  eq(
                    userActionTokens.tokenHash,
                    input.tokenHash,
                  ),

                  eq(
                    userActionTokens.purpose,
                    'ACCOUNT_ACTIVATION',
                  ),

                  isNull(
                    userActionTokens.consumedAt,
                  ),

                  isNull(
                    userActionTokens.revokedAt,
                  ),

                  gt(
                    userActionTokens.expiresAt,
                    input.activatedAt,
                  ),
                ),
              )
              .returning({
                id: userActionTokens.id,
              })

          if (!consumedTokens[0]) {
            throw new ActivationCompareAndSetFailedError(
              'TOKEN_STATE_CHANGED',
            )
          }

          const activatedUsers =
            await transaction
              .update(users)
              .set({
                passwordHash:
                  input.passwordHash,

                status: 'ACTIVE',

                mustChangePassword:
                  false,

                activatedAt:
                  input.activatedAt,

                updatedAt:
                  input.activatedAt,
              })
              .where(
                and(
                  eq(
                    users.id,
                    input.userId,
                  ),

                  eq(
                    users.status,
                    'INVITED',
                  ),

                  isNull(
                    users.passwordHash,
                  ),

                  isNull(
                    users.activatedAt,
                  ),
                ),
              )
              .returning({
                id: users.id,
              })

          if (!activatedUsers[0]) {
            // Throw để rollback cả consumedAt
            // vừa ghi ở phía trên.
            throw new ActivationCompareAndSetFailedError(
              'USER_STATE_CONFLICT',
            )
          }
        },
      )

      return true
    } catch (error: unknown) {
      if (
        error
        instanceof ActivationCompareAndSetFailedError
      ) {
        if (
          error.reason
            === 'USER_STATE_CONFLICT'
        ) {
          this.logger.warn(
            {
              event:
                'ACTIVATION_USER_STATE_CONFLICT',

              tokenId:
                input.tokenId,

              userId:
                input.userId,
            },
            'Activation token was claimable but user was not activatable',
          )
        }

        return false
      }

      throw error
    }
  }
}
