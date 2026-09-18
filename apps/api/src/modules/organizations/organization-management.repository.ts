import { and, asc, eq, gt, isNull, lte, or } from 'drizzle-orm'

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
  academicAdvisorAssignments,
  academicClasses,
  faculties,
  organizationalUnits,
} from './organization.schema.js'
import type {
  CreateAcademicClassInput,
  CreateFacultyInput,
  CreateOrganizationalUnitInput,
  ManagedFaculty,
  OrganizationManagementRepository,
  OrganizationManagementSnapshot,
  OrganizationStatus,
  SetAcademicAdvisorInput,
  UpdateAcademicClassInput,
  UpdateFacultyInput,
  UpdateOrganizationalUnitInput,
} from './organization-management.service.js'

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

interface AuthorityScope {
  scopeType: string
  facultyId: string | null
  classId: string | null
  organizationalUnitId: string | null
}

export class OrganizationForbiddenError extends Error {
  constructor() {
    super('Organization target is outside actor authority')
    this.name = 'OrganizationForbiddenError'
  }
}

export class OrganizationNotFoundError extends Error {
  constructor(readonly field: 'facultyId' | 'classId' | 'organizationalUnitId') {
    super(`${field} does not reference an existing record`)
    this.name = 'OrganizationNotFoundError'
  }
}

export class OrganizationConflictError extends Error {
  constructor(
    readonly field: 'code' | 'advisorUserId',
    message = 'Organization data conflicts with an existing record',
  ) {
    super(message)
    this.name = 'OrganizationConflictError'
  }
}

export class OrganizationInactiveError extends Error {
  constructor(readonly field: 'facultyId' | 'classId') {
    super(`${field} must reference an active record`)
    this.name = 'OrganizationInactiveError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function findPostgresCode(error: unknown): string | undefined {
  let current = error

  while (isRecord(current)) {
    if (typeof current['code'] === 'string') {
      return current['code']
    }

    current = current['cause']
  }

  return undefined
}

function isGlobal(scopes: AuthorityScope[]): boolean {
  return scopes.some((scope) => scope.scopeType === 'GLOBAL')
}

function canAccessFaculty(scopes: AuthorityScope[], facultyId: string): boolean {
  return (
    isGlobal(scopes) ||
    scopes.some((scope) => scope.scopeType === 'FACULTY' && scope.facultyId === facultyId)
  )
}

function canAccessClass(scopes: AuthorityScope[], classId: string, facultyId: string): boolean {
  return (
    canAccessFaculty(scopes, facultyId) ||
    scopes.some((scope) => scope.scopeType === 'CLASS' && scope.classId === classId)
  )
}

function canAccessOrganizationalUnit(
  scopes: AuthorityScope[],
  organizationalUnitId: string,
): boolean {
  return (
    isGlobal(scopes) ||
    scopes.some(
      (scope) =>
        scope.scopeType === 'ORGANIZATION' && scope.organizationalUnitId === organizationalUnitId,
    )
  )
}

export class DrizzleOrganizationManagementRepository implements OrganizationManagementRepository {
  constructor(private readonly database: typeof db = db) {}

  private async getAuthorityScopes(
    transaction: Transaction,
    actorUserId: string,
  ): Promise<AuthorityScope[]> {
    return transaction
      .select({
        scopeType: authorizationScopes.scopeType,
        facultyId: authorizationScopes.facultyId,
        classId: authorizationScopes.classId,
        organizationalUnitId: authorizationScopes.organizationalUnitId,
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
          eq(users.id, actorUserId),
          eq(users.status, 'ACTIVE'),
          eq(permissions.code, 'organization.manage'),
        ),
      )
  }

  private async appendAudit(
    transaction: Transaction,
    input: {
      actorUserId: string
      actorUsername: string
      action: string
      resourceType: string
      resourceId: string
      occurredAt: Date
      requestId: string | null
      ipAddress: string | null
      userAgent: string | null
      before?: Record<string, string | null>
      after?: Record<string, string | null>
    },
  ): Promise<void> {
    await transaction.insert(auditLogs).values({
      actorType: 'USER',
      actorUserId: input.actorUserId,
      actorUsername: input.actorUsername,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      outcome: 'SUCCESS',
      occurredAt: input.occurredAt,
      requestId: input.requestId,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      metadata: {},
      before: input.before ?? null,
      after: input.after ?? null,
    })
  }

  async getSnapshot(actorUserId: string, at: Date): Promise<OrganizationManagementSnapshot> {
    return this.database.transaction(async (transaction) => {
      const scopes = await this.getAuthorityScopes(transaction, actorUserId)

      if (scopes.length === 0) {
        return {
          faculties: [],
          organizationalUnits: [],
          advisors: [],
          capabilities: {
            canCreateFaculty: false,
            canCreateOrganizationalUnit: false,
          },
        }
      }

      const facultyClassRows = await transaction
        .select({
          facultyId: faculties.id,
          facultyCode: faculties.code,
          facultyName: faculties.name,
          facultyStatus: faculties.status,
          classId: academicClasses.id,
          classCode: academicClasses.code,
          className: academicClasses.name,
          classStatus: academicClasses.status,
        })
        .from(faculties)
        .leftJoin(academicClasses, eq(academicClasses.facultyId, faculties.id))
        .orderBy(asc(faculties.code), asc(academicClasses.code))

      const assignmentRows = await transaction
        .select({
          assignmentId: academicAdvisorAssignments.id,
          classId: academicAdvisorAssignments.classId,
          validFrom: academicAdvisorAssignments.validFrom,
          userId: users.id,
          username: users.username,
          fullName: users.fullName,
          email: users.email,
        })
        .from(academicAdvisorAssignments)
        .innerJoin(users, eq(academicAdvisorAssignments.advisorUserId, users.id))
        .where(
          and(
            eq(academicAdvisorAssignments.status, 'ACTIVE'),
            lte(academicAdvisorAssignments.validFrom, at),
            or(
              isNull(academicAdvisorAssignments.validTo),
              gt(academicAdvisorAssignments.validTo, at),
            ),
          ),
        )

      const assignmentByClass = new Map(assignmentRows.map((row) => [row.classId, row]))
      const facultyMap = new Map<string, ManagedFaculty>()

      for (const row of facultyClassRows) {
        const facultyAllowed = canAccessFaculty(scopes, row.facultyId)
        const classAllowed = row.classId
          ? canAccessClass(scopes, row.classId, row.facultyId)
          : false

        if (!facultyAllowed && !classAllowed) continue

        let faculty = facultyMap.get(row.facultyId)

        if (!faculty) {
          faculty = {
            id: row.facultyId,
            code: row.facultyCode,
            name: row.facultyName,
            status: row.facultyStatus as OrganizationStatus,
            canManage: facultyAllowed,
            canCreateClass: facultyAllowed,
            classes: [],
          }
          facultyMap.set(row.facultyId, faculty)
        }

        if (row.classId && row.classCode && row.className && row.classStatus) {
          const assignment = assignmentByClass.get(row.classId)

          faculty.classes.push({
            id: row.classId,
            code: row.classCode,
            name: row.className,
            status: row.classStatus as OrganizationStatus,
            canManage: classAllowed,
            currentAdvisor: assignment
              ? {
                  assignmentId: assignment.assignmentId,
                  userId: assignment.userId,
                  username: assignment.username,
                  fullName: assignment.fullName,
                  email: assignment.email,
                  validFrom: assignment.validFrom,
                }
              : null,
          })
        }
      }

      const hasAcademicScope = scopes.some(
        (scope) =>
          scope.scopeType === 'GLOBAL' ||
          scope.scopeType === 'FACULTY' ||
          scope.scopeType === 'CLASS',
      )
      const advisorRows = hasAcademicScope
        ? await transaction
            .selectDistinct({
              userId: users.id,
              username: users.username,
              fullName: users.fullName,
              email: users.email,
            })
            .from(users)
            .innerJoin(userRoles, eq(users.id, userRoles.userId))
            .innerJoin(roles, eq(userRoles.roleId, roles.id))
            .where(and(eq(users.status, 'ACTIVE'), eq(roles.code, 'ACADEMIC_ADVISOR')))
            .orderBy(asc(users.fullName))
        : []

      const organizationalUnitRows = await transaction
        .select({
          id: organizationalUnits.id,
          code: organizationalUnits.code,
          name: organizationalUnits.name,
          status: organizationalUnits.status,
        })
        .from(organizationalUnits)
        .orderBy(asc(organizationalUnits.code))

      return {
        faculties: [...facultyMap.values()],
        organizationalUnits: organizationalUnitRows
          .filter((unit) => canAccessOrganizationalUnit(scopes, unit.id))
          .map((unit) => ({
            ...unit,
            status: unit.status as OrganizationStatus,
            canManage: true,
          })),
        advisors: advisorRows,
        capabilities: {
          canCreateFaculty: isGlobal(scopes),
          canCreateOrganizationalUnit: isGlobal(scopes),
        },
      }
    })
  }

  async createFaculty(input: CreateFacultyInput): Promise<{ id: string }> {
    try {
      return await this.database.transaction(async (transaction) => {
        const scopes = await this.getAuthorityScopes(transaction, input.actor.userId)

        if (!isGlobal(scopes)) {
          throw new OrganizationForbiddenError()
        }

        const [faculty] = await transaction
          .insert(faculties)
          .values({
            code: input.code.trim().toUpperCase(),
            name: input.name.trim(),
            createdAt: input.changedAt,
            updatedAt: input.changedAt,
          })
          .returning({ id: faculties.id })

        if (!faculty) throw new Error('Faculty insert returned no row')

        await transaction.insert(authorizationScopes).values({
          scopeType: 'FACULTY',
          facultyId: faculty.id,
          createdAt: input.changedAt,
        })

        await this.appendAudit(transaction, {
          actorUserId: input.actor.userId,
          actorUsername: input.actor.username,
          action: 'FACULTY_CREATE',
          resourceType: 'FACULTY',
          resourceId: faculty.id,
          occurredAt: input.changedAt,
          ...input.audit,
          after: {
            code: input.code.trim().toUpperCase(),
            name: input.name.trim(),
            status: 'ACTIVE',
          },
        })

        return faculty
      })
    } catch (error: unknown) {
      if (findPostgresCode(error) === '23505') {
        throw new OrganizationConflictError('code')
      }
      throw error
    }
  }

  async updateFaculty(input: UpdateFacultyInput): Promise<void> {
    try {
      await this.database.transaction(async (transaction) => {
        const scopes = await this.getAuthorityScopes(transaction, input.actor.userId)
        const [current] = await transaction
          .select({
            id: faculties.id,
            code: faculties.code,
            name: faculties.name,
            status: faculties.status,
          })
          .from(faculties)
          .where(eq(faculties.id, input.facultyId))
          .limit(1)

        if (!current) {
          throw new OrganizationNotFoundError('facultyId')
        }
        if (!canAccessFaculty(scopes, current.id)) {
          throw new OrganizationForbiddenError()
        }

        const after = {
          code: input.code?.trim().toUpperCase() ?? current.code,
          name: input.name?.trim() ?? current.name,
          status: input.status ?? current.status,
        }

        await transaction
          .update(faculties)
          .set({ ...after, updatedAt: input.changedAt })
          .where(eq(faculties.id, current.id))

        await this.appendAudit(transaction, {
          actorUserId: input.actor.userId,
          actorUsername: input.actor.username,
          action: 'FACULTY_UPDATE',
          resourceType: 'FACULTY',
          resourceId: current.id,
          occurredAt: input.changedAt,
          ...input.audit,
          before: current,
          after,
        })
      })
    } catch (error: unknown) {
      if (findPostgresCode(error) === '23505') {
        throw new OrganizationConflictError('code')
      }
      throw error
    }
  }

  async createOrganizationalUnit(input: CreateOrganizationalUnitInput): Promise<{ id: string }> {
    try {
      return await this.database.transaction(async (transaction) => {
        const scopes = await this.getAuthorityScopes(transaction, input.actor.userId)

        if (!isGlobal(scopes)) {
          throw new OrganizationForbiddenError()
        }

        const after = {
          code: input.code.trim().toUpperCase(),
          name: input.name.trim(),
          status: 'ACTIVE' as const,
        }
        const [organizationalUnit] = await transaction
          .insert(organizationalUnits)
          .values({
            ...after,
            createdAt: input.changedAt,
            updatedAt: input.changedAt,
          })
          .returning({ id: organizationalUnits.id })

        if (!organizationalUnit) {
          throw new Error('Organizational unit insert returned no row')
        }

        await transaction.insert(authorizationScopes).values({
          scopeType: 'ORGANIZATION',
          organizationalUnitId: organizationalUnit.id,
          createdAt: input.changedAt,
        })

        await this.appendAudit(transaction, {
          actorUserId: input.actor.userId,
          actorUsername: input.actor.username,
          action: 'ORGANIZATIONAL_UNIT_CREATE',
          resourceType: 'ORGANIZATIONAL_UNIT',
          resourceId: organizationalUnit.id,
          occurredAt: input.changedAt,
          ...input.audit,
          after,
        })

        return organizationalUnit
      })
    } catch (error: unknown) {
      if (findPostgresCode(error) === '23505') {
        throw new OrganizationConflictError('code')
      }
      throw error
    }
  }

  async updateOrganizationalUnit(input: UpdateOrganizationalUnitInput): Promise<void> {
    try {
      await this.database.transaction(async (transaction) => {
        const scopes = await this.getAuthorityScopes(transaction, input.actor.userId)
        const [current] = await transaction
          .select({
            id: organizationalUnits.id,
            code: organizationalUnits.code,
            name: organizationalUnits.name,
            status: organizationalUnits.status,
          })
          .from(organizationalUnits)
          .where(eq(organizationalUnits.id, input.organizationalUnitId))
          .limit(1)

        if (!current) {
          throw new OrganizationNotFoundError('organizationalUnitId')
        }
        if (!canAccessOrganizationalUnit(scopes, current.id)) {
          throw new OrganizationForbiddenError()
        }

        const after = {
          code: input.code?.trim().toUpperCase() ?? current.code,
          name: input.name?.trim() ?? current.name,
          status: input.status ?? current.status,
        }

        await transaction
          .update(organizationalUnits)
          .set({ ...after, updatedAt: input.changedAt })
          .where(eq(organizationalUnits.id, current.id))

        await this.appendAudit(transaction, {
          actorUserId: input.actor.userId,
          actorUsername: input.actor.username,
          action: 'ORGANIZATIONAL_UNIT_UPDATE',
          resourceType: 'ORGANIZATIONAL_UNIT',
          resourceId: current.id,
          occurredAt: input.changedAt,
          ...input.audit,
          before: current,
          after,
        })
      })
    } catch (error: unknown) {
      if (findPostgresCode(error) === '23505') {
        throw new OrganizationConflictError('code')
      }
      throw error
    }
  }

  async createAcademicClass(input: CreateAcademicClassInput): Promise<{ id: string }> {
    try {
      return await this.database.transaction(async (transaction) => {
        const scopes = await this.getAuthorityScopes(transaction, input.actor.userId)
        const [faculty] = await transaction
          .select({ id: faculties.id, status: faculties.status })
          .from(faculties)
          .where(eq(faculties.id, input.facultyId))
          .limit(1)

        if (!faculty) {
          throw new OrganizationNotFoundError('facultyId')
        }
        if (!canAccessFaculty(scopes, faculty.id)) {
          throw new OrganizationForbiddenError()
        }
        if (faculty.status !== 'ACTIVE') {
          throw new OrganizationInactiveError('facultyId')
        }

        const [academicClass] = await transaction
          .insert(academicClasses)
          .values({
            facultyId: faculty.id,
            code: input.code.trim().toUpperCase(),
            name: input.name.trim(),
            createdAt: input.changedAt,
            updatedAt: input.changedAt,
          })
          .returning({ id: academicClasses.id })

        if (!academicClass) {
          throw new Error('Academic class insert returned no row')
        }

        await transaction.insert(authorizationScopes).values({
          scopeType: 'CLASS',
          classId: academicClass.id,
          createdAt: input.changedAt,
        })

        await this.appendAudit(transaction, {
          actorUserId: input.actor.userId,
          actorUsername: input.actor.username,
          action: 'ACADEMIC_CLASS_CREATE',
          resourceType: 'ACADEMIC_CLASS',
          resourceId: academicClass.id,
          occurredAt: input.changedAt,
          ...input.audit,
          after: {
            facultyId: faculty.id,
            code: input.code.trim().toUpperCase(),
            name: input.name.trim(),
            status: 'ACTIVE',
          },
        })

        return academicClass
      })
    } catch (error: unknown) {
      if (findPostgresCode(error) === '23505') {
        throw new OrganizationConflictError('code')
      }
      throw error
    }
  }

  async updateAcademicClass(input: UpdateAcademicClassInput): Promise<void> {
    try {
      await this.database.transaction(async (transaction) => {
        const scopes = await this.getAuthorityScopes(transaction, input.actor.userId)
        const [current] = await transaction
          .select({
            id: academicClasses.id,
            facultyId: academicClasses.facultyId,
            code: academicClasses.code,
            name: academicClasses.name,
            status: academicClasses.status,
          })
          .from(academicClasses)
          .where(eq(academicClasses.id, input.classId))
          .limit(1)

        if (!current) {
          throw new OrganizationNotFoundError('classId')
        }
        if (!canAccessClass(scopes, current.id, current.facultyId)) {
          throw new OrganizationForbiddenError()
        }

        const targetFacultyId = input.facultyId ?? current.facultyId
        const [targetFaculty] = await transaction
          .select({ id: faculties.id, status: faculties.status })
          .from(faculties)
          .where(eq(faculties.id, targetFacultyId))
          .limit(1)

        if (!targetFaculty) {
          throw new OrganizationNotFoundError('facultyId')
        }
        if (targetFacultyId !== current.facultyId && !canAccessFaculty(scopes, targetFacultyId)) {
          throw new OrganizationForbiddenError()
        }
        if (targetFaculty.status !== 'ACTIVE') {
          throw new OrganizationInactiveError('facultyId')
        }

        const after = {
          facultyId: targetFacultyId,
          code: input.code?.trim().toUpperCase() ?? current.code,
          name: input.name?.trim() ?? current.name,
          status: input.status ?? current.status,
        }

        await transaction
          .update(academicClasses)
          .set({ ...after, updatedAt: input.changedAt })
          .where(eq(academicClasses.id, current.id))

        await this.appendAudit(transaction, {
          actorUserId: input.actor.userId,
          actorUsername: input.actor.username,
          action: 'ACADEMIC_CLASS_UPDATE',
          resourceType: 'ACADEMIC_CLASS',
          resourceId: current.id,
          occurredAt: input.changedAt,
          ...input.audit,
          before: current,
          after,
        })
      })
    } catch (error: unknown) {
      if (findPostgresCode(error) === '23505') {
        throw new OrganizationConflictError('code')
      }
      throw error
    }
  }

  async setAcademicAdvisor(input: SetAcademicAdvisorInput): Promise<void> {
    try {
      await this.database.transaction(async (transaction) => {
        const scopes = await this.getAuthorityScopes(transaction, input.actor.userId)
        const [academicClass] = await transaction
          .select({
            id: academicClasses.id,
            facultyId: academicClasses.facultyId,
            status: academicClasses.status,
          })
          .from(academicClasses)
          .where(eq(academicClasses.id, input.classId))
          .limit(1)

        if (!academicClass) {
          throw new OrganizationNotFoundError('classId')
        }
        if (!canAccessClass(scopes, academicClass.id, academicClass.facultyId)) {
          throw new OrganizationForbiddenError()
        }
        if (academicClass.status !== 'ACTIVE') {
          throw new OrganizationInactiveError('classId')
        }

        const [current] = await transaction
          .select({
            id: academicAdvisorAssignments.id,
            advisorUserId: academicAdvisorAssignments.advisorUserId,
            validFrom: academicAdvisorAssignments.validFrom,
          })
          .from(academicAdvisorAssignments)
          .where(
            and(
              eq(academicAdvisorAssignments.classId, academicClass.id),
              eq(academicAdvisorAssignments.status, 'ACTIVE'),
              lte(academicAdvisorAssignments.validFrom, input.effectiveAt),
              or(
                isNull(academicAdvisorAssignments.validTo),
                gt(academicAdvisorAssignments.validTo, input.effectiveAt),
              ),
            ),
          )
          .limit(1)

        if (current?.advisorUserId === input.advisorUserId) {
          throw new OrganizationConflictError(
            'advisorUserId',
            'Advisor is already assigned to this class',
          )
        }

        if (input.advisorUserId) {
          const [advisor] = await transaction
            .select({ id: users.id })
            .from(users)
            .innerJoin(userRoles, eq(users.id, userRoles.userId))
            .innerJoin(roles, eq(userRoles.roleId, roles.id))
            .where(
              and(
                eq(users.id, input.advisorUserId),
                eq(users.status, 'ACTIVE'),
                eq(roles.code, 'ACADEMIC_ADVISOR'),
              ),
            )
            .limit(1)

          if (!advisor) {
            throw new OrganizationConflictError(
              'advisorUserId',
              'Selected user is not an active academic advisor',
            )
          }
        } else if (!current) {
          throw new OrganizationConflictError(
            'advisorUserId',
            'Class has no current advisor assignment',
          )
        }

        if (current) {
          const startsAtEffectiveTime = current.validFrom.getTime() === input.effectiveAt.getTime()

          await transaction
            .update(academicAdvisorAssignments)
            .set(
              startsAtEffectiveTime
                ? {
                    status: 'INACTIVE',
                    updatedAt: input.changedAt,
                  }
                : {
                    validTo: input.effectiveAt,
                    updatedAt: input.changedAt,
                  },
            )
            .where(eq(academicAdvisorAssignments.id, current.id))
        }

        if (input.advisorUserId) {
          await transaction.insert(academicAdvisorAssignments).values({
            advisorUserId: input.advisorUserId,
            classId: academicClass.id,
            validFrom: input.effectiveAt,
            status: 'ACTIVE',
            createdAt: input.changedAt,
            updatedAt: input.changedAt,
          })
        }

        await this.appendAudit(transaction, {
          actorUserId: input.actor.userId,
          actorUsername: input.actor.username,
          action: input.advisorUserId ? 'ACADEMIC_ADVISOR_ASSIGN' : 'ACADEMIC_ADVISOR_UNASSIGN',
          resourceType: 'ACADEMIC_CLASS',
          resourceId: academicClass.id,
          occurredAt: input.changedAt,
          ...input.audit,
          before: {
            advisorUserId: current?.advisorUserId ?? null,
          },
          after: {
            advisorUserId: input.advisorUserId,
            effectiveAt: input.effectiveAt.toISOString(),
          },
        })
      })
    } catch (error: unknown) {
      if (findPostgresCode(error) === '23P01') {
        throw new OrganizationConflictError(
          'advisorUserId',
          'Advisor assignment overlaps an existing active period',
        )
      }
      throw error
    }
  }
}
