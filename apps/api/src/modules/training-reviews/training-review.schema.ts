import { sql } from 'drizzle-orm'
import {
  pgTable,
  uuid,
  integer,
  varchar,
  jsonb,
  timestamp,
  unique,
  index,
  check,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import { users } from '../auth/auth.schema.js'
import { trainingDeclarations } from '../training-points/training-points.schema.js'
export const trainingReviewDecisions = pgTable(
  'training_review_decisions',
  {
    id: uuid('id').primaryKey(),
    declarationId: uuid('declaration_id')
      .notNull()
      .references(() => trainingDeclarations.id),
    revision: integer('revision').notNull(),
    action: varchar('action', { length: 20 }).notNull(),
    actorUserId: uuid('actor_user_id')
      .notNull()
      .references(() => users.id),
    actorSnapshot: jsonb('actor_snapshot').notNull(),
    assessedAnswers: jsonb('assessed_answers').notNull(),
    totalPoints: integer('total_points').notNull(),
    comment: varchar('comment', { length: 2000 }).notNull(),
    declarationSha256: varchar('declaration_sha256', { length: 64 }).notNull(),
    parentDecisionId: uuid('parent_decision_id').references(
      (): AnyPgColumn => trainingReviewDecisions.id,
    ),
    requestId: uuid('request_id').notNull().unique(),
    inputRevision: integer('input_revision').notNull(),
    payload: jsonb('payload').notNull(),
    payloadSha256: varchar('payload_sha256', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [
    unique('training_review_decisions_declaration_id_revision_key').on(t.declarationId, t.revision),
    index('training_review_latest').on(t.declarationId, t.revision.desc()),
    check(
      'training_review_decisions_action_check',
      sql`${t.action} IN ('ADVISOR_SIGNED','FACULTY_RETURNED','FACULTY_APPROVED')`,
    ),
    check('training_review_decisions_total_points_check', sql`${t.totalPoints} BETWEEN 0 AND 100`),
    check('training_review_decisions_revision_check', sql`${t.revision}>0`),
    check('training_review_decisions_input_revision_check', sql`${t.inputRevision}>=0`),
    check(
      'training_review_decisions_comment_check',
      sql`char_length(btrim(${t.comment})) BETWEEN 1 AND 2000`,
    ),
    check(
      'training_review_decisions_declaration_sha256_check',
      sql`${t.declarationSha256} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      'training_review_decisions_payload_sha256_check',
      sql`${t.payloadSha256} ~ '^[a-f0-9]{64}$'`,
    ),
  ],
)
