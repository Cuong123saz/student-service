import {
  and,
  eq,
} from 'drizzle-orm'

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

import {
  validateNewPassword,
} from './password-policy.js'

type RecoveryVariable =
  | 'ALLOW_ADMIN_PASSWORD_RECOVERY'
  | 'RECOVERY_ADMIN_USERNAME'
  | 'RECOVERY_ADMIN_PASSWORD'

function readRequiredVariable(
  name: RecoveryVariable,
): string {
  const value =
    process.env[name]

  if (!value) {
    throw new Error(
      `Missing required variable: ${name}`,
    )
  }

  return value
}

async function recoverSystemAdminPassword():
Promise<void> {
  const recoveryAllowed =
    readRequiredVariable(
      'ALLOW_ADMIN_PASSWORD_RECOVERY',
    )

  if (recoveryAllowed !== 'true') {
    throw new Error(
      'Admin password recovery is not explicitly allowed',
    )
  }

  const username =
    readRequiredVariable(
      'RECOVERY_ADMIN_USERNAME',
    )
      .trim()
      .toLowerCase()

  const temporaryPassword =
    validateNewPassword(
      readRequiredVariable(
        'RECOVERY_ADMIN_PASSWORD',
      ),
    )

  const adminRows =
    await db
      .select({
        id: users.id,
        status: users.status,
      })
      .from(users)
      .innerJoin(
        userRoles,
        eq(
          users.id,
          userRoles.userId,
        ),
      )
      .innerJoin(
        roles,
        eq(
          userRoles.roleId,
          roles.id,
        ),
      )
      .where(
        and(
          eq(
            users.username,
            username,
          ),
          eq(
            roles.code,
            'SYSTEM_ADMIN',
          ),
        ),
      )
      .limit(1)

  const admin =
    adminRows[0]

  if (!admin) {
    throw new Error(
      'SYSTEM_ADMIN account not found',
    )
  }

  if (admin.status !== 'ACTIVE') {
    throw new Error(
      'SYSTEM_ADMIN account is not active',
    )
  }

  const passwordHasher =
    new Argon2PasswordHasher()

  const passwordHash =
    await passwordHasher.hash(
      temporaryPassword,
    )

  await db
    .update(users)
    .set({
      passwordHash,
      mustChangePassword: true,
      updatedAt: new Date(),
    })
    .where(
      eq(users.id, admin.id),
    )

  console.log(
    `SYSTEM_ADMIN password recovered: ${username}`,
  )

  console.log(
    'Password change will be required at the next login',
  )
}

try {
  await recoverSystemAdminPassword()
} catch (error: unknown) {
  console.error(
    'Admin password recovery failed',
    error,
  )

  process.exitCode = 1
} finally {
  await databaseClient.end()
}