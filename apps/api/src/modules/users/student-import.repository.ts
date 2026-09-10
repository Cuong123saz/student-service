import { and, eq, exists, gt, inArray, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'

import { db } from '../../db/client.js'
import { auditLogs } from '../audit/audit.schema.js'
import { roles, userRoles, users } from '../auth/auth.schema.js'
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
  CommitStudentImportInput,
  ExistingStudentImportIdentity,
  ImportableAcademicClass,
  InspectStudentImportInput,
  InspectStudentImportResult,
  StudentImportCommitResult,
  StudentImportRepository,
} from './student-import.service.js'
import { invitationDeliveryJobs } from './invitation-delivery-job.schema.js'
import { studentImportPreviews } from './student-import.schema.js'

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

type QueryDatabase = typeof db | Transaction

const actorUsers = alias(users, 'student_import_actor_users')
const actorUserRoles = alias(userRoles, 'student_import_actor_user_roles')
const actorRoles = alias(roles, 'student_import_actor_roles')
const actorRolePermissions = alias(rolePermissions, 'student_import_actor_role_permissions')
const actorPermissions = alias(permissions, 'student_import_actor_permissions')
const actorUserRoleScopes = alias(userRoleScopes, 'student_import_actor_user_role_scopes')
const actorScopes = alias(authorizationScopes, 'student_import_actor_scopes')

export class StudentImportForbiddenError extends Error {
  constructor() {
    super('Student import is outside actor authority')
    this.name = 'StudentImportForbiddenError'
  }
}

export class StudentImportConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StudentImportConfigurationError'
  }
}

export class StudentImportCommitConflictError extends Error {
  constructor() {
    super('Student data changed after preview')
    this.name = 'StudentImportCommitConflictError'
  }
}

function getConstraintName(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined
  }

  const record = error as Record<string, unknown>

  if (typeof record.constraint_name === 'string') {
    return record.constraint_name
  }

  return getConstraintName(record.cause)
}

function isImportUniqueConflict(error: unknown): boolean {
  return [
    'users_username_unique',
    'users_email_unique',
    'student_profiles_student_code_unique',
  ].includes(getConstraintName(error) ?? '')
}

function actorPermissionBaseQuery(database: QueryDatabase) {
  return database
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
}

async function hasImportPermission(database: QueryDatabase, actorUserId: string): Promise<boolean> {
  const rows = await actorPermissionBaseQuery(database)
    .where(
      and(
        eq(actorUsers.id, actorUserId),
        eq(actorUsers.status, 'ACTIVE'),
        eq(actorPermissions.code, 'student.import'),
      ),
    )
    .limit(1)

  return rows.length > 0
}

function classAccessQuery(database: QueryDatabase, actorUserId: string) {
  return actorPermissionBaseQuery(database).where(
    and(
      eq(actorUsers.id, actorUserId),
      eq(actorUsers.status, 'ACTIVE'),
      eq(actorPermissions.code, 'student.import'),
      or(
        eq(actorScopes.scopeType, 'GLOBAL'),
        and(
          eq(actorScopes.scopeType, 'FACULTY'),
          eq(actorScopes.facultyId, academicClasses.facultyId),
        ),
        and(eq(actorScopes.scopeType, 'CLASS'), eq(actorScopes.classId, academicClasses.id)),
      ),
    ),
  )
}

async function findImportableClasses(
  database: QueryDatabase,
  actorUserId: string,
  classCodes: readonly string[],
): Promise<ImportableAcademicClass[]> {
  if (classCodes.length === 0) {
    return []
  }

  return database
    .select({
      id: academicClasses.id,
      code: academicClasses.code,
    })
    .from(academicClasses)
    .innerJoin(faculties, eq(academicClasses.facultyId, faculties.id))
    .where(
      and(
        inArray(sql<string>`upper(${academicClasses.code})`, classCodes),
        eq(academicClasses.status, 'ACTIVE'),
        eq(faculties.status, 'ACTIVE'),
        exists(classAccessQuery(database, actorUserId)),
      ),
    )
}

async function findExistingIdentities(
  database: QueryDatabase,
  input: Pick<InspectStudentImportInput, 'usernames' | 'emails' | 'studentCodes'>,
): Promise<ExistingStudentImportIdentity[]> {
  const conditions = []

  if (input.usernames.length > 0) {
    conditions.push(inArray(sql<string>`lower(${users.username})`, input.usernames))
  }
  if (input.emails.length > 0) {
    conditions.push(inArray(sql<string>`lower(${users.email})`, input.emails))
  }
  if (input.studentCodes.length > 0) {
    conditions.push(inArray(sql<string>`upper(${studentProfiles.studentCode})`, input.studentCodes))
  }

  if (conditions.length === 0) {
    return []
  }

  return database
    .select({
      username: users.username,
      email: users.email,
      studentCode: studentProfiles.studentCode,
    })
    .from(users)
    .leftJoin(studentProfiles, eq(users.id, studentProfiles.userId))
    .where(or(...conditions))
}

async function canAccessClass(
  database: QueryDatabase,
  actorUserId: string,
  classId: string,
): Promise<boolean> {
  const rows = await database
    .select({ id: academicClasses.id })
    .from(academicClasses)
    .innerJoin(faculties, eq(academicClasses.facultyId, faculties.id))
    .where(
      and(
        eq(academicClasses.id, classId),
        eq(academicClasses.status, 'ACTIVE'),
        eq(faculties.status, 'ACTIVE'),
        exists(classAccessQuery(database, actorUserId)),
      ),
    )
    .limit(1)

  return rows.length > 0
}

export class DrizzleStudentImportRepository implements StudentImportRepository {
  constructor(private readonly database: typeof db = db) {}

  async inspect(input: InspectStudentImportInput): Promise<InspectStudentImportResult> {
    if (!(await hasImportPermission(this.database, input.actorUserId))) {
      throw new StudentImportForbiddenError()
    }

    const [classes, existing] = await Promise.all([
      findImportableClasses(this.database, input.actorUserId, input.classCodes),
      findExistingIdentities(this.database, input),
    ])

    return { classes, existing }
  }

  async commit(input: CommitStudentImportInput): Promise<StudentImportCommitResult> {
    try {
      return await this.database.transaction(async (transaction) => {
        const [lockedPreview] = await transaction
          .select({ id: studentImportPreviews.id })
          .from(studentImportPreviews)
          .where(
            and(
              eq(studentImportPreviews.id, input.previewId),
              eq(studentImportPreviews.actorUserId, input.actorUserId),
              eq(studentImportPreviews.status, 'PROCESSING'),
              eq(studentImportPreviews.lockedBy, input.acquisitionId),
              gt(studentImportPreviews.expiresAt, input.occurredAt),
            ),
          )
          .for('update')
          .limit(1)

        if (!lockedPreview) {
          throw new StudentImportCommitConflictError()
        }

        if (!(await hasImportPermission(transaction, input.actorUserId))) {
          throw new StudentImportForbiddenError()
        }

        const uniqueClassCodes = [...new Set(input.rows.map((row) => row.classCode))]
        const importableClasses = await findImportableClasses(
          transaction,
          input.actorUserId,
          uniqueClassCodes,
        )
        const classesByCode = new Map(
          importableClasses.map((academicClass) => [
            academicClass.code.toUpperCase(),
            academicClass,
          ]),
        )

        if (classesByCode.size !== uniqueClassCodes.length) {
          throw new StudentImportForbiddenError()
        }

        const [studentRole] = await transaction
          .select({ id: roles.id })
          .from(roles)
          .where(eq(roles.code, 'STUDENT'))
          .limit(1)

        if (!studentRole) {
          throw new StudentImportConfigurationError('STUDENT role is not configured')
        }

        let imported = 0
        let updated = 0
        let skipped = input.preSkipped

        for (const row of input.rows) {
          const academicClass = classesByCode.get(row.classCode)

          if (!academicClass) {
            throw new StudentImportForbiddenError()
          }

          const [profileByCode] = await transaction
            .select({
              userId: studentProfiles.userId,
            })
            .from(studentProfiles)
            .where(eq(sql<string>`upper(${studentProfiles.studentCode})`, row.studentCode))
            .limit(1)

          const userConditions = [
            eq(sql<string>`lower(${users.username})`, row.username),
            eq(sql<string>`lower(${users.email})`, row.email),
          ]

          if (profileByCode) {
            userConditions.push(eq(users.id, profileByCode.userId))
          }

          const matchingUsers = await transaction
            .select({
              id: users.id,
            })
            .from(users)
            .where(or(...userConditions))
            .for('update')

          const matchingUserIds = [...new Set(matchingUsers.map((user) => user.id))]

          if (matchingUserIds.length > 1) {
            throw new StudentImportCommitConflictError()
          }

          const existingUserId = matchingUserIds[0]

          if (existingUserId) {
            if (input.duplicateStrategy === 'SKIP') {
              skipped += 1
              continue
            }

            if (input.duplicateStrategy === 'FAIL') {
              throw new StudentImportCommitConflictError()
            }

            const [profile] = await transaction
              .select({
                classId: studentProfiles.classId,
              })
              .from(studentProfiles)
              .where(eq(studentProfiles.userId, existingUserId))
              .for('update')
              .limit(1)

            if (
              !profile ||
              !(await canAccessClass(transaction, input.actorUserId, profile.classId))
            ) {
              throw new StudentImportCommitConflictError()
            }

            await transaction
              .update(users)
              .set({
                username: row.username,
                email: row.email,
                fullName: row.fullName,
                updatedAt: input.occurredAt,
              })
              .where(eq(users.id, existingUserId))

            await transaction
              .update(studentProfiles)
              .set({
                studentCode: row.studentCode,
                classId: academicClass.id,
                updatedAt: input.occurredAt,
              })
              .where(eq(studentProfiles.userId, existingUserId))

            await transaction
              .insert(userRoles)
              .values({
                userId: existingUserId,
                roleId: studentRole.id,
                assignedAt: input.occurredAt,
              })
              .onConflictDoNothing()

            updated += 1
            continue
          }

          const [createdUser] = await transaction
            .insert(users)
            .values({
              username: row.username,
              email: row.email,
              fullName: row.fullName,
              passwordHash: null,
              status: 'INVITED',
              mustChangePassword: false,
              invitedAt: input.occurredAt,
              lastInvitationSentAt: null,
              activatedAt: null,
              createdAt: input.occurredAt,
              updatedAt: input.occurredAt,
            })
            .returning({ id: users.id })

          if (!createdUser) {
            throw new Error('Failed to create imported student')
          }

          await transaction.insert(userRoles).values({
            userId: createdUser.id,
            roleId: studentRole.id,
            assignedAt: input.occurredAt,
          })

          await transaction.insert(studentProfiles).values({
            userId: createdUser.id,
            studentCode: row.studentCode,
            classId: academicClass.id,
            createdAt: input.occurredAt,
            updatedAt: input.occurredAt,
          })

          await transaction.insert(invitationDeliveryJobs).values({
            userId: createdUser.id,
            createdByUserId: input.actorUserId,
            actorUsername: input.actorUsername,
            status: 'PENDING',
            attempts: 0,
            maxAttempts: 3,
            nextAttemptAt: input.occurredAt,
            createdAt: input.occurredAt,
            updatedAt: input.occurredAt,
          })

          imported += 1
        }

        await transaction.insert(auditLogs).values({
          occurredAt: input.occurredAt,
          actorType: 'USER',
          actorUserId: input.actorUserId,
          actorUsername: input.actorUsername,
          action: 'STUDENT_IMPORT_COMMIT',
          resourceType: 'STUDENT_IMPORT',
          resourceId: input.previewId,
          outcome: 'SUCCESS',
          ...input.audit,
          metadata: {
            fileName: input.fileName,
            duplicateStrategy: input.duplicateStrategy,
          },
          before: null,
          after: {
            imported,
            updated,
            skipped,
            processed: input.previewTotalRows,
          },
        })

        const [consumedPreview] = await transaction
          .update(studentImportPreviews)
          .set({
            status: 'CONSUMED',
            lockedAt: null,
            lockedBy: null,
            consumedAt: input.occurredAt,
          })
          .where(
            and(
              eq(studentImportPreviews.id, input.previewId),
              eq(studentImportPreviews.actorUserId, input.actorUserId),
              eq(studentImportPreviews.status, 'PROCESSING'),
              eq(studentImportPreviews.lockedBy, input.acquisitionId),
            ),
          )
          .returning({ id: studentImportPreviews.id })

        if (!consumedPreview) {
          throw new StudentImportCommitConflictError()
        }

        return { imported, updated, skipped }
      })
    } catch (error) {
      if (isImportUniqueConflict(error)) {
        throw new StudentImportCommitConflictError()
      }
      throw error
    }
  }
}
