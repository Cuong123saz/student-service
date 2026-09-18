import { and, eq } from 'drizzle-orm'

import { db } from '../../db/client.js'
import { roles, userRoles, users } from './auth.schema.js'
import { permissions, rolePermissions } from './authorization.schema.js'
import type { AuthorizationRepository, PermissionCheckInput } from './authorization.service.js'

export class DrizzleAuthorizationRepository implements AuthorizationRepository {
  constructor(private readonly database: typeof db = db) {}

  async hasPermission(input: PermissionCheckInput): Promise<boolean> {
    const rows = await this.database
      .select({
        permissionId: permissions.id,
      })
      .from(users)
      .innerJoin(userRoles, eq(users.id, userRoles.userId))
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .innerJoin(rolePermissions, eq(roles.id, rolePermissions.roleId))
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(
        and(
          eq(users.id, input.userId),
          eq(users.status, 'ACTIVE'),
          eq(permissions.code, input.permission),
        ),
      )
      .limit(1)

    return rows.length === 1
  }
}
