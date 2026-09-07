import {
  and,
  asc,
  eq,
  exists,
  ilike,
  or,
  sql,
} from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'

import { db } from '../../db/client.js'
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
import {
  academicClasses,
  faculties,
  studentProfiles,
} from '../organizations/organization.schema.js'
import type {
  ListStudentExportInput,
  StudentExportRecord,
  StudentExportRepository,
} from './student-export.service.js'

const actorUsers = alias(
  users,
  'student_export_actor_users',
)
const actorUserRoles = alias(
  userRoles,
  'student_export_actor_user_roles',
)
const actorRoles = alias(
  roles,
  'student_export_actor_roles',
)
const actorRolePermissions = alias(
  rolePermissions,
  'student_export_actor_role_permissions',
)
const actorPermissions = alias(
  permissions,
  'student_export_actor_permissions',
)
const actorUserRoleScopes = alias(
  userRoleScopes,
  'student_export_actor_user_role_scopes',
)
const actorScopes = alias(
  authorizationScopes,
  'student_export_actor_scopes',
)

export class StudentExportForbiddenError
extends Error {
  constructor() {
    super('Student export is outside actor authority')
    this.name = 'StudentExportForbiddenError'
  }
}

export class StudentExportRowLimitExceededError
extends Error {
  constructor(readonly maxRows: number) {
    super(
      `Student export exceeds the ${maxRows} row limit`,
    )
    this.name = 'StudentExportRowLimitExceededError'
  }
}

function escapeLikePattern(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('%', '\\%')
    .replaceAll('_', '\\_')
}

function accessQuery(
  actorUserId: string,
) {
  return db
    .select({ value: sql<number>`1` })
    .from(actorUsers)
    .innerJoin(
      actorUserRoles,
      eq(actorUsers.id, actorUserRoles.userId),
    )
    .innerJoin(
      actorRoles,
      eq(actorUserRoles.roleId, actorRoles.id),
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
        eq(actorUsers.id, actorUserId),
        eq(actorUsers.status, 'ACTIVE'),
        eq(
          actorPermissions.code,
          'student.export',
        ),
        or(
          eq(actorScopes.scopeType, 'GLOBAL'),
          and(
            eq(actorScopes.scopeType, 'FACULTY'),
            eq(
              actorScopes.facultyId,
              academicClasses.facultyId,
            ),
          ),
          and(
            eq(actorScopes.scopeType, 'CLASS'),
            eq(
              actorScopes.classId,
              studentProfiles.classId,
            ),
          ),
        ),
      ),
    )
}

export class DrizzleStudentExportRepository
implements StudentExportRepository {
  constructor(
    private readonly database:
      typeof db = db,
  ) {}

  async listVisibleForExport(
    input: ListStudentExportInput,
  ): Promise<StudentExportRecord[]> {
    const normalizedSearch =
      input.search?.trim()
    const searchPattern = normalizedSearch
      ? `%${escapeLikePattern(normalizedSearch)}%`
      : undefined

    const rows = await this.database
      .select({
        username: users.username,
        fullName: users.fullName,
        email: users.email,
        status: users.status,
        studentCode: studentProfiles.studentCode,
        classCode: academicClasses.code,
        className: academicClasses.name,
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
          exists(accessQuery(input.actorUserId)),
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
                ilike(users.username, searchPattern),
                ilike(users.fullName, searchPattern),
                ilike(
                  studentProfiles.studentCode,
                  searchPattern,
                ),
              )
            : undefined,
        ),
      )
      .orderBy(asc(studentProfiles.studentCode))
      .limit(input.maxRows + 1)

    if (rows.length > input.maxRows) {
      throw new StudentExportRowLimitExceededError(
        input.maxRows,
      )
    }

    return rows
  }
}
