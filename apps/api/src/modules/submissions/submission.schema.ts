import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { services } from '../../db/schema.js'
import { users } from '../auth/auth.schema.js'
import { procedureVersions } from '../procedures/procedure.schema.js'
import type { PublicProcedure } from '../procedures/procedure.contract.js'
import type { DraftValues } from './submission.types.js'
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
    status: varchar('status', { length: 20 }).$type<'DRAFT'>().notNull().default('DRAFT'),
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
    check('submissions_draft_check', sql`${table.status} = 'DRAFT' AND ${table.revision} > 0`),
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
