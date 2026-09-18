import { and, asc, eq, exists, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'

import { db } from '../../db/client.js'
import { roles, userRoles, users } from '../auth/auth.schema.js'
import {
  authorizationScopes,
  permissions,
  rolePermissions,
  userRoleScopes,
} from '../auth/authorization.schema.js'
import { academicClasses, faculties } from './organization.schema.js'
import type {
  AcademicCatalogFaculty,
  AcademicCatalogRepository,
} from './academic-catalog.service.js'

const actorUsers = alias(users, 'academic_catalog_actor_users')
const actorUserRoles = alias(userRoles, 'academic_catalog_actor_user_roles')
const actorRoles = alias(roles, 'academic_catalog_actor_roles')
const actorRolePermissions = alias(rolePermissions, 'academic_catalog_actor_role_permissions')
const actorPermissions = alias(permissions, 'academic_catalog_actor_permissions')
const actorUserRoleScopes = alias(userRoleScopes, 'academic_catalog_actor_user_role_scopes')
const actorScopes = alias(authorizationScopes, 'academic_catalog_actor_scopes')

export class DrizzleAcademicCatalogRepository implements AcademicCatalogRepository {
  constructor(private readonly database: typeof db = db) {}

  async listVisibleTo(actorUserId: string): Promise<AcademicCatalogFaculty[]> {
    const accessQuery = this.database
      .select({ value: sql<number>`1` })
      .from(actorUsers)
      .innerJoin(actorUserRoles, eq(actorUsers.id, actorUserRoles.userId))
      .innerJoin(actorRoles, eq(actorUserRoles.roleId, actorRoles.id))
      .innerJoin(actorRolePermissions, eq(actorRoles.id, actorRolePermissions.roleId))
      .innerJoin(actorPermissions, eq(actorRolePermissions.permissionId, actorPermissions.id))
      .innerJoin(
        actorUserRoleScopes,
        and(
          eq(actorUserRoleScopes.userId, actorUserRoles.userId),
          eq(actorUserRoleScopes.roleId, actorUserRoles.roleId),
        ),
      )
      .innerJoin(actorScopes, eq(actorUserRoleScopes.scopeId, actorScopes.id))
      .where(
        and(
          eq(actorUsers.id, actorUserId),
          eq(actorUsers.status, 'ACTIVE'),
          eq(actorPermissions.code, 'student.read'),
          or(
            eq(actorScopes.scopeType, 'GLOBAL'),
            and(eq(actorScopes.scopeType, 'FACULTY'), eq(actorScopes.facultyId, faculties.id)),
            and(eq(actorScopes.scopeType, 'CLASS'), eq(actorScopes.classId, academicClasses.id)),
          ),
        ),
      )

    const rows = await this.database
      .select({
        facultyId: faculties.id,
        facultyCode: faculties.code,
        facultyName: faculties.name,
        classId: academicClasses.id,
        classCode: academicClasses.code,
        className: academicClasses.name,
      })
      .from(academicClasses)
      .innerJoin(faculties, eq(academicClasses.facultyId, faculties.id))
      .where(
        and(
          eq(academicClasses.status, 'ACTIVE'),
          eq(faculties.status, 'ACTIVE'),
          exists(accessQuery),
        ),
      )
      .orderBy(asc(faculties.code), asc(academicClasses.code))

    const facultyMap = new Map<string, AcademicCatalogFaculty>()

    for (const row of rows) {
      let faculty = facultyMap.get(row.facultyId)

      if (!faculty) {
        faculty = {
          id: row.facultyId,
          code: row.facultyCode,
          name: row.facultyName,
          classes: [],
        }
        facultyMap.set(row.facultyId, faculty)
      }

      faculty.classes.push({
        id: row.classId,
        code: row.classCode,
        name: row.className,
      })
    }

    return [...facultyMap.values()]
  }
}
