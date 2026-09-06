import {
  and,
  asc,
  eq,
  exists,
  gt,
  ilike,
  or,
  sql,
} from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'

import { db } from '../../db/client.js'
import {
  academicClasses,
  faculties,
  studentProfiles,
} from '../organizations/organization.schema.js'
import {
  roles,
  userRoles,
  users,
} from '../auth/auth.schema.js'
import {
  authorizationScopes,
  permissions,
  rolePermissions,
  userRoleScopes,
} from '../auth/authorization.schema.js'
import type {
  AdminStudentRepository,
  ListVisibleStudentsInput,
  StudentDirectoryPage,
} from './admin-student.service.js'

const actorUsers = alias(
  users,
  'student_directory_actor_users',
)
const actorUserRoles = alias(
  userRoles,
  'student_directory_actor_user_roles',
)
const actorRoles = alias(
  roles,
  'student_directory_actor_roles',
)
const actorRolePermissions = alias(
  rolePermissions,
  'student_directory_actor_role_permissions',
)
const actorPermissions = alias(
  permissions,
  'student_directory_actor_permissions',
)
const actorUserRoleScopes = alias(
  userRoleScopes,
  'student_directory_actor_user_role_scopes',
)
const actorScopes = alias(
  authorizationScopes,
  'student_directory_actor_scopes',
)

function escapeLikePattern(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('%', '\\%')
    .replaceAll('_', '\\_')
}

export class DrizzleAdminStudentRepository
implements AdminStudentRepository {
  constructor(
    private readonly database:
      typeof db = db,
  ) {}

  async listVisibleTo(
    input: ListVisibleStudentsInput,
  ): Promise<StudentDirectoryPage> {
    const accessQuery = this.database
      .select({ value: sql<number>`1` })
      .from(actorUsers)
      .innerJoin(
        actorUserRoles,
        eq(
          actorUsers.id,
          actorUserRoles.userId,
        ),
      )
      .innerJoin(
        actorRoles,
        eq(
          actorUserRoles.roleId,
          actorRoles.id,
        ),
      )
      .innerJoin(
        actorRolePermissions,
        eq(
          actorRoles.id,
          actorRolePermissions.roleId,
        ),
      )
      .innerJoin(
        actorPermissions,
        eq(
          actorRolePermissions.permissionId,
          actorPermissions.id,
        ),
      )
      .innerJoin(
        actorUserRoleScopes,
        and(
          eq(
            actorUserRoleScopes.userId,
            actorUserRoles.userId,
          ),
          eq(
            actorUserRoleScopes.roleId,
            actorUserRoles.roleId,
          ),
        ),
      )
      .innerJoin(
        actorScopes,
        eq(
          actorUserRoleScopes.scopeId,
          actorScopes.id,
        ),
      )
      .where(
        and(
          eq(actorUsers.id, input.actorUserId),
          eq(actorUsers.status, 'ACTIVE'),
          eq(
            actorPermissions.code,
            'student.read',
          ),
          or(
            eq(actorScopes.scopeType, 'GLOBAL'),
            and(
              eq(
                actorScopes.scopeType,
                'FACULTY',
              ),
              eq(
                actorScopes.facultyId,
                academicClasses.facultyId,
              ),
            ),
            and(
              eq(
                actorScopes.scopeType,
                'CLASS',
              ),
              eq(
                actorScopes.classId,
                studentProfiles.classId,
              ),
            ),
          ),
        ),
      )

    const normalizedSearch =
      input.search?.trim()
    const searchPattern = normalizedSearch
      ? `%${escapeLikePattern(normalizedSearch)}%`
      : undefined

    const rows = await this.database
      .select({
        userId: users.id,
        username: users.username,
        fullName: users.fullName,
        email: users.email,
        status: users.status,
        studentCode: studentProfiles.studentCode,
        classId: academicClasses.id,
        classCode: academicClasses.code,
        className: academicClasses.name,
        facultyId: faculties.id,
        facultyCode: faculties.code,
        facultyName: faculties.name,
      })
      .from(studentProfiles)
      .innerJoin(
        users,
        eq(studentProfiles.userId, users.id),
      )
      .innerJoin(
        academicClasses,
        eq(
          studentProfiles.classId,
          academicClasses.id,
        ),
      )
      .innerJoin(
        faculties,
        eq(
          academicClasses.facultyId,
          faculties.id,
        ),
      )
      .where(
        and(
          exists(accessQuery),
          input.afterStudentCode
            ? gt(
                studentProfiles.studentCode,
                input.afterStudentCode,
              )
            : undefined,
          input.status
            ? eq(users.status, input.status)
            : undefined,
          input.facultyId
            ? eq(faculties.id, input.facultyId)
            : undefined,
          input.classId
            ? eq(
                academicClasses.id,
                input.classId,
              )
            : undefined,
          searchPattern
            ? or(
                ilike(
                  users.username,
                  searchPattern,
                ),
                ilike(
                  users.fullName,
                  searchPattern,
                ),
                ilike(
                  studentProfiles.studentCode,
                  searchPattern,
                ),
              )
            : undefined,
        ),
      )
      .orderBy(
        asc(studentProfiles.studentCode),
      )
      .limit(input.limit + 1)

    const hasNextPage =
      rows.length > input.limit
    const pageRows = hasNextPage
      ? rows.slice(0, input.limit)
      : rows
    const lastRow = pageRows.at(-1)

    return {
      students: pageRows.map((row) => ({
        userId: row.userId,
        username: row.username,
        fullName: row.fullName,
        email: row.email,
        status: row.status,
        studentCode: row.studentCode,
        academicClass: {
          id: row.classId,
          code: row.classCode,
          name: row.className,
        },
        faculty: {
          id: row.facultyId,
          code: row.facultyCode,
          name: row.facultyName,
        },
      })),
      nextCursor:
        hasNextPage && lastRow
          ? lastRow.studentCode
          : null,
    }
  }
}
