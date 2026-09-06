import {
  and,
  asc,
  eq,
  inArray,
} from 'drizzle-orm'

import { db } from '../../db/client.js'
import { auditLogs } from '../audit/audit.schema.js'
import {
  roles,
  userRoles,
  users,
} from './auth.schema.js'
import {
  authorizationScopes,
  permissions,
  rolePermissions,
  userRoleScopes,
} from './authorization.schema.js'
import type {
  ReplaceRolePermissionsInput,
  RolePermissionRepository,
  RolePermissionSnapshot,
} from './role-permission.service.js'

type Transaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0]

export class RolePermissionForbiddenError extends Error {
  constructor() {
    super('Only a global system administrator can manage role permissions')
    this.name = 'RolePermissionForbiddenError'
  }
}

export class RolePermissionNotFoundError extends Error {
  constructor(readonly field: 'roleId' | 'permissionCodes') {
    super(`${field} contains an unknown catalog entry`)
    this.name = 'RolePermissionNotFoundError'
  }
}

export class RolePermissionConflictError extends Error {
  constructor(
    readonly field: 'roleId' | 'permissionCodes',
    message: string,
  ) {
    super(message)
    this.name = 'RolePermissionConflictError'
  }
}

async function hasManagementAuthority(
  transaction: Transaction,
  actorUserId: string,
): Promise<boolean> {
  const [authority] = await transaction
    .select({ id: users.id })
    .from(users)
    .innerJoin(userRoles, eq(users.id, userRoles.userId))
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .innerJoin(
      rolePermissions,
      eq(userRoles.roleId, rolePermissions.roleId),
    )
    .innerJoin(
      permissions,
      eq(rolePermissions.permissionId, permissions.id),
    )
    .innerJoin(
      userRoleScopes,
      and(
        eq(userRoleScopes.userId, userRoles.userId),
        eq(userRoleScopes.roleId, userRoles.roleId),
      ),
    )
    .innerJoin(
      authorizationScopes,
      eq(userRoleScopes.scopeId, authorizationScopes.id),
    )
    .where(and(
      eq(users.id, actorUserId),
      eq(users.status, 'ACTIVE'),
      eq(roles.code, 'SYSTEM_ADMIN'),
      eq(permissions.code, 'role.manage'),
      eq(authorizationScopes.scopeType, 'GLOBAL'),
    ))
    .limit(1)

  return Boolean(authority)
}

function sameCodes(first: string[], second: string[]): boolean {
  return first.length === second.length
    && first.every((code, index) => code === second[index])
}

export class DrizzleRolePermissionRepository
implements RolePermissionRepository {
  constructor(private readonly database: typeof db = db) {}

  async getSnapshot(actorUserId: string): Promise<RolePermissionSnapshot> {
    return this.database.transaction(async (transaction) => {
      if (!await hasManagementAuthority(transaction, actorUserId)) {
        throw new RolePermissionForbiddenError()
      }

      const roleRows = await transaction
        .select({
          id: roles.id,
          code: roles.code,
          name: roles.name,
          description: roles.description,
        })
        .from(roles)
        .where(eq(roles.isSystem, true))
        .orderBy(asc(roles.id))
      const permissionRows = await transaction
        .select({
          id: permissions.id,
          code: permissions.code,
          name: permissions.name,
          description: permissions.description,
        })
        .from(permissions)
        .where(eq(permissions.isSystem, true))
        .orderBy(asc(permissions.code))
      const grantRows = await transaction
        .select({
          roleId: rolePermissions.roleId,
          permissionCode: permissions.code,
        })
        .from(rolePermissions)
        .innerJoin(
          permissions,
          eq(rolePermissions.permissionId, permissions.id),
        )
        .orderBy(asc(permissions.code))

      return {
        roles: roleRows.map(role => ({
          ...role,
          permissionCodes: grantRows
            .filter(grant => grant.roleId === role.id)
            .map(grant => grant.permissionCode),
          canManage: role.code !== 'SYSTEM_ADMIN',
        })),
        permissions: permissionRows,
      }
    })
  }

  async replacePermissions(
    input: ReplaceRolePermissionsInput,
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      if (!await hasManagementAuthority(transaction, input.actor.userId)) {
        throw new RolePermissionForbiddenError()
      }

      const [targetRole] = await transaction
        .select({ id: roles.id, code: roles.code })
        .from(roles)
        .where(and(
          eq(roles.id, input.roleId),
          eq(roles.isSystem, true),
        ))
        .for('update')
        .limit(1)
      if (!targetRole) {
        throw new RolePermissionNotFoundError('roleId')
      }
      if (targetRole.code === 'SYSTEM_ADMIN') {
        throw new RolePermissionConflictError(
          'roleId',
          'SYSTEM_ADMIN permissions are protected',
        )
      }

      const selectedPermissions = input.permissionCodes.length === 0
        ? []
        : await transaction
            .select({ id: permissions.id, code: permissions.code })
            .from(permissions)
            .where(and(
              eq(permissions.isSystem, true),
              inArray(permissions.code, input.permissionCodes),
            ))
      if (selectedPermissions.length !== input.permissionCodes.length) {
        throw new RolePermissionNotFoundError('permissionCodes')
      }

      const currentRows = await transaction
        .select({ code: permissions.code })
        .from(rolePermissions)
        .innerJoin(
          permissions,
          eq(rolePermissions.permissionId, permissions.id),
        )
        .where(eq(rolePermissions.roleId, targetRole.id))
        .orderBy(asc(permissions.code))
      const before = currentRows.map(row => row.code)
      const after = selectedPermissions.map(row => row.code).sort()
      if (sameCodes(before, after)) {
        throw new RolePermissionConflictError(
          'permissionCodes',
          'Role permissions are unchanged',
        )
      }

      await transaction
        .delete(rolePermissions)
        .where(eq(rolePermissions.roleId, targetRole.id))
      if (selectedPermissions.length > 0) {
        await transaction.insert(rolePermissions).values(
          selectedPermissions.map(permission => ({
            roleId: targetRole.id,
            permissionId: permission.id,
            grantedAt: input.changedAt,
          })),
        )
      }

      await transaction.insert(auditLogs).values({
        actorType: 'USER',
        actorUserId: input.actor.userId,
        actorUsername: input.actor.username,
        action: 'ROLE_PERMISSION_UPDATE',
        resourceType: 'ROLE',
        resourceId: String(targetRole.id),
        outcome: 'SUCCESS',
        occurredAt: input.changedAt,
        requestId: input.audit.requestId,
        ipAddress: input.audit.ipAddress,
        userAgent: input.audit.userAgent,
        metadata: {},
        before: { roleCode: targetRole.code, permissionCodes: before },
        after: { roleCode: targetRole.code, permissionCodes: after },
      })
    })
  }
}
