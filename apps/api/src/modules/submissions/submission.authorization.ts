import { and, eq, ne, or } from 'drizzle-orm'
import type { db } from '../../db/client.js'
import { users, userRoles } from '../auth/auth.schema.js'
import {
  authorizationScopes,
  permissions,
  rolePermissions,
  userRoleScopes,
} from '../auth/authorization.schema.js'
import { organizationalUnits } from '../organizations/organization.schema.js'
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
export interface ReviewAuthority {
  userId: string
  scopeType: string
  unitId: string | null
}
// Permission and scope must belong to the SAME assigned role.
export function reviewerAuthorities(
  tx: Transaction,
  options: { userId?: string; unitId?: string; excludeUserId?: string } = {},
) {
  return tx
    .selectDistinct({
      userId: users.id,
      scopeType: authorizationScopes.scopeType,
      unitId: authorizationScopes.organizationalUnitId,
    })
    .from(users)
    .innerJoin(userRoles, eq(users.id, userRoles.userId))
    .innerJoin(rolePermissions, eq(userRoles.roleId, rolePermissions.roleId))
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .innerJoin(
      userRoleScopes,
      and(eq(userRoleScopes.userId, userRoles.userId), eq(userRoleScopes.roleId, userRoles.roleId)),
    )
    .innerJoin(authorizationScopes, eq(userRoleScopes.scopeId, authorizationScopes.id))
    .leftJoin(
      organizationalUnits,
      eq(organizationalUnits.id, authorizationScopes.organizationalUnitId),
    )
    .where(
      and(
        options.userId ? eq(users.id, options.userId) : undefined,
        options.excludeUserId ? ne(users.id, options.excludeUserId) : undefined,
        options.unitId
          ? or(
              eq(authorizationScopes.scopeType, 'GLOBAL'),
              and(
                eq(authorizationScopes.scopeType, 'ORGANIZATION'),
                eq(authorizationScopes.organizationalUnitId, options.unitId),
              ),
            )
          : undefined,
        eq(users.status, 'ACTIVE'),
        eq(users.mustChangePassword, false),
        eq(permissions.code, 'submission.review'),
        or(
          eq(authorizationScopes.scopeType, 'GLOBAL'),
          and(
            eq(authorizationScopes.scopeType, 'ORGANIZATION'),
            eq(organizationalUnits.status, 'ACTIVE'),
          ),
        ),
      ),
    )
}
export function hasReviewScope(authority: ReviewAuthority, unitId: string) {
  return (
    authority.scopeType === 'GLOBAL' ||
    (authority.scopeType === 'ORGANIZATION' && authority.unitId === unitId)
  )
}
