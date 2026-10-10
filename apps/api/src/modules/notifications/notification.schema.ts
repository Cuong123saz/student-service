import {
  foreignKey,
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  check,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { users } from '../auth/auth.schema.js'
import { submissions, submissionEvents } from '../submissions/submission.schema.js'
export const personalNotifications = pgTable(
  'personal_notifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    recipientUserId: uuid('recipient_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    recipientKind: varchar('recipient_kind', { length: 20 })
      .$type<'OWNER' | 'REVIEWER'>()
      .notNull(),
    submissionId: uuid('submission_id')
      .notNull()
      .references(() => submissions.id, { onDelete: 'restrict' }),
    eventId: uuid('event_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      columns: [table.eventId, table.submissionId],
      foreignColumns: [submissionEvents.id, submissionEvents.submissionId],
      name: 'personal_notifications_event_submission_fk',
    }).onDelete('restrict'),
    uniqueIndex('personal_notifications_event_recipient_unique').on(
      table.eventId,
      table.recipientUserId,
      table.recipientKind,
    ),
    index('personal_notifications_recipient_created_idx').on(
      table.recipientUserId,
      table.createdAt,
      table.id,
    ),
    check('personal_notifications_kind_check', sql`${table.recipientKind} IN ('OWNER','REVIEWER')`),
  ],
)
