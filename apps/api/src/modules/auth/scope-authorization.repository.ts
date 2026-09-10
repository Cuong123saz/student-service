import { and, eq, or } from 'drizzle-orm'

import { db } from '../../db/client.js'
import { academicClasses, studentProfiles } from '../organizations/organization.schema.js'
import { roles, userRoles, users } from './auth.schema.js'
import {
  authorizationScopes,
  permissions,
  rolePermissions,
  userRoleScopes,
} from './authorization.schema.js'
import type {
  ScopeAuthorizationRepository,
  StudentScopeCheckInput,
} from './scope-authorization.service.js'

export class DrizzleScopeAuthorizationRepository implements ScopeAuthorizationRepository {
  constructor(private readonly database: typeof db = db) {}

  async canAccessStudent(input: StudentScopeCheckInput): Promise<boolean> {
    const rows = await this.database
      .select({
        scopeId: authorizationScopes.id,
      })
      .from(users)
      .innerJoin(userRoles, eq(users.id, userRoles.userId))
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .innerJoin(rolePermissions, eq(roles.id, rolePermissions.roleId))
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .innerJoin(
        userRoleScopes,
        and(
          eq(userRoleScopes.userId, userRoles.userId),
          eq(userRoleScopes.roleId, userRoles.roleId),
        ),
      )
      .innerJoin(authorizationScopes, eq(userRoleScopes.scopeId, authorizationScopes.id))
      .innerJoin(studentProfiles, eq(studentProfiles.userId, input.studentUserId))
      .innerJoin(academicClasses, eq(studentProfiles.classId, academicClasses.id))
      .where(
        and(
          eq(users.id, input.actorUserId),
          eq(users.status, 'ACTIVE'),
          eq(permissions.code, input.permission),
          // ORGANIZATION is intentionally excluded: an
          // organizational unit has no relationship to a
          // student profile or academic class. That scope
          // applies to organization-management permissions
          // and must never grant student access implicitly.
          or(
            eq(authorizationScopes.scopeType, 'GLOBAL'),
            and(
              eq(authorizationScopes.scopeType, 'FACULTY'),
              eq(authorizationScopes.facultyId, academicClasses.facultyId),
            ),
            and(
              eq(authorizationScopes.scopeType, 'CLASS'),
              eq(authorizationScopes.classId, studentProfiles.classId),
            ),
          ),
        ),
      )
      .limit(1)

    return rows.length === 1
  }
}
