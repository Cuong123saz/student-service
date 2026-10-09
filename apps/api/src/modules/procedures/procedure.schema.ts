import { sql } from 'drizzle-orm'
import {
  check,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { services } from '../../db/schema.js'
import { organizationalUnits } from '../organizations/organization.schema.js'
import { users } from '../auth/auth.schema.js'
import type { ProcedureConfig } from './procedure.contract.js'
export const procedureVersions = pgTable(
  'procedure_versions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    serviceId: integer('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'restrict' }),
    ownerUnitId: uuid('owner_unit_id')
      .notNull()
      .references(() => organizationalUnits.id, { onDelete: 'restrict' }),
    versionNumber: integer('version_number').notNull(),
    status: varchar('status', { length: 20 })
      .$type<'DRAFT' | 'PUBLISHED' | 'RETIRED'>()
      .notNull()
      .default('DRAFT'),
    revision: integer('revision').notNull().default(1),
    config: jsonb('config').$type<ProcedureConfig>().notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('procedure_versions_service_version_unique').on(
      table.serviceId,
      table.versionNumber,
    ),
    uniqueIndex('procedure_versions_one_draft')
      .on(table.serviceId)
      .where(sql.raw("status = 'DRAFT'")),
    uniqueIndex('procedure_versions_one_published')
      .on(table.serviceId)
      .where(sql.raw("status = 'PUBLISHED'")),
    check(
      'procedure_versions_status_check',
      sql.raw("status IN ('DRAFT', 'PUBLISHED', 'RETIRED')"),
    ),
    check('procedure_versions_numbers_check', sql.raw('version_number > 0 AND revision > 0')),
    check('procedure_versions_config_check', sql.raw("jsonb_typeof(config) = 'object'")),
    check(
      'procedure_versions_publication_check',
      sql.raw(
        "(status = 'DRAFT' AND published_at IS NULL) OR (status <> 'DRAFT' AND published_at IS NOT NULL)",
      ),
    ),
  ],
)
