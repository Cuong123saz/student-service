import { eq } from 'drizzle-orm'

import { db } from '../../db/client.js'
import {
  roles,
  userRoles,
  users,
} from './auth.schema.js'
import type {
  AuthUserRepository,
  UserForAuthentication,
} from './auth.service.js'
import type {
  PasswordChangeRepository,
  UserPasswordState,
} from './password-change.service.js'

export class DrizzleAuthUserRepository
implements
  AuthUserRepository,
  PasswordChangeRepository {
  constructor(
    private readonly database:
      typeof db = db,
  ) {}

  async findByUsername(
    username: string,
  ): Promise<UserForAuthentication | null> {
    const rows = await this.database
      .select({
        id: users.id,
        username: users.username,
        passwordHash:
          users.passwordHash,
        status: users.status,
        mustChangePassword:
          users.mustChangePassword,
        roleCode: roles.code,
      })
      .from(users)
      .leftJoin(
        userRoles,
        eq(users.id, userRoles.userId),
      )
      .leftJoin(
        roles,
        eq(userRoles.roleId, roles.id),
      )
      .where(
        eq(users.username, username),
      )

    const firstRow = rows[0]

    if (!firstRow) {
      return null
    }

    return {
      id: firstRow.id,
      username: firstRow.username,
      passwordHash:
        firstRow.passwordHash,
      status: firstRow.status,
      mustChangePassword:
        firstRow.mustChangePassword,
      roles: rows.flatMap((row) =>
        row.roleCode
          ? [row.roleCode]
          : [],
      ),
    }
  }

  async findPasswordStateById(
    userId: string,
  ): Promise<UserPasswordState | null> {
    const rows = await this.database
      .select({
        id: users.id,
        passwordHash:
          users.passwordHash,
        status: users.status,
      })
      .from(users)
      .where(
        eq(users.id, userId),
      )
      .limit(1)

    return rows[0] ?? null
  }

  async updatePassword(
    userId: string,
    passwordHash: string,
  ): Promise<boolean> {
    const updatedRows =
      await this.database
        .update(users)
        .set({
          passwordHash,
          mustChangePassword: false,
          updatedAt: new Date(),
        })
        .where(
          eq(users.id, userId),
        )
        .returning({
          id: users.id,
        })

    return updatedRows.length === 1
  }
}