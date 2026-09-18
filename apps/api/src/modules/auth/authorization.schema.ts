import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  serial,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

import { roles, userRoles } from './auth.schema.js'
import {
  academicClasses,
  faculties,
  organizationalUnits,
} from '../organizations/organization.schema.js'

export const AUTHORIZATION_SCOPE_TYPES = ['GLOBAL', 'FACULTY', 'CLASS', 'ORGANIZATION'] as const

export type AuthorizationScopeType = (typeof AUTHORIZATION_SCOPE_TYPES)[number]

export const permissions = pgTable('permissions', {
  id: serial('id').primaryKey(),

  code: varchar('code', {
    length: 100,
  })
    .notNull()
    .unique(),

  name: varchar('name', {
    length: 150,
  }).notNull(),

  description: varchar('description', {
    length: 255,
  }),

  isSystem: boolean('is_system').notNull().default(true),
})

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: integer('role_id')
      .notNull()
      .references(() => roles.id, {
        onDelete: 'cascade',
      }),

    permissionId: integer('permission_id')
      .notNull()
      .references(() => permissions.id, {
        onDelete: 'cascade',
      }),

    grantedAt: timestamp('granted_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.roleId, table.permissionId],
    }),
    index('role_permissions_permission_id_idx').on(table.permissionId),
  ],
)

export const authorizationScopes = pgTable(
  'authorization_scopes',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    scopeType: varchar('scope_type', {
      length: 30,
    }).notNull(),

    facultyId: uuid('faculty_id').references(() => faculties.id, {
      onDelete: 'cascade',
    }),

    classId: uuid('class_id').references(() => academicClasses.id, {
      onDelete: 'cascade',
    }),

    organizationalUnitId: uuid('organizational_unit_id'),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('authorization_scopes_global_unique')
      .on(table.scopeType)
      .where(sql`${table.scopeType} = 'GLOBAL'`),

    uniqueIndex('authorization_scopes_faculty_unique').on(table.facultyId),

    uniqueIndex('authorization_scopes_class_unique').on(table.classId),

    uniqueIndex('authorization_scopes_organization_unique').on(table.organizationalUnitId),

    check(
      'authorization_scopes_target_check',
      sql`(
        (${table.scopeType} = 'GLOBAL'
          AND ${table.facultyId} IS NULL
          AND ${table.classId} IS NULL
          AND ${table.organizationalUnitId} IS NULL)
        OR
        (${table.scopeType} = 'FACULTY'
          AND ${table.facultyId} IS NOT NULL
          AND ${table.classId} IS NULL
          AND ${table.organizationalUnitId} IS NULL)
        OR
        (${table.scopeType} = 'CLASS'
          AND ${table.facultyId} IS NULL
          AND ${table.classId} IS NOT NULL
          AND ${table.organizationalUnitId} IS NULL)
        OR
        (${table.scopeType} = 'ORGANIZATION'
          AND ${table.facultyId} IS NULL
          AND ${table.classId} IS NULL
          AND ${table.organizationalUnitId} IS NOT NULL)
      )`,
    ),

    foreignKey({
      columns: [table.organizationalUnitId],
      foreignColumns: [organizationalUnits.id],
      name: 'authorization_scopes_org_unit_fk',
    }).onDelete('cascade'),
  ],
)

export const userRoleScopes = pgTable(
  'user_role_scopes',
  {
    userId: uuid('user_id').notNull(),
    roleId: integer('role_id').notNull(),

    scopeId: uuid('scope_id')
      .notNull()
      .references(() => authorizationScopes.id, { onDelete: 'cascade' }),

    assignedAt: timestamp('assigned_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.userId, table.roleId, table.scopeId],
    }),

    foreignKey({
      columns: [table.userId, table.roleId],
      foreignColumns: [userRoles.userId, userRoles.roleId],
      name: 'user_role_scopes_user_role_fk',
    }).onDelete('cascade'),

    index('user_role_scopes_scope_id_idx').on(table.scopeId),
  ],
)
