import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

import { users } from '../auth/auth.schema.js'

export const invitationDeliveryJobs = pgTable(
  'invitation_delivery_jobs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, {
        onDelete: 'cascade',
      }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    actorUsername: varchar('actor_username', {
      length: 100,
    }),
    status: varchar('status', {
      length: 20,
    })
      .notNull()
      .default('PENDING'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    nextAttemptAt: timestamp('next_attempt_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    lockedAt: timestamp('locked_at', {
      withTimezone: true,
    }),
    lockedBy: uuid('locked_by'),
    sentAt: timestamp('sent_at', {
      withTimezone: true,
    }),
    lastErrorCode: varchar('last_error_code', {
      length: 100,
    }),
    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('invitation_delivery_jobs_one_open_per_user_idx')
      .on(table.userId)
      .where(sql`${table.status} IN ('PENDING', 'PROCESSING')`),
    index('invitation_delivery_jobs_ready_idx').on(table.status, table.nextAttemptAt),
    index('invitation_delivery_jobs_locked_at_idx').on(table.lockedAt),
    check(
      'invitation_delivery_jobs_status_check',
      sql`${table.status} IN ('PENDING', 'PROCESSING', 'SENT', 'FAILED')`,
    ),
    check(
      'invitation_delivery_jobs_attempts_check',
      sql`${table.attempts} >= 0 AND ${table.maxAttempts} BETWEEN 1 AND 10 AND ${table.attempts} <= ${table.maxAttempts}`,
    ),
    check(
      'invitation_delivery_jobs_lock_state_check',
      sql`(${table.status} = 'PROCESSING' AND ${table.lockedAt} IS NOT NULL AND ${table.lockedBy} IS NOT NULL) OR (${table.status} <> 'PROCESSING' AND ${table.lockedAt} IS NULL AND ${table.lockedBy} IS NULL)`,
    ),
    check(
      'invitation_delivery_jobs_sent_state_check',
      sql`(${table.status} = 'SENT' AND ${table.sentAt} IS NOT NULL) OR (${table.status} <> 'SENT' AND ${table.sentAt} IS NULL)`,
    ),
  ],
)
