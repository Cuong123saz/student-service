import { and, eq, inArray, isNull, or } from 'drizzle-orm'

import { db } from '../../db/client.js'

import { roles, userRoles, users } from '../auth/auth.schema.js'
import {
  authorizationScopes,
  permissions,
  rolePermissions,
  userRoleScopes,
} from '../auth/authorization.schema.js'
import { auditLogs } from '../audit/audit.schema.js'
import {
  academicClasses,
  faculties,
  studentProfiles,
} from '../organizations/organization.schema.js'

import { userActionTokens } from './user-account.schema.js'

import type {
  PersistInvitationInput,
  PersistResendInvitationInput,
  UserInvitationRepository,
} from './user-invitation.service.js'
import {
  StudentAcademicDataRequiredError,
  StudentAcademicDataNotAllowedError,
} from './user-invitation.service.js'

export type InvitationConflictField = 'username' | 'email' | 'studentCode'

export class InvitationConflictError extends Error {
  constructor(readonly field: InvitationConflictField) {
    super(`${field} already exists`)
    this.name = 'InvitationConflictError'
  }
}

export class AcademicClassNotFoundError extends Error {
  constructor() {
    super('Academic class not found or inactive')
    this.name = 'AcademicClassNotFoundError'
  }
}

export class AcademicClassOutsideScopeError extends Error {
  constructor() {
    super('Academic class is outside actor scope')
    this.name = 'AcademicClassOutsideScopeError'
  }
}

export class InvitationUserNotFoundError extends Error {
  constructor() {
    super('Invited user not found')
    this.name = 'InvitationUserNotFoundError'
  }
}

export class InvitationNotResendableError extends Error {
  constructor() {
    super('Invitation cannot be resent')
    this.name = 'InvitationNotResendableError'
  }
}

export class InvitationTargetForbiddenError extends Error {
  constructor() {
    super('Invitation target is outside actor authority')
    this.name = 'InvitationTargetForbiddenError'
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

function mapUniqueConflict(error: unknown): never {
  const constraint = getConstraintName(error)

  if (constraint === 'users_username_unique') {
    throw new InvitationConflictError('username')
  }

  if (constraint === 'users_email_unique') {
    throw new InvitationConflictError('email')
  }

  if (constraint === 'student_profiles_student_code_unique') {
    throw new InvitationConflictError('studentCode')
  }

  throw error
}

export class InvitationRolesNotFoundError extends Error {
  constructor(readonly missingRoles: readonly string[]) {
    super(`Roles not found: ${missingRoles.join(', ')}`)

    this.name = 'InvitationRolesNotFoundError'
  }
}

export class InvitedUserNotFoundError extends Error {
  constructor() {
    super('Invited user not found')

    this.name = 'InvitedUserNotFoundError'
  }
}

export class DrizzleUserInvitationRepository implements UserInvitationRepository {
  constructor(private readonly database: typeof db = db) {}

  async createInvitedUserWithToken(input: PersistInvitationInput): Promise<{
    userId: string
  }> {
    try {
      return await this.database.transaction(async (transaction) => {
        const includesStudentRole = input.targetRoles.includes('STUDENT')

        if (includesStudentRole && !input.studentCode) {
          throw new StudentAcademicDataRequiredError('studentCode')
        }

        if (includesStudentRole && !input.classId) {
          throw new StudentAcademicDataRequiredError('classId')
        }

        if (!includesStudentRole && input.studentCode) {
          throw new StudentAcademicDataNotAllowedError('studentCode')
        }

        if (!includesStudentRole && input.classId) {
          throw new StudentAcademicDataNotAllowedError('classId')
        }

        const conflictingUsers = await transaction
          .select({
            username: users.username,
            email: users.email,
          })
          .from(users)
          .where(or(eq(users.username, input.username), eq(users.email, input.email)))

        if (conflictingUsers.some((user) => user.username === input.username)) {
          throw new InvitationConflictError('username')
        }

        if (conflictingUsers.length > 0) {
          throw new InvitationConflictError('email')
        }

        if (input.studentCode && input.classId) {
          const existingProfiles = await transaction
            .select({
              userId: studentProfiles.userId,
            })
            .from(studentProfiles)
            .where(eq(studentProfiles.studentCode, input.studentCode))
            .limit(1)

          if (existingProfiles.length > 0) {
            throw new InvitationConflictError('studentCode')
          }

          const classes = await transaction
            .select({
              id: academicClasses.id,
              facultyId: academicClasses.facultyId,
            })
            .from(academicClasses)
            .innerJoin(faculties, eq(academicClasses.facultyId, faculties.id))
            .where(
              and(
                eq(academicClasses.id, input.classId),
                eq(academicClasses.status, 'ACTIVE'),
                eq(faculties.status, 'ACTIVE'),
              ),
            )
            .limit(1)

          const academicClass = classes[0]

          if (!academicClass) {
            throw new AcademicClassNotFoundError()
          }

          const allowedScopes = await transaction
            .select({
              scopeId: authorizationScopes.id,
            })
            .from(users)
            .innerJoin(userRoles, eq(users.id, userRoles.userId))
            .innerJoin(rolePermissions, eq(userRoles.roleId, rolePermissions.roleId))
            .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
            .innerJoin(
              userRoleScopes,
              and(
                eq(userRoleScopes.userId, userRoles.userId),
                eq(userRoleScopes.roleId, userRoles.roleId),
              ),
            )
            .innerJoin(authorizationScopes, eq(userRoleScopes.scopeId, authorizationScopes.id))
            .where(
              and(
                eq(users.id, input.createdByUserId),
                eq(users.status, 'ACTIVE'),
                eq(permissions.code, 'student.create'),
                or(
                  eq(authorizationScopes.scopeType, 'GLOBAL'),
                  and(
                    eq(authorizationScopes.scopeType, 'FACULTY'),
                    eq(authorizationScopes.facultyId, academicClass.facultyId),
                  ),
                  and(
                    eq(authorizationScopes.scopeType, 'CLASS'),
                    eq(authorizationScopes.classId, academicClass.id),
                  ),
                ),
              ),
            )
            .limit(1)

          if (allowedScopes.length === 0) {
            throw new AcademicClassOutsideScopeError()
          }
        }

        const requestedRoles = [...new Set(input.targetRoles)]

        const roleRows = await transaction
          .select({
            id: roles.id,
            code: roles.code,
          })
          .from(roles)
          .where(inArray(roles.code, requestedRoles))

        const foundRoleCodes = new Set(roleRows.map((role) => role.code))

        const missingRoles = requestedRoles.filter((role) => !foundRoleCodes.has(role))

        if (missingRoles.length > 0) {
          throw new InvitationRolesNotFoundError(missingRoles)
        }

        const insertedUsers = await transaction
          .insert(users)
          .values({
            username: input.username,
            email: input.email,
            fullName: input.fullName,
            passwordHash: null,
            status: 'INVITED',
            mustChangePassword: false,
            invitedAt: input.invitedAt,
            lastInvitationSentAt: null,
            activatedAt: null,
            createdAt: input.invitedAt,
            updatedAt: input.invitedAt,
          })
          .returning({
            id: users.id,
          })

        const insertedUser = insertedUsers[0]

        if (!insertedUser) {
          throw new Error('Failed to create invited user')
        }

        await transaction.insert(userRoles).values(
          roleRows.map((role) => ({
            userId: insertedUser.id,
            roleId: role.id,
            assignedAt: input.invitedAt,
          })),
        )

        const systemAdminRole = roleRows.find((role) => role.code === 'SYSTEM_ADMIN')

        if (systemAdminRole) {
          const [globalScope] = await transaction
            .select({
              id: authorizationScopes.id,
            })
            .from(authorizationScopes)
            .where(eq(authorizationScopes.scopeType, 'GLOBAL'))
            .limit(1)

          if (!globalScope) {
            throw new Error('GLOBAL authorization scope is not configured')
          }

          await transaction.insert(userRoleScopes).values({
            userId: insertedUser.id,
            roleId: systemAdminRole.id,
            scopeId: globalScope.id,
            assignedAt: input.invitedAt,
          })
        }

        if (input.studentCode && input.classId) {
          await transaction.insert(studentProfiles).values({
            userId: insertedUser.id,
            studentCode: input.studentCode,
            classId: input.classId,
            createdAt: input.invitedAt,
            updatedAt: input.invitedAt,
          })
        }

        await transaction.insert(userActionTokens).values({
          userId: insertedUser.id,
          purpose: 'ACCOUNT_ACTIVATION',
          tokenHash: input.tokenHash,
          expiresAt: input.tokenExpiresAt,
          createdByUserId: input.createdByUserId,
          createdAt: input.invitedAt,
        })

        await transaction.insert(auditLogs).values([
          {
            occurredAt: input.invitedAt,
            actorType: 'USER',
            actorUserId: input.createdByUserId,
            actorUsername: input.actorUsername,
            action: 'USER_INVITATION_CREATE',
            resourceType: 'USER',
            resourceId: insertedUser.id,
            outcome: 'SUCCESS',
            ...input.auditContext,
            metadata: {},
            before: null,
            after: {
              username: input.username,
              status: 'INVITED',
              studentCode: input.studentCode ?? null,
              classId: input.classId ?? null,
            },
          },
          {
            occurredAt: input.invitedAt,
            actorType: 'USER',
            actorUserId: input.createdByUserId,
            actorUsername: input.actorUsername,
            action: 'ROLE_ASSIGNMENT',
            resourceType: 'USER_ROLE',
            resourceId: insertedUser.id,
            outcome: 'SUCCESS',
            ...input.auditContext,
            metadata: {},
            before: { roles: [] },
            after: { roles: requestedRoles },
          },
        ])

        return {
          userId: insertedUser.id,
        }
      })
    } catch (error: unknown) {
      mapUniqueConflict(error)
    }
  }

  async markInvitationSent(userId: string, sentAt: Date): Promise<void> {
    const updatedUsers = await this.database
      .update(users)
      .set({
        lastInvitationSentAt: sentAt,
        updatedAt: sentAt,
      })
      .where(eq(users.id, userId))
      .returning({
        id: users.id,
      })

    if (!updatedUsers[0]) {
      throw new InvitedUserNotFoundError()
    }
  }

  async replaceActivationToken(input: PersistResendInvitationInput): Promise<{
    userId: string
    email: string
    fullName: string
  }> {
    return this.database.transaction(async (transaction) => {
      const candidates = await transaction
        .select({
          id: users.id,
          email: users.email,
          fullName: users.fullName,
          status: users.status,
          passwordHash: users.passwordHash,
          activatedAt: users.activatedAt,
          studentClassId: studentProfiles.classId,
          studentFacultyId: academicClasses.facultyId,
          classStatus: academicClasses.status,
          facultyStatus: faculties.status,
        })
        .from(users)
        .leftJoin(studentProfiles, eq(studentProfiles.userId, users.id))
        .leftJoin(academicClasses, eq(studentProfiles.classId, academicClasses.id))
        .leftJoin(faculties, eq(academicClasses.facultyId, faculties.id))
        .where(eq(users.id, input.userId))
        .limit(1)

      const candidate = candidates[0]

      if (!candidate) {
        throw new InvitationUserNotFoundError()
      }

      if (
        candidate.status !== 'INVITED' ||
        candidate.passwordHash !== null ||
        candidate.activatedAt !== null ||
        candidate.email === null
      ) {
        throw new InvitationNotResendableError()
      }

      const targetRoleRows = await transaction
        .select({ code: roles.code })
        .from(userRoles)
        .innerJoin(roles, eq(userRoles.roleId, roles.id))
        .where(eq(userRoles.userId, candidate.id))

      const isStudent = targetRoleRows.some((role) => role.code === 'STUDENT')

      if (isStudent) {
        if (
          !candidate.studentClassId ||
          !candidate.studentFacultyId ||
          candidate.classStatus !== 'ACTIVE' ||
          candidate.facultyStatus !== 'ACTIVE'
        ) {
          throw new InvitationNotResendableError()
        }

        const allowedScopes = await transaction
          .select({
            scopeId: authorizationScopes.id,
          })
          .from(users)
          .innerJoin(userRoles, eq(users.id, userRoles.userId))
          .innerJoin(rolePermissions, eq(userRoles.roleId, rolePermissions.roleId))
          .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
          .innerJoin(
            userRoleScopes,
            and(
              eq(userRoleScopes.userId, userRoles.userId),
              eq(userRoleScopes.roleId, userRoles.roleId),
            ),
          )
          .innerJoin(authorizationScopes, eq(userRoleScopes.scopeId, authorizationScopes.id))
          .where(
            and(
              eq(users.id, input.createdByUserId),
              eq(users.status, 'ACTIVE'),
              eq(permissions.code, 'student.create'),
              or(
                eq(authorizationScopes.scopeType, 'GLOBAL'),
                and(
                  eq(authorizationScopes.scopeType, 'FACULTY'),
                  eq(authorizationScopes.facultyId, candidate.studentFacultyId),
                ),
                and(
                  eq(authorizationScopes.scopeType, 'CLASS'),
                  eq(authorizationScopes.classId, candidate.studentClassId),
                ),
              ),
            ),
          )
          .limit(1)

        if (allowedScopes.length === 0) {
          throw new InvitationTargetForbiddenError()
        }
      } else {
        const allowedPermissions = await transaction
          .select({ roleId: userRoles.roleId })
          .from(users)
          .innerJoin(userRoles, eq(users.id, userRoles.userId))
          .innerJoin(rolePermissions, eq(userRoles.roleId, rolePermissions.roleId))
          .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
          .where(
            and(
              eq(users.id, input.createdByUserId),
              eq(users.status, 'ACTIVE'),
              eq(permissions.code, 'user.manage'),
            ),
          )
          .limit(1)

        if (allowedPermissions.length === 0) {
          throw new InvitationTargetForbiddenError()
        }
      }

      await transaction
        .update(userActionTokens)
        .set({ revokedAt: input.createdAt })
        .where(
          and(
            eq(userActionTokens.userId, candidate.id),
            eq(userActionTokens.purpose, 'ACCOUNT_ACTIVATION'),
            isNull(userActionTokens.consumedAt),
            isNull(userActionTokens.revokedAt),
          ),
        )

      await transaction.insert(userActionTokens).values({
        userId: candidate.id,
        purpose: 'ACCOUNT_ACTIVATION',
        tokenHash: input.tokenHash,
        expiresAt: input.tokenExpiresAt,
        createdByUserId: input.createdByUserId,
        createdAt: input.createdAt,
      })

      await transaction.insert(auditLogs).values({
        occurredAt: input.createdAt,
        actorType: 'USER',
        actorUserId: input.createdByUserId,
        actorUsername: input.actorUsername,
        action: 'INVITATION_RESEND',
        resourceType: 'USER',
        resourceId: candidate.id,
        outcome: 'SUCCESS',
        ...input.auditContext,
        metadata: {},
        before: null,
        after: {
          tokenExpiresAt: input.tokenExpiresAt.toISOString(),
        },
      })

      return {
        userId: candidate.id,
        email: candidate.email,
        fullName: candidate.fullName,
      }
    })
  }
}
