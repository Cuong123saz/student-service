import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  serial,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

export const users = pgTable(
  'users',
  {
    id: uuid('id')
      .defaultRandom()
      .primaryKey(),

    username: varchar('username', {
      length: 100,
    })
      .notNull()
      .unique(),

    passwordHash: varchar(
      'password_hash',
      {
        length: 255,
      },
    ),

    fullName: varchar('full_name', {
      length: 255,
    }).notNull(),

    email: varchar('email', {
      length: 255,
    }).unique(),

    status: varchar('status', {
      length: 20,
    })
      .notNull()
      .default('ACTIVE'),

    mustChangePassword: boolean(
      'must_change_password',
    )
      .notNull()
      .default(true),

    invitedAt: timestamp(
      'invited_at',
      {
        withTimezone: true,
      },
    ),
    lastInvitationSentAt: timestamp(
  'last_invitation_sent_at',
  {
    withTimezone: true,
  },
),

    activatedAt: timestamp(
      'activated_at',
      {
        withTimezone: true,
      },
    ),

    createdAt: timestamp(
      'created_at',
      {
        withTimezone: true,
      },
    )
      .notNull()
      .defaultNow(),

    updatedAt: timestamp(
      'updated_at',
      {
        withTimezone: true,
      },
    )
      .notNull()
      .defaultNow(),
  },

  // Tham số thứ ba của pgTable
  (table) => [
  index(
    'users_status_invited_at_idx',
  ).on(
    table.status,
    table.invitedAt,
  ),

  index(
    'users_status_last_invitation_sent_at_idx',
  ).on(
    table.status,
    table.lastInvitationSentAt,
  ),
],
  
)

export const roles = pgTable('roles', {
  id: serial('id').primaryKey(),

  code: varchar('code', {
    length: 50,
  })
    .notNull()
    .unique(),

  name: varchar('name', {
    length: 100,
  }).notNull(),

  description: varchar('description', {
    length: 255,
  }),

  isSystem: boolean('is_system')
    .notNull()
    .default(false),
})

export const userRoles = pgTable(
  'user_roles',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, {
        onDelete: 'cascade',
      }),

    roleId: integer('role_id')
      .notNull()
      .references(() => roles.id, {
        onDelete: 'cascade',
      }),

    assignedAt: timestamp('assigned_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.userId,
        table.roleId,
      ],
    }),
  ],
)