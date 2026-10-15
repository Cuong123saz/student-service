import { sql } from 'drizzle-orm'
import {
  pgTable,
  uuid,
  varchar,
  integer,
  jsonb,
  timestamp,
  unique,
  index,
  check,
} from 'drizzle-orm/pg-core'
import { users } from '../auth/auth.schema.js'
import { academicClasses } from '../organizations/organization.schema.js'
import type { Answers, Criterion } from './training-points.types.js'
const time = (name: string) => timestamp(name, { withTimezone: true })
export const trainingPeriods = pgTable(
  'training_periods',
  {
    id: uuid('id').primaryKey(),
    classId: uuid('class_id')
      .notNull()
      .references(() => academicClasses.id),
    academicYear: varchar('academic_year', { length: 9 }).notNull(),
    semester: varchar('semester', { length: 6 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    policyLabel: varchar('policy_label', { length: 200 }).notNull(),
    startsAt: time('starts_at').notNull(),
    endsAt: time('ends_at').notNull(),
    status: varchar('status', { length: 10 }).notNull().default('DRAFT'),
    revision: integer('revision').notNull().default(1),
    criteria: jsonb('criteria').$type<Criterion[]>().notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    createdAt: time('created_at').notNull().defaultNow(),
    updatedAt: time('updated_at').notNull().defaultNow(),
  },
  (t) => [
    unique('training_periods_class_id_academic_year_semester_key').on(
      t.classId,
      t.academicYear,
      t.semester,
    ),
    check('training_periods_academic_year_check', sql`${t.academicYear} ~ '^[0-9]{4}-[0-9]{4}$'`),
    check('training_periods_semester_check', sql`${t.semester} IN ('1','2','SUMMER')`),
    check('training_periods_status_check', sql`${t.status} IN ('DRAFT','OPEN','CLOSED')`),
    check('training_periods_revision_check', sql`${t.revision}>0`),
    check('training_periods_criteria_check', sql`training_valid_criteria(${t.criteria}) IS TRUE`),
    check('training_periods_check', sql`${t.startsAt}<${t.endsAt}`),
  ],
)
export const trainingDeclarations = pgTable(
  'training_declarations',
  {
    id: uuid('id').primaryKey(),
    periodId: uuid('period_id')
      .notNull()
      .references(() => trainingPeriods.id),
    studentUserId: uuid('student_user_id')
      .notNull()
      .references(() => users.id),
    state: varchar('state', { length: 12 }).notNull().default('DRAFT'),
    revision: integer('revision').notNull().default(1),
    answers: jsonb('answers')
      .$type<Answers>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    studentSnapshot: jsonb('student_snapshot'),
    periodSnapshot: jsonb('period_snapshot'),
    evidenceSnapshot: jsonb('evidence_snapshot'),
    totalPoints: integer('total_points'),
    submitRequestId: uuid('submit_request_id').unique(),
    submittedAt: time('submitted_at'),
    createdAt: time('created_at').notNull().defaultNow(),
    updatedAt: time('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('training_review_period_queue')
      .on(t.periodId, t.id)
      .where(sql`${t.state}='SUBMITTED'`),
    unique('training_declarations_period_id_student_user_id_key').on(t.periodId, t.studentUserId),
    check('training_declarations_state_check', sql`${t.state} IN ('DRAFT','SUBMITTED')`),
    check('training_declarations_revision_check', sql`${t.revision}>0`),
    check('training_declarations_total_points_check', sql`${t.totalPoints} BETWEEN 0 AND 100`),
    check(
      'training_declarations_check',
      sql`(${t.state}='DRAFT' AND ${t.studentSnapshot} IS NULL AND ${t.periodSnapshot} IS NULL AND ${t.evidenceSnapshot} IS NULL AND ${t.totalPoints} IS NULL AND ${t.submitRequestId} IS NULL AND ${t.submittedAt} IS NULL) OR (${t.state}='SUBMITTED' AND ${t.studentSnapshot} IS NOT NULL AND ${t.periodSnapshot} IS NOT NULL AND ${t.evidenceSnapshot} IS NOT NULL AND ${t.totalPoints} IS NOT NULL AND ${t.submitRequestId} IS NOT NULL AND ${t.submittedAt} IS NOT NULL)`,
    ),
  ],
)
export const trainingEvidence = pgTable(
  'training_evidence',
  {
    id: uuid('id').primaryKey(),
    declarationId: uuid('declaration_id')
      .notNull()
      .references(() => trainingDeclarations.id),
    criterion: varchar('criterion', { length: 1 }).notNull(),
    storageKey: uuid('storage_key').notNull().unique(),
    name: varchar('name', { length: 200 }).notNull(),
    mimeType: varchar('mime_type', { length: 40 }).notNull(),
    size: integer('size').notNull(),
    sha256: varchar('sha256', { length: 64 }).notNull(),
    signatureStatus: varchar('signature_status', { length: 20 }).notNull().default('NOT_CHECKED'),
    inputRevision: integer('input_revision').notNull(),
    removedAt: time('removed_at'),
    createdAt: time('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('training_evidence_parent')
      .on(t.declarationId, t.id)
      .where(sql`${t.removedAt} IS NULL`),
    check('training_evidence_criterion_check', sql`${t.criterion} ~ '^[A-E]$'`),
    check(
      'training_evidence_mime_type_check',
      sql`${t.mimeType} IN ('application/pdf','image/png','image/jpeg')`,
    ),
    check('training_evidence_size_check', sql`${t.size} BETWEEN 1 AND 5242880`),
    check('training_evidence_sha256_check', sql`${t.sha256} ~ '^[a-f0-9]{64}$'`),
    check('training_evidence_signature_status_check', sql`${t.signatureStatus}='NOT_CHECKED'`),
    check('training_evidence_input_revision_check', sql`${t.inputRevision}>0`),
  ],
)
export const trainingEvents = pgTable(
  'training_events',
  {
    id: uuid('id').primaryKey(),
    declarationId: uuid('declaration_id')
      .notNull()
      .references(() => trainingDeclarations.id),
    actorUserId: uuid('actor_user_id')
      .notNull()
      .references(() => users.id),
    action: varchar('action', { length: 20 }).notNull(),
    revision: integer('revision').notNull(),
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: time('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('training_events_declaration_id_revision_key').on(t.declarationId, t.revision),
    check(
      'training_events_action_check',
      sql`${t.action} IN ('CREATED','SAVED','FILE_ADDED','FILE_REMOVED','SUBMITTED')`,
    ),
  ],
)
// SQL migration 0026 also defines lifecycle, owner eligibility, snapshot and append-only triggers.
