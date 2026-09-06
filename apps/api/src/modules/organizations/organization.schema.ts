import { sql } from 'drizzle-orm'
import {
  check,
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

import {
  users,
} from '../auth/auth.schema.js'

export const faculties = pgTable(
  'faculties',
  {
    id: uuid('id')
      .defaultRandom()
      .primaryKey(),

    code: varchar('code', {
      length: 50,
    }).notNull(),

    name: varchar('name', {
      length: 255,
    }).notNull(),

    status: varchar('status', {
      length: 20,
    })
      .notNull()
      .default('ACTIVE'),

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
    uniqueIndex('faculties_code_unique')
      .on(table.code),

    check(
      'faculties_status_check',
      sql`${table.status} IN ('ACTIVE', 'INACTIVE')`,
    ),
  ],
)

export const organizationalUnits = pgTable(
  'organizational_units',
  {
    id: uuid('id')
      .defaultRandom()
      .primaryKey(),

    code: varchar('code', {
      length: 50,
    }).notNull(),

    name: varchar('name', {
      length: 255,
    }).notNull(),

    status: varchar('status', {
      length: 20,
    })
      .notNull()
      .default('ACTIVE'),

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
    uniqueIndex(
      'organizational_units_code_unique',
    ).on(table.code),

    check(
      'organizational_units_status_check',
      sql`${table.status} IN ('ACTIVE', 'INACTIVE')`,
    ),
  ],
)

export const academicClasses = pgTable(
  'academic_classes',
  {
    id: uuid('id')
      .defaultRandom()
      .primaryKey(),

    facultyId: uuid('faculty_id')
      .notNull()
      .references(() => faculties.id, {
        onDelete: 'restrict',
      }),

    code: varchar('code', {
      length: 50,
    }).notNull(),

    name: varchar('name', {
      length: 255,
    }).notNull(),

    status: varchar('status', {
      length: 20,
    })
      .notNull()
      .default('ACTIVE'),

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
    uniqueIndex('academic_classes_code_unique')
      .on(table.code),

    index('academic_classes_faculty_id_idx')
      .on(table.facultyId),

    check(
      'academic_classes_status_check',
      sql`${table.status} IN ('ACTIVE', 'INACTIVE')`,
    ),
  ],
)

export const studentProfiles = pgTable(
  'student_profiles',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, {
        onDelete: 'cascade',
      }),

    studentCode: varchar('student_code', {
      length: 50,
    }).notNull(),

    classId: uuid('class_id')
      .notNull()
      .references(() => academicClasses.id, {
        onDelete: 'restrict',
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
    uniqueIndex('student_profiles_student_code_unique')
      .on(table.studentCode),

    index('student_profiles_class_id_idx')
      .on(table.classId),
  ],
)

export const academicAdvisorAssignments = pgTable(
  'academic_advisor_assignments',
  {
    id: uuid('id')
      .defaultRandom()
      .primaryKey(),

    advisorUserId: uuid('advisor_user_id')
      .notNull()
      .references(() => users.id, {
        onDelete: 'restrict',
      }),

    classId: uuid('class_id')
      .notNull()
      .references(() => academicClasses.id, {
        onDelete: 'restrict',
      }),

    validFrom: timestamp('valid_from', {
      withTimezone: true,
    }).notNull(),

    validTo: timestamp('valid_to', {
      withTimezone: true,
    }),

    status: varchar('status', {
      length: 20,
    })
      .notNull()
      .default('ACTIVE'),

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
    index('academic_advisor_assignments_class_id_idx')
      .on(table.classId),

    index('academic_advisor_assignments_advisor_user_id_idx')
      .on(table.advisorUserId),

    check(
      'academic_advisor_assignments_status_check',
      sql`${table.status} IN ('ACTIVE', 'INACTIVE')`,
    ),

    check(
      'academic_advisor_assignments_valid_period_check',
      sql`${table.validTo} IS NULL OR ${table.validTo} > ${table.validFrom}`,
    ),
  ],
)
