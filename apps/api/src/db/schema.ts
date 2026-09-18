import { integer, pgTable, serial, text, varchar } from 'drizzle-orm/pg-core'

export const services = pgTable('services', {
  id: serial('id').primaryKey(),

  code: varchar('code', {
    length: 100,
  })
    .notNull()
    .unique(),

  name: varchar('name', {
    length: 255,
  }).notNull(),

  description: text('description').notNull(),

  processingDays: integer('processing_days').notNull(),

  status: varchar('status', {
    length: 20,
  })
    .notNull()
    .default('ACTIVE'),
})
