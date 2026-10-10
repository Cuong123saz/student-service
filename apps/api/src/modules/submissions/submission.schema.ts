import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  foreignKey,
  text,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { services } from '../../db/schema.js'
import { users } from '../auth/auth.schema.js'
import { organizationalUnits } from '../organizations/organization.schema.js'
import { procedureVersions } from '../procedures/procedure.schema.js'
import type { PublicProcedure } from '../procedures/procedure.contract.js'
import type {
  DraftValues,
  StudentSnapshot,
  SubmissionStatus,
  RoundEvidence,
  SubmissionEventAction,
} from './submission.types.js'
export const submissions = pgTable(
  'submissions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    studentUserId: uuid('student_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    serviceId: integer('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'restrict' }),
    procedureVersionId: uuid('procedure_version_id')
      .notNull()
      .references(() => procedureVersions.id, { onDelete: 'restrict' }),
    serviceName: varchar('service_name', { length: 255 }).notNull(),
    status: varchar('status', { length: 20 }).$type<SubmissionStatus>().notNull().default('DRAFT'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    roundNumber: integer('round_number').notNull().default(0),
    lastSubmittedAt: timestamp('last_submitted_at', { withTimezone: true }),
    decisionAt: timestamp('decision_at', { withTimezone: true }),
    processingUnitId: uuid('processing_unit_id').references(() => organizationalUnits.id, {
      onDelete: 'restrict',
    }),
    designatedReviewerId: uuid('designated_reviewer_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
    studentSnapshot: jsonb('student_snapshot').$type<StudentSnapshot>(),
    reviewerUserId: uuid('reviewer_user_id').references(() => users.id, { onDelete: 'restrict' }),
    reviewStartedAt: timestamp('review_started_at', { withTimezone: true }),
    revision: integer('revision').notNull().default(1),
    procedure: jsonb('procedure').$type<PublicProcedure>().notNull(),
    values: jsonb('values').$type<DraftValues>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('submissions_student_version_unique').on(
      table.studentUserId,
      table.procedureVersionId,
    ),
    index('submissions_student_updated_idx').on(table.studentUserId, table.updatedAt),
    index('submissions_intake_idx').on(table.processingUnitId, table.submittedAt),
    check(
      'submissions_state_check',
      sql`
      ${table.revision} > 0 AND (
        (${table.status} = 'DRAFT' AND ${table.roundNumber} = 0 AND ${table.lastSubmittedAt} IS NULL AND ${table.decisionAt} IS NULL AND ${table.submittedAt} IS NULL AND ${table.processingUnitId} IS NULL AND ${table.designatedReviewerId} IS NULL AND ${table.studentSnapshot} IS NULL AND ${table.reviewerUserId} IS NULL AND ${table.reviewStartedAt} IS NULL)
        OR
        (${table.status} = 'SUBMITTED' AND ${table.roundNumber} > 0 AND ${table.lastSubmittedAt} IS NOT NULL AND ${table.decisionAt} IS NULL AND ${table.submittedAt} IS NOT NULL AND ${table.processingUnitId} IS NOT NULL AND ${table.studentSnapshot} IS NOT NULL AND ${table.reviewerUserId} IS NULL AND ${table.reviewStartedAt} IS NULL)
        OR
        (${table.status} IN ('IN_REVIEW', 'NEEDS_SUPPLEMENT', 'APPROVED', 'REJECTED') AND ${table.roundNumber} > 0 AND ${table.lastSubmittedAt} IS NOT NULL AND ${table.submittedAt} IS NOT NULL AND ${table.processingUnitId} IS NOT NULL AND ${table.studentSnapshot} IS NOT NULL AND ${table.reviewerUserId} IS NOT NULL AND ${table.reviewerUserId} <> ${table.studentUserId} AND ${table.reviewStartedAt} IS NOT NULL AND ((${table.status} IN ('APPROVED','REJECTED') AND ${table.decisionAt} IS NOT NULL) OR (${table.status} IN ('IN_REVIEW','NEEDS_SUPPLEMENT') AND ${table.decisionAt} IS NULL)))
      )`,
    ),
    check(
      'submissions_student_snapshot_check',
      sql`${table.studentSnapshot} IS NULL OR jsonb_typeof(${table.studentSnapshot}) = 'object'`,
    ),
    check(
      'submissions_json_check',
      sql`jsonb_typeof(${table.procedure}) = 'object' AND jsonb_typeof(${table.values}) = 'object'`,
    ),
  ],
)
export const submissionFiles = pgTable(
  'submission_files',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    submissionId: uuid('submission_id')
      .notNull()
      .references(() => submissions.id, { onDelete: 'restrict' }),
    attachmentKey: varchar('attachment_key', { length: 64 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    mimeType: varchar('mime_type', { length: 100 }).notNull(),
    size: integer('size').notNull(),
    sha256: varchar('sha256', { length: 64 }).notNull(),
    storageKey: uuid('storage_key').notNull().unique(),
    signatureStatus: varchar('signature_status', { length: 20 })
      .$type<'NOT_CHECKED'>()
      .notNull()
      .default('NOT_CHECKED'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    removedAt: timestamp('removed_at', { withTimezone: true }),
  },
  (table) => [
    index('submission_files_draft_idx').on(table.submissionId),
    check(
      'submission_files_limits_check',
      sql`${table.size} > 0 AND ${table.size} <= 5242880 AND ${table.signatureStatus} = 'NOT_CHECKED'`,
    ),
    check(
      'submission_files_format_check',
      sql`${table.mimeType} IN ('application/pdf', 'image/png', 'image/jpeg') AND ${table.sha256} ~ '^[a-f0-9]{64}$'`,
    ),
  ],
)

export const submissionRounds = pgTable(
  'submission_rounds',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    submissionId: uuid('submission_id')
      .notNull()
      .references(() => submissions.id, { onDelete: 'restrict' }),
    roundNumber: integer('round_number').notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull(),
    studentSnapshot: jsonb('student_snapshot').$type<StudentSnapshot>().notNull(),
    values: jsonb('values').$type<DraftValues>().notNull(),
    files: jsonb('files').$type<RoundEvidence[]>().notNull(),
    source: varchar('source', { length: 20 }).$type<'LIVE' | 'MIGRATION'>().notNull(),
  },
  (table) => [
    uniqueIndex('submission_rounds_number_unique').on(table.submissionId, table.roundNumber),
    uniqueIndex('submission_rounds_id_submission_unique').on(table.id, table.submissionId),
    check(
      'submission_rounds_shape_check',
      sql`${table.roundNumber} > 0 AND ${table.source} IN ('LIVE','MIGRATION') AND jsonb_typeof(${table.values}) = 'object' AND jsonb_typeof(${table.studentSnapshot}) = 'object' AND jsonb_typeof(${table.files}) = 'array'`,
    ),
  ],
)
export const submissionEvents = pgTable(
  'submission_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    submissionId: uuid('submission_id')
      .notNull()
      .references(() => submissions.id, { onDelete: 'restrict' }),
    roundId: uuid('round_id').notNull(),
    action: varchar('action', { length: 30 }).$type<SubmissionEventAction>().notNull(),
    actorUserId: uuid('actor_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    actorName: varchar('actor_name', { length: 255 }).notNull(),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    fromRevision: integer('from_revision').notNull(),
    toRevision: integer('to_revision').notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.roundId, table.submissionId],
      foreignColumns: [submissionRounds.id, submissionRounds.submissionId],
      name: 'submission_events_round_submission_fk',
    }).onDelete('restrict'),
    uniqueIndex('submission_events_revision_unique').on(table.submissionId, table.fromRevision),
    check(
      'submission_events_shape_check',
      sql`${table.fromRevision} > 0 AND ${table.toRevision} = ${table.fromRevision} + 1 AND ${table.action} IN ('SUBMITTED','CLAIMED','SUPPLEMENT_REQUESTED','RESUBMITTED','APPROVED','REJECTED') AND ((${table.action} IN ('SUPPLEMENT_REQUESTED','APPROVED','REJECTED') AND ${table.note} IS NOT NULL AND char_length(btrim(${table.note})) BETWEEN 1 AND 2000) OR (${table.action} IN ('SUBMITTED','CLAIMED','RESUBMITTED') AND ${table.note} IS NULL))`,
    ),
  ],
)
