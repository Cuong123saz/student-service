import { and, eq, ne, or, sql, inArray, isNull } from 'drizzle-orm'
import type { db } from '../../db/client.js'
import { users, userRoles } from '../auth/auth.schema.js'
import {
  authorizationScopes,
  permissions,
  rolePermissions,
  userRoleScopes,
} from '../auth/authorization.schema.js'
import { submissions } from './submission.schema.js'
import { organizationalUnits } from '../organizations/organization.schema.js'
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
export interface ReviewAuthority {
  userId: string
  scopeType: string
  unitId: string | null
  canAssign: boolean
}
// Permission and scope must belong to the SAME assigned role.
export function reviewerAuthorities(
  tx: Transaction,
  options: {
    userId?: string
    unitId?: string
    excludeUserId?: string
    requireReject?: boolean
    requireAssign?: boolean
  } = {},
) {
  return tx
    .selectDistinct({
      userId: users.id,
      scopeType: authorizationScopes.scopeType,
      unitId: authorizationScopes.organizationalUnitId,
      canAssign: sql<boolean>`EXISTS (SELECT 1 FROM role_permissions assignment_grant JOIN permissions assignment_permission ON assignment_permission.id = assignment_grant.permission_id WHERE assignment_grant.role_id = ${userRoles.roleId} AND assignment_permission.code = 'submission.assign')`,
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
        options.requireAssign
          ? sql<boolean>`EXISTS (SELECT 1 FROM role_permissions assignment_grant JOIN permissions assignment_permission ON assignment_permission.id = assignment_grant.permission_id WHERE assignment_grant.role_id = ${userRoles.roleId} AND assignment_permission.code = 'submission.assign')`
          : undefined,
        options.requireReject
          ? sql`EXISTS (SELECT 1 FROM role_permissions resolution_grant JOIN permissions resolution_permission ON resolution_permission.id = resolution_grant.permission_id WHERE resolution_grant.role_id = ${userRoles.roleId} AND resolution_permission.code = 'submission.reject')`
          : undefined,
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

export function reviewVisibility(userId: string, authority: ReviewAuthority[]) {
  const inScope = (scopes: ReviewAuthority[]) =>
    scopes.some((scope) => scope.scopeType === 'GLOBAL')
      ? sql`true`
      : scopes.some((scope) => scope.unitId)
        ? inArray(
            submissions.processingUnitId,
            scopes.flatMap((scope) => (scope.unitId ? [scope.unitId] : [])),
          )
        : sql`false`
  return and(
    inArray(submissions.status, [
      'SUBMITTED',
      'IN_REVIEW',
      'NEEDS_SUPPLEMENT',
      'APPROVED',
      'REJECTED',
    ]),
    ne(submissions.studentUserId, userId),
    inScope(authority),
    or(
      isNull(submissions.designatedReviewerId),
      and(eq(submissions.status, 'SUBMITTED'), eq(submissions.designatedReviewerId, userId)),
      and(
        inArray(submissions.status, ['IN_REVIEW', 'NEEDS_SUPPLEMENT']),
        or(
          eq(submissions.reviewerUserId, userId),
          inScope(authority.filter((scope) => scope.canAssign)),
        ),
      ),
      and(
        inArray(submissions.status, ['APPROVED', 'REJECTED']),
        eq(submissions.reviewerUserId, userId),
      ),
    ),
    sql`EXISTS (SELECT 1 FROM organizational_units intake_unit WHERE intake_unit.id = ${submissions.processingUnitId} AND intake_unit.status = 'ACTIVE')`,
  )
}
