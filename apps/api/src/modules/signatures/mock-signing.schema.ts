import { pgTable, uuid, integer, jsonb, varchar, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { users } from '../auth/auth.schema.js'
import { submissionDocuments } from '../submissions/submission-document-registry.schema.js'
import type { MockSignatureReceipt, SignatureVerification } from './signature-provider.js'
export const mockSignatureReceipts = pgTable(
  'mock_signature_receipts',
  {
    id: uuid('id').primaryKey(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => submissionDocuments.id),
    actorUserId: uuid('actor_user_id')
      .notNull()
      .references(() => users.id),
    submissionRevision: integer('submission_revision').notNull(),
    receipt: jsonb('receipt').$type<MockSignatureReceipt>().notNull(),
    receiptSha256: varchar('receipt_sha256', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('mock_signature_receipts_document_id_key').on(t.documentId)],
)
export const mockSignatureChecks = pgTable('mock_signature_checks', {
  id: uuid('id').primaryKey(),
  receiptId: uuid('receipt_id')
    .notNull()
    .references(() => mockSignatureReceipts.id),
  actorUserId: uuid('actor_user_id')
    .notNull()
    .references(() => users.id),
  result: jsonb('result').$type<SignatureVerification>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
