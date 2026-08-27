import { eq } from 'drizzle-orm'
import {
  validateNewPassword,
} from './password-policy.js'
import {
  databaseClient,
  db,
} from '../../db/client.js'
import {
  roles,
  userRoles,
  users,
} from './auth.schema.js'
import {
  Argon2PasswordHasher,
} from './password-hasher.js'

type BootstrapVariable =
  | 'BOOTSTRAP_ADMIN_USERNAME'
  | 'BOOTSTRAP_ADMIN_FULL_NAME'
  | 'BOOTSTRAP_ADMIN_PASSWORD'

function readRequiredVariable(
  name: BootstrapVariable,
): string {
  const value = process.env[name]

  if (!value) {
    throw new Error(
      `Missing required variable: ${name}`,
    )
  }

  return value
}


async function bootstrapSystemAdmin() {
  const username =
    readRequiredVariable(
      'BOOTSTRAP_ADMIN_USERNAME',
    )
      .trim()
      .toLowerCase()

  const fullName =
    readRequiredVariable(
      'BOOTSTRAP_ADMIN_FULL_NAME',
    ).trim()

  const password = validateNewPassword(
    readRequiredVariable(
      'BOOTSTRAP_ADMIN_PASSWORD',
    ),
  )

  if (!username || !fullName) {
    throw new Error(
      'Username and full name must not be empty',
    )
  }

  const systemAdminRows = await db
    .select({
      id: roles.id,
    })
    .from(roles)
    .where(
      eq(roles.code, 'SYSTEM_ADMIN'),
    )
    .limit(1)

  const systemAdminRole =
    systemAdminRows[0]

  if (!systemAdminRole) {
    throw new Error(
      'SYSTEM_ADMIN role does not exist. Run db:seed first.',
    )
  }

  const existingAdminRows = await db
    .select({
      id: users.id,
    })
    .from(users)
    .innerJoin(
      userRoles,
      eq(users.id, userRoles.userId),
    )
    .innerJoin(
      roles,
      eq(userRoles.roleId, roles.id),
    )
    .where(
      eq(roles.code, 'SYSTEM_ADMIN'),
    )
    .limit(1)

  if (existingAdminRows[0]) {
    throw new Error(
      'A SYSTEM_ADMIN account already exists',
    )
  }

  const existingUsernameRows = await db
    .select({
      id: users.id,
    })
    .from(users)
    .where(
      eq(users.username, username),
    )
    .limit(1)

  if (existingUsernameRows[0]) {
    throw new Error(
      'Username already exists',
    )
  }

  const passwordHasher =
    new Argon2PasswordHasher()

  const passwordHash =
    await passwordHasher.hash(password)

  await db.transaction(
    async (transaction) => {
      const insertedUsers =
        await transaction
          .insert(users)
          .values({
            username,
            passwordHash,
            fullName,
            status: 'ACTIVE',
            mustChangePassword: false,
          })
          .returning({
            id: users.id,
          })

      const insertedUser =
        insertedUsers[0]

      if (!insertedUser) {
        throw new Error(
          'Could not create SYSTEM_ADMIN account',
        )
      }

      await transaction
        .insert(userRoles)
        .values({
          userId: insertedUser.id,
          roleId: systemAdminRole.id,
        })
    },
  )

  console.log(
    `SYSTEM_ADMIN created: ${username}`,
  )
}

try {
  await bootstrapSystemAdmin()
} catch (error: unknown) {
  console.error(
    'Bootstrap failed',
    error,
  )

  process.exitCode = 1
} finally {
  await databaseClient.end()
}