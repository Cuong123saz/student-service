import { sql } from 'drizzle-orm'
import {
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

import { users } from '../auth/auth.schema.js'

const bytea = customType<{
  data: Buffer
  driverData: Buffer
}>({
  dataType() {
    return 'bytea'
  },
})

export const studentImportFiles = pgTable(
  'student_import_files',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    actorUserId: uuid('actor_user_id')
      .notNull()
      .references(() => users.id, {
        onDelete: 'cascade',
      }),
    originalFileName: varchar('original_file_name', {
      length: 255,
    }).notNull(),
    mediaType: varchar('media_type', {
      length: 100,
    }).notNull(),
    byteSize: integer('byte_size').notNull(),
    sha256: varchar('sha256', {
      length: 64,
    }).notNull(),
    content: bytea('content').notNull(),
    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', {
      withTimezone: true,
    }).notNull(),
  },
  (table) => [
    index('student_import_files_expires_at_idx').on(table.expiresAt),
    check('student_import_files_byte_size_check', sql`${table.byteSize} BETWEEN 1 AND 5242880`),
    check('student_import_files_sha256_check', sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
  ],
)

export const studentImportPreviews = pgTable(
  'student_import_previews',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sourceJobId: uuid('source_job_id').notNull(),
    actorUserId: uuid('actor_user_id')
      .notNull()
      .references(() => users.id, {
        onDelete: 'cascade',
      }),
    fileName: varchar('file_name', {
      length: 255,
    }).notNull(),
    payload: jsonb('payload').notNull(),
    status: varchar('status', {
      length: 20,
    })
      .notNull()
      .default('PENDING'),
    lockedAt: timestamp('locked_at', {
      withTimezone: true,
    }),
    lockedBy: uuid('locked_by'),
    consumedAt: timestamp('consumed_at', {
      withTimezone: true,
    }),
    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', {
      withTimezone: true,
    }).notNull(),
  },
  (table) => [
    uniqueIndex('student_import_previews_source_job_unique').on(table.sourceJobId),
    index('student_import_previews_expires_at_idx').on(table.expiresAt),
    index('student_import_previews_locked_at_idx').on(table.lockedAt),
    check(
      'student_import_previews_status_check',
      sql`${table.status} IN ('PENDING', 'PROCESSING', 'CONSUMED')`,
    ),
    check(
      'student_import_previews_lock_state_check',
      sql`(${table.status} = 'PROCESSING' AND ${table.lockedAt} IS NOT NULL AND ${table.lockedBy} IS NOT NULL AND ${table.consumedAt} IS NULL) OR (${table.status} = 'PENDING' AND ${table.lockedAt} IS NULL AND ${table.lockedBy} IS NULL AND ${table.consumedAt} IS NULL) OR (${table.status} = 'CONSUMED' AND ${table.lockedAt} IS NULL AND ${table.lockedBy} IS NULL AND ${table.consumedAt} IS NOT NULL)`,
    ),
  ],
)

export const studentImportProcessingJobs = pgTable(
  'student_import_processing_jobs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    fileId: uuid('file_id')
      .notNull()
      .references(() => studentImportFiles.id, {
        onDelete: 'cascade',
      }),
    actorUserId: uuid('actor_user_id')
      .notNull()
      .references(() => users.id, {
        onDelete: 'cascade',
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
    previewId: uuid('preview_id').references(() => studentImportPreviews.id, {
      onDelete: 'set null',
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
    uniqueIndex('student_import_processing_jobs_file_unique').on(table.fileId),
    index('student_import_processing_jobs_ready_idx').on(table.status, table.nextAttemptAt),
    index('student_import_processing_jobs_locked_at_idx').on(table.lockedAt),
    check(
      'student_import_processing_jobs_status_check',
      sql`${table.status} IN ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED')`,
    ),
    check(
      'student_import_processing_jobs_attempts_check',
      sql`${table.attempts} >= 0 AND ${table.maxAttempts} BETWEEN 1 AND 10 AND ${table.attempts} <= ${table.maxAttempts}`,
    ),
    check(
      'student_import_processing_jobs_lock_state_check',
      sql`(${table.status} = 'PROCESSING' AND ${table.lockedAt} IS NOT NULL AND ${table.lockedBy} IS NOT NULL) OR (${table.status} <> 'PROCESSING' AND ${table.lockedAt} IS NULL AND ${table.lockedBy} IS NULL)`,
    ),
    check(
      'student_import_processing_jobs_result_state_check',
      sql`(${table.status} = 'SUCCEEDED' AND ${table.previewId} IS NOT NULL AND ${table.lastErrorCode} IS NULL) OR (${table.status} = 'FAILED' AND ${table.previewId} IS NULL AND ${table.lastErrorCode} IS NOT NULL) OR (${table.status} IN ('PENDING', 'PROCESSING') AND ${table.previewId} IS NULL)`,
    ),
  ],
)
