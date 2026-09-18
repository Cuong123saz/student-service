import { sql } from 'drizzle-orm'
import { check, index, jsonb, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'

import type { AuditActorType, AuditMetadata, AuditOutcome, AuditState } from './audit.types.js'

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    occurredAt: timestamp('occurred_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),

    actorType: varchar('actor_type', {
      length: 20,
    })
      .$type<AuditActorType>()
      .notNull(),

    // Deliberately not a foreign key: audit history must survive account removal.
    actorUserId: uuid('actor_user_id'),

    actorUsername: varchar('actor_username', {
      length: 100,
    }),

    action: varchar('action', {
      length: 100,
    }).notNull(),

    resourceType: varchar('resource_type', {
      length: 100,
    }).notNull(),

    resourceId: varchar('resource_id', {
      length: 100,
    }),

    outcome: varchar('outcome', {
      length: 20,
    })
      .$type<AuditOutcome>()
      .notNull(),

    requestId: varchar('request_id', {
      length: 100,
    }),

    ipAddress: varchar('ip_address', {
      length: 45,
    }),

    userAgent: varchar('user_agent', {
      length: 512,
    }),

    metadata: jsonb('metadata')
      .$type<AuditMetadata>()
      .notNull()
      .default(sql`'{}'::jsonb`),

    // Additive nullable snapshots: existing authentication events keep using
    // metadata, while state-changing events can record safe before/after data.
    // Never place passwords, hashes, cookies or raw action tokens here.
    before: jsonb('before').$type<AuditState>(),

    after: jsonb('after').$type<AuditState>(),
  },
  (table) => [
    index('audit_logs_occurred_at_idx').on(table.occurredAt),

    index('audit_logs_actor_user_id_occurred_at_idx').on(table.actorUserId, table.occurredAt),

    index('audit_logs_action_occurred_at_idx').on(table.action, table.occurredAt),

    check(
      'audit_logs_actor_type_check',
      sql`${table.actorType} IN ('USER', 'ANONYMOUS', 'SYSTEM')`,
    ),

    check('audit_logs_outcome_check', sql`${table.outcome} IN ('SUCCESS', 'FAILURE')`),

    check(
      'audit_logs_actor_identity_check',
      sql`(${table.actorType} = 'USER' AND ${table.actorUserId} IS NOT NULL) OR (${table.actorType} <> 'USER' AND ${table.actorUserId} IS NULL)`,
    ),
  ],
)
