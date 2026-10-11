import { sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { submissionRounds } from './submission.schema.js'
import type { DeclarationTemplateBinding } from './submission-document-template.js'
export interface RendererProvenance {
  version: string
  buildSha256: string
  nodeVersion: string
  icuVersion: string
}
export interface ConverterProvenance {
  version: string
  binarySha256: string
}
export type RegistryFormat = 'DOCX' | 'PDF'
export const submissionDocumentSets = pgTable(
  'submission_document_sets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    submissionId: uuid('submission_id').notNull(),
    roundId: uuid('round_id').notNull(),
    kind: varchar('kind', { length: 30 }).$type<'DECLARATION'>().notNull(),
    template: jsonb('template').$type<DeclarationTemplateBinding>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.roundId, t.submissionId],
      foreignColumns: [submissionRounds.id, submissionRounds.submissionId],
      name: 'document_sets_round_fk',
    }).onDelete('restrict'),
    uniqueIndex('document_sets_round_kind_unique').on(t.roundId, t.kind),
    check('document_sets_kind_check', sql`${t.kind} = 'DECLARATION'`),
  ],
)
export const submissionDocuments = pgTable(
  'submission_documents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    setId: uuid('set_id')
      .notNull()
      .references(() => submissionDocumentSets.id, { onDelete: 'restrict' }),
    format: varchar('format', { length: 4 }).$type<RegistryFormat>().notNull(),
    storageKey: uuid('storage_key').notNull(),
    attemptId: uuid('attempt_id').notNull(),
    size: integer('size').notNull(),
    sha256: varchar('sha256', { length: 64 }).notNull(),
    template: jsonb('template').$type<DeclarationTemplateBinding>().notNull(),
    renderer: jsonb('renderer').$type<RendererProvenance>().notNull(),
    converter: jsonb('converter').$type<ConverterProvenance>(),
    sourceDocxSha256: varchar('source_docx_sha256', { length: 64 }),
    status: varchar('status', { length: 30 }).$type<'UNSIGNED_DECLARATION'>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('documents_set_format_unique').on(t.setId, t.format),
    uniqueIndex('documents_storage_unique').on(t.storageKey),
    uniqueIndex('documents_job_reference_unique').on(t.id, t.setId, t.format),
    check(
      'documents_shape_check',
      sql`(${t.format} IN ('DOCX','PDF') AND ${t.size} BETWEEN 1 AND 16777216
    AND ${t.sha256} ~ '^[a-f0-9]{64}$' AND ${t.storageKey} = ${t.attemptId} AND ${t.status} = 'UNSIGNED_DECLARATION'
    AND jsonb_typeof(${t.renderer}) = 'object' AND ${t.renderer} ?& ARRAY['version','buildSha256','nodeVersion','icuVersion']
    AND ${t.renderer} - 'version' - 'buildSha256' - 'nodeVersion' - 'icuVersion' = '{}'::jsonb
    AND jsonb_typeof(${t.renderer}->'version') = 'string' AND char_length(${t.renderer}->>'version') BETWEEN 1 AND 200
    AND jsonb_typeof(${t.renderer}->'buildSha256') = 'string' AND (${t.renderer}->>'buildSha256') ~ '^[a-f0-9]{64}$'
    AND jsonb_typeof(${t.renderer}->'nodeVersion') = 'string' AND char_length(${t.renderer}->>'nodeVersion') BETWEEN 1 AND 40
    AND jsonb_typeof(${t.renderer}->'icuVersion') = 'string' AND char_length(${t.renderer}->>'icuVersion') BETWEEN 1 AND 40
    AND ((${t.format} = 'DOCX' AND ${t.converter} IS NULL AND ${t.sourceDocxSha256} IS NULL) OR
    (${t.format} = 'PDF' AND ${t.sourceDocxSha256} ~ '^[a-f0-9]{64}$' AND ${t.converter} IS NOT NULL
      AND jsonb_typeof(${t.converter}) = 'object' AND ${t.converter} ?& ARRAY['version','binarySha256']
      AND ${t.converter} - 'version' - 'binarySha256' = '{}'::jsonb AND jsonb_typeof(${t.converter}->'version') = 'string'
      AND char_length(${t.converter}->>'version') BETWEEN 1 AND 200 AND jsonb_typeof(${t.converter}->'binarySha256') = 'string'
      AND (${t.converter}->>'binarySha256') ~ '^[a-f0-9]{64}$'))) IS TRUE`,
    ),
  ],
)
export const submissionDocumentJobs = pgTable(
  'submission_document_jobs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    setId: uuid('set_id')
      .notNull()
      .references(() => submissionDocumentSets.id, { onDelete: 'restrict' }),
    format: varchar('format', { length: 4 }).$type<RegistryFormat>().notNull(),
    state: varchar('state', { length: 10 })
      .$type<'PENDING' | 'RUNNING' | 'RETRYABLE' | 'COMPLETE'>()
      .notNull()
      .default('PENDING'),
    attempts: integer('attempts').notNull().default(0),
    attemptId: uuid('attempt_id'),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    errorCode: varchar('error_code', { length: 30 }),
    publishedDocumentId: uuid('published_document_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('document_jobs_set_format_unique').on(t.setId, t.format),
    foreignKey({
      columns: [t.publishedDocumentId, t.setId, t.format],
      foreignColumns: [
        submissionDocuments.id,
        submissionDocuments.setId,
        submissionDocuments.format,
      ],
      name: 'document_jobs_published_fk',
    }).onDelete('restrict'),
    check(
      'document_jobs_shape_check',
      sql`(${t.format} IN ('DOCX','PDF') AND ${t.attempts} BETWEEN 0 AND 3 AND (
    (${t.state} = 'PENDING' AND ${t.attempts} = 0 AND ${t.attemptId} IS NULL AND ${t.leaseUntil} IS NULL AND ${t.errorCode} IS NULL AND ${t.publishedDocumentId} IS NULL) OR
    (${t.state} = 'RUNNING' AND ${t.attempts} > 0 AND ${t.attemptId} IS NOT NULL AND ${t.leaseUntil} IS NOT NULL AND ${t.errorCode} IS NULL AND ${t.publishedDocumentId} IS NULL) OR
    (${t.state} = 'RETRYABLE' AND ${t.attempts} > 0 AND ${t.attemptId} IS NOT NULL AND ${t.leaseUntil} IS NULL AND ${t.publishedDocumentId} IS NULL AND ${t.errorCode} IN ('RENDER_FAILED','CONVERT_FAILED','STORAGE_FAILED','LEASE_EXPIRED')) OR
    (${t.state} = 'COMPLETE' AND ${t.attempts} > 0 AND ${t.attemptId} IS NOT NULL AND ${t.leaseUntil} IS NULL AND ${t.errorCode} IS NULL AND ${t.publishedDocumentId} IS NOT NULL))) IS TRUE`,
    ),
  ],
)
