import {
  sql,
} from 'drizzle-orm'
import {
  check,
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

import {
  users,
} from '../auth/auth.schema.js'

export const userActionTokens =
  pgTable(
    'user_action_tokens',
    {
      id: uuid('id')
        .defaultRandom()
        .primaryKey(),

      userId: uuid('user_id')
        .notNull()
        .references(
          () => users.id,
          {
            onDelete: 'cascade',
          },
        ),

      purpose: varchar('purpose', {
        length: 32,
      }).notNull(),

      tokenHash: varchar(
        'token_hash',
        {
          length: 64,
        },
      ).notNull(),

      expiresAt: timestamp(
        'expires_at',
        {
          withTimezone: true,
        },
      ).notNull(),

      consumedAt: timestamp(
        'consumed_at',
        {
          withTimezone: true,
        },
      ),

      revokedAt: timestamp(
        'revoked_at',
        {
          withTimezone: true,
        },
      ),

      createdByUserId: uuid(
        'created_by_user_id',
      ).references(
        () => users.id,
        {
          onDelete: 'set null',
        },
      ),

      createdAt: timestamp(
        'created_at',
        {
          withTimezone: true,
        },
      )
        .notNull()
        .defaultNow(),
    },
    (table) => [
      uniqueIndex(
        'user_action_tokens_token_hash_idx',
      ).on(table.tokenHash),

      uniqueIndex(
        'user_action_tokens_one_open_idx',
      )
        .on(
          table.userId,
          table.purpose,
        )
        .where(
          sql`
            ${table.consumedAt} IS NULL
            AND ${table.revokedAt} IS NULL
          `,
        ),

      index(
        'user_action_tokens_expires_at_idx',
      ).on(table.expiresAt),

      index(
        'user_action_tokens_created_by_idx',
      ).on(table.createdByUserId),

      check(
        'user_action_tokens_purpose_check',
        sql`
          ${table.purpose} IN (
            'ACCOUNT_ACTIVATION',
            'PASSWORD_RESET'
          )
        `,
      ),
   check(
  'user_action_tokens_expiration_policy_check',
  sql`
    ${table.expiresAt}
      > ${table.createdAt}

    AND (
      ${table.purpose}
        <> 'ACCOUNT_ACTIVATION'
      OR
      ${table.expiresAt}
        <= ${table.createdAt}
          + INTERVAL '72 hours'
    )

    AND (
      ${table.purpose}
        <> 'PASSWORD_RESET'
      OR
      ${table.expiresAt}
        <= ${table.createdAt}
          + INTERVAL '30 minutes'
    )
  `,
),

      check(
        'user_action_tokens_terminal_state_check',
        sql`
          NOT (
            ${table.consumedAt} IS NOT NULL
            AND ${table.revokedAt} IS NOT NULL
          )
        `,
      ),
    ],
  )