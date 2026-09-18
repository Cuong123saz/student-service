import { and, asc, eq, gt, ilike, inArray, isNull, or } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'

import { db } from '../../db/client.js'
import { auditLogs } from '../audit/audit.schema.js'
import { SYSTEM_ROLES, type SystemRoleCode } from '../auth/auth.constants.js'
import { roles, userRoles, users } from '../auth/auth.schema.js'
import {
  authorizationScopes,
  permissions,
  rolePermissions,
  userRoleScopes,
  type AuthorizationScopeType,
} from '../auth/authorization.schema.js'
import {
  academicAdvisorAssignments,
  academicClasses,
  faculties,
  organizationalUnits,
  studentProfiles,
} from '../organizations/organization.schema.js'
import {
  assertCanAssignRoles,
  EmptyRoleAssignmentError,
  ForbiddenRoleAssignmentError,
} from './role-assignment-policy.js'
import type {
  AccessRole,
  AccessScope,
  ManagedAccessUser,
  ReplaceUserAccessInput,
  UserAccessRepository,
  UserAccessSnapshot,
} from './user-access.service.js'

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

const classFaculties = alias(faculties, 'user_access_class_faculties')

const SYSTEM_ROLE_CODES = new Set<string>(SYSTEM_ROLES.map((role) => role.code))

const ROLE_SCOPE_TYPES: Record<SystemRoleCode, readonly AuthorizationScopeType[]> = {
  SYSTEM_ADMIN: ['GLOBAL'],
  ADMIN: ['GLOBAL', 'FACULTY', 'CLASS', 'ORGANIZATION'],
  STUDENT: [],
  ACADEMIC_ADVISOR: ['CLASS'],
  FACULTY_REVIEWER: ['FACULTY'],
  DOCUMENT_SIGNER: ['ORGANIZATION'],
}

interface ScopeRow {
  id: string
  type: AuthorizationScopeType
  facultyId: string | null
  classId: string | null
  classFacultyId: string | null
  organizationalUnitId: string | null
  facultyCode: string | null
  facultyName: string | null
  facultyStatus: string | null
  classCode: string | null
  className: string | null
  classStatus: string | null
  classFacultyCode: string | null
  classFacultyStatus: string | null
  organizationalUnitCode: string | null
  organizationalUnitName: string | null
  organizationalUnitStatus: string | null
}

interface ActorContext {
  roleCodes: SystemRoleCode[]
  authorityScopes: ScopeRow[]
}

export class UserAccessForbiddenError extends Error {
  constructor() {
    super('User access target is outside actor authority')
    this.name = 'UserAccessForbiddenError'
  }
}

export class UserAccessNotFoundError extends Error {
  constructor(readonly field: 'userId' | 'roleCode' | 'scopeId') {
    super(`${field} does not reference an existing record`)
    this.name = 'UserAccessNotFoundError'
  }
}

export class UserAccessValidationError extends Error {
  constructor(
    readonly field: 'assignments' | 'scopeIds',
    message: string,
  ) {
    super(message)
    this.name = 'UserAccessValidationError'
  }
}

export class UserAccessConflictError extends Error {
  constructor(
    readonly field: 'userId' | 'assignments',
    message: string,
  ) {
    super(message)
    this.name = 'UserAccessConflictError'
  }
}

function isSystemRoleCode(value: string): value is SystemRoleCode {
  return SYSTEM_ROLE_CODES.has(value)
}

function canAssignRoles(
  actorRoles: readonly string[],
  targetRoles: readonly SystemRoleCode[],
): boolean {
  if (targetRoles.length === 0) return true

  try {
    assertCanAssignRoles(actorRoles, targetRoles)
    return true
  } catch (error: unknown) {
    if (error instanceof ForbiddenRoleAssignmentError || error instanceof EmptyRoleAssignmentError)
      return false
    throw error
  }
}

function isScopeActive(scope: ScopeRow): boolean {
  if (scope.type === 'GLOBAL') return true
  if (scope.type === 'FACULTY') {
    return scope.facultyStatus === 'ACTIVE'
  }
  if (scope.type === 'CLASS') {
    return scope.classStatus === 'ACTIVE' && scope.classFacultyStatus === 'ACTIVE'
  }
  return scope.organizationalUnitStatus === 'ACTIVE'
}

function scopeTargetId(scope: ScopeRow): string | null {
  if (scope.type === 'FACULTY') return scope.facultyId
  if (scope.type === 'CLASS') return scope.classId
  if (scope.type === 'ORGANIZATION') {
    return scope.organizationalUnitId
  }
  return null
}

function scopeLabel(scope: ScopeRow): string {
  if (scope.type === 'GLOBAL') return 'Toàn hệ thống'
  if (scope.type === 'FACULTY') {
    return `${scope.facultyCode ?? ''} · ${scope.facultyName ?? ''}`
  }
  if (scope.type === 'CLASS') {
    const faculty = scope.classFacultyCode ? ` · ${scope.classFacultyCode}` : ''
    return `${scope.classCode ?? ''} · ${scope.className ?? ''}${faculty}`
  }
  return `${scope.organizationalUnitCode ?? ''} · ${scope.organizationalUnitName ?? ''}`
}

function coversScope(authority: ScopeRow, target: ScopeRow): boolean {
  if (authority.type === 'GLOBAL') return true
  if (authority.type === 'FACULTY' && target.type === 'FACULTY')
    return authority.facultyId === target.facultyId
  if (authority.type === 'FACULTY' && target.type === 'CLASS')
    return authority.facultyId === target.classFacultyId
  if (authority.type === 'CLASS' && target.type === 'CLASS')
    return authority.classId === target.classId
  if (authority.type === 'ORGANIZATION' && target.type === 'ORGANIZATION') {
    return authority.organizationalUnitId === target.organizationalUnitId
  }
  return false
}

function actorCoversScope(authorityScopes: ScopeRow[], target: ScopeRow): boolean {
  return authorityScopes.some((scope) => coversScope(scope, target))
}

function actorCoversStudentClass(
  authorityScopes: ScopeRow[],
  classId: string | null,
  facultyId: string | null,
): boolean {
  if (!classId || !facultyId) return false
  return authorityScopes.some(
    (scope) =>
      scope.type === 'GLOBAL' ||
      (scope.type === 'FACULTY' && scope.facultyId === facultyId) ||
      (scope.type === 'CLASS' && scope.classId === classId),
  )
}

function canSeeTarget(
  actor: ActorContext,
  targetRoleCodes: SystemRoleCode[],
  targetScopes: ScopeRow[],
  studentClassId: string | null,
  studentFacultyId: string | null,
): boolean {
  if (actor.authorityScopes.some((scope) => scope.type === 'GLOBAL')) {
    return true
  }
  if (!canAssignRoles(actor.roleCodes, targetRoleCodes)) {
    return false
  }
  if (actorCoversStudentClass(actor.authorityScopes, studentClassId, studentFacultyId)) return true
  return (
    targetScopes.length > 0 &&
    targetScopes.every((scope) => actorCoversScope(actor.authorityScopes, scope))
  )
}

function normalizeAssignments(input: ReplaceUserAccessInput['assignments']) {
  if (input.length === 0) {
    throw new UserAccessValidationError('assignments', 'At least one role assignment is required')
  }

  const seenRoles = new Set<SystemRoleCode>()
  return input.map((assignment) => {
    if (seenRoles.has(assignment.roleCode)) {
      throw new UserAccessValidationError('assignments', 'Each role can appear only once')
    }
    seenRoles.add(assignment.roleCode)
    return {
      roleCode: assignment.roleCode,
      scopeIds: [...new Set(assignment.scopeIds)],
    }
  })
}

export class DrizzleUserAccessRepository implements UserAccessRepository {
  constructor(private readonly database: typeof db = db) {}

  private async getScopeRows(transaction: Transaction): Promise<ScopeRow[]> {
    const rows = await transaction
      .select({
        id: authorizationScopes.id,
        type: authorizationScopes.scopeType,
        facultyId: authorizationScopes.facultyId,
        classId: authorizationScopes.classId,
        classFacultyId: academicClasses.facultyId,
        organizationalUnitId: authorizationScopes.organizationalUnitId,
        facultyCode: faculties.code,
        facultyName: faculties.name,
        facultyStatus: faculties.status,
        classCode: academicClasses.code,
        className: academicClasses.name,
        classStatus: academicClasses.status,
        classFacultyCode: classFaculties.code,
        classFacultyStatus: classFaculties.status,
        organizationalUnitCode: organizationalUnits.code,
        organizationalUnitName: organizationalUnits.name,
        organizationalUnitStatus: organizationalUnits.status,
      })
      .from(authorizationScopes)
      .leftJoin(faculties, eq(authorizationScopes.facultyId, faculties.id))
      .leftJoin(academicClasses, eq(authorizationScopes.classId, academicClasses.id))
      .leftJoin(classFaculties, eq(academicClasses.facultyId, classFaculties.id))
      .leftJoin(
        organizationalUnits,
        eq(authorizationScopes.organizationalUnitId, organizationalUnits.id),
      )

    return rows.map((row) => ({
      ...row,
      type: row.type as AuthorizationScopeType,
    }))
  }

  private async getActorContext(
    transaction: Transaction,
    actorUserId: string,
    scopeRows: ScopeRow[],
  ): Promise<ActorContext> {
    const actorRoleRows = await transaction
      .select({ code: roles.code })
      .from(users)
      .innerJoin(userRoles, eq(users.id, userRoles.userId))
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(and(eq(users.id, actorUserId), eq(users.status, 'ACTIVE')))

    const actorScopeRows = await transaction
      .select({ scopeId: userRoleScopes.scopeId })
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
      .where(
        and(
          eq(users.id, actorUserId),
          eq(users.status, 'ACTIVE'),
          eq(permissions.code, 'role.manage'),
        ),
      )

    const scopeById = new Map(scopeRows.map((scope) => [scope.id, scope]))

    return {
      roleCodes: actorRoleRows.map((row) => row.code).filter(isSystemRoleCode),
      authorityScopes: actorScopeRows
        .map((row) => scopeById.get(row.scopeId))
        .filter((scope): scope is ScopeRow => Boolean(scope)),
    }
  }

  async getSnapshot(input: { actorUserId: string; search?: string }): Promise<UserAccessSnapshot> {
    return this.database.transaction(async (transaction) => {
      const scopeRows = await this.getScopeRows(transaction)
      const actor = await this.getActorContext(transaction, input.actorUserId, scopeRows)

      if (actor.authorityScopes.length === 0) {
        return { users: [], roles: [], scopes: [] }
      }

      const normalizedSearch = input.search?.trim()
      const pattern = normalizedSearch
        ? `%${normalizedSearch
            .replaceAll('\\', '\\\\')
            .replaceAll('%', '\\%')
            .replaceAll('_', '\\_')}%`
        : undefined
      const userRows = await transaction
        .select({
          id: users.id,
          username: users.username,
          fullName: users.fullName,
          email: users.email,
          status: users.status,
        })
        .from(users)
        .where(
          pattern
            ? or(
                ilike(users.username, pattern),
                ilike(users.fullName, pattern),
                ilike(users.email, pattern),
              )
            : undefined,
        )
        .orderBy(asc(users.fullName), asc(users.username))
        .limit(100)

      const userIds = userRows.map((user) => user.id)
      if (userIds.length === 0) {
        return {
          users: [],
          roles: await this.getAssignableRoles(transaction, actor, scopeRows),
          scopes: this.getAssignableScopes(actor, scopeRows),
        }
      }

      const assignmentRows = await transaction
        .select({
          userId: userRoles.userId,
          roleCode: roles.code,
          roleName: roles.name,
          scopeId: userRoleScopes.scopeId,
        })
        .from(userRoles)
        .innerJoin(roles, eq(userRoles.roleId, roles.id))
        .leftJoin(
          userRoleScopes,
          and(
            eq(userRoleScopes.userId, userRoles.userId),
            eq(userRoleScopes.roleId, userRoles.roleId),
          ),
        )
        .where(inArray(userRoles.userId, userIds))
        .orderBy(asc(roles.code))

      const studentRows = await transaction
        .select({
          userId: studentProfiles.userId,
          studentCode: studentProfiles.studentCode,
          classId: studentProfiles.classId,
          facultyId: academicClasses.facultyId,
        })
        .from(studentProfiles)
        .innerJoin(academicClasses, eq(studentProfiles.classId, academicClasses.id))
        .where(inArray(studentProfiles.userId, userIds))

      const scopeById = new Map(scopeRows.map((scope) => [scope.id, scope]))
      const studentByUserId = new Map(studentRows.map((profile) => [profile.userId, profile]))
      const assignmentsByUser = new Map<
        string,
        Map<SystemRoleCode, { roleName: string; scopeIds: string[] }>
      >()

      for (const row of assignmentRows) {
        if (!isSystemRoleCode(row.roleCode)) continue
        let roleMap = assignmentsByUser.get(row.userId)
        if (!roleMap) {
          roleMap = new Map()
          assignmentsByUser.set(row.userId, roleMap)
        }
        let assignment = roleMap.get(row.roleCode)
        if (!assignment) {
          assignment = { roleName: row.roleName, scopeIds: [] }
          roleMap.set(row.roleCode, assignment)
        }
        if (row.scopeId) assignment.scopeIds.push(row.scopeId)
      }

      const visibleUsers: ManagedAccessUser[] = []
      for (const user of userRows) {
        const roleMap = assignmentsByUser.get(user.id) ?? new Map()
        const roleCodes = [...roleMap.keys()]
        const targetScopes = [...roleMap.values()]
          .flatMap((assignment) => assignment.scopeIds)
          .map((scopeId) => scopeById.get(scopeId))
          .filter((scope): scope is ScopeRow => Boolean(scope))
        const student = studentByUserId.get(user.id)
        const visible =
          user.id === input.actorUserId ||
          canSeeTarget(
            actor,
            roleCodes,
            targetScopes,
            student?.classId ?? null,
            student?.facultyId ?? null,
          )

        if (!visible) continue
        visibleUsers.push({
          ...user,
          studentCode: student?.studentCode ?? null,
          assignments: [...roleMap.entries()].map(([roleCode, assignment]) => ({
            roleCode,
            roleName: assignment.roleName,
            scopeIds: assignment.scopeIds,
          })),
          canManage: user.id !== input.actorUserId && canAssignRoles(actor.roleCodes, roleCodes),
        })
      }

      return {
        users: visibleUsers,
        roles: await this.getAssignableRoles(transaction, actor, scopeRows),
        scopes: this.getAssignableScopes(actor, scopeRows),
      }
    })
  }

  private getAssignableScopes(actor: ActorContext, scopeRows: ScopeRow[]): AccessScope[] {
    return scopeRows
      .filter((scope) => isScopeActive(scope) && actorCoversScope(actor.authorityScopes, scope))
      .map((scope) => ({
        id: scope.id,
        type: scope.type,
        label: scopeLabel(scope),
        targetId: scopeTargetId(scope),
      }))
      .sort((left, right) => left.label.localeCompare(right.label, 'vi'))
  }

  private async getAssignableRoles(
    transaction: Transaction,
    actor: ActorContext,
    scopeRows: ScopeRow[],
  ): Promise<AccessRole[]> {
    const rows = await transaction
      .select({
        id: roles.id,
        code: roles.code,
        name: roles.name,
        description: roles.description,
        permission: permissions.code,
      })
      .from(roles)
      .leftJoin(rolePermissions, eq(roles.id, rolePermissions.roleId))
      .leftJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(inArray(roles.code, [...SYSTEM_ROLE_CODES]))
      .orderBy(asc(roles.code), asc(permissions.code))

    const roleMap = new Map<SystemRoleCode, AccessRole>()
    const assignableScopes = this.getAssignableScopes(actor, scopeRows)
    for (const row of rows) {
      if (!isSystemRoleCode(row.code)) continue
      if (!canAssignRoles(actor.roleCodes, [row.code])) continue
      const allowedScopeTypes = [...ROLE_SCOPE_TYPES[row.code]]
      if (
        allowedScopeTypes.length > 0 &&
        !assignableScopes.some((scope) => allowedScopeTypes.includes(scope.type))
      )
        continue

      let role = roleMap.get(row.code)
      if (!role) {
        role = {
          id: row.id,
          code: row.code,
          name: row.name,
          description: row.description,
          allowedScopeTypes,
          permissions: [],
        }
        roleMap.set(row.code, role)
      }
      if (row.permission) role.permissions.push(row.permission)
    }
    return [...roleMap.values()]
  }

  async replaceAssignments(input: ReplaceUserAccessInput): Promise<void> {
    await this.database.transaction(async (transaction) => {
      if (input.actor.userId === input.targetUserId) {
        throw new UserAccessConflictError('userId', 'You cannot change your own access assignments')
      }

      const scopeRows = await this.getScopeRows(transaction)
      const scopeById = new Map(scopeRows.map((scope) => [scope.id, scope]))
      const actor = await this.getActorContext(transaction, input.actor.userId, scopeRows)
      if (actor.authorityScopes.length === 0) {
        throw new UserAccessForbiddenError()
      }

      const [target] = await transaction
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, input.targetUserId))
        .limit(1)
      if (!target) throw new UserAccessNotFoundError('userId')

      const currentRows = await transaction
        .select({
          roleCode: roles.code,
          scopeId: userRoleScopes.scopeId,
        })
        .from(userRoles)
        .innerJoin(roles, eq(userRoles.roleId, roles.id))
        .leftJoin(
          userRoleScopes,
          and(
            eq(userRoleScopes.userId, userRoles.userId),
            eq(userRoleScopes.roleId, userRoles.roleId),
          ),
        )
        .where(eq(userRoles.userId, target.id))

      const currentRoleCodes = [
        ...new Set(currentRows.map((row) => row.roleCode).filter(isSystemRoleCode)),
      ]
      const currentScopes = currentRows
        .map((row) => (row.scopeId ? scopeById.get(row.scopeId) : undefined))
        .filter((scope): scope is ScopeRow => Boolean(scope))
      const [student] = await transaction
        .select({
          classId: studentProfiles.classId,
          facultyId: academicClasses.facultyId,
        })
        .from(studentProfiles)
        .innerJoin(academicClasses, eq(studentProfiles.classId, academicClasses.id))
        .where(eq(studentProfiles.userId, target.id))
        .limit(1)

      if (
        !canAssignRoles(actor.roleCodes, currentRoleCodes) ||
        !canSeeTarget(
          actor,
          currentRoleCodes,
          currentScopes,
          student?.classId ?? null,
          student?.facultyId ?? null,
        )
      )
        throw new UserAccessForbiddenError()

      const assignments = normalizeAssignments(input.assignments)
      const requestedRoleCodes = assignments.map((row) => row.roleCode)
      assertCanAssignRoles(actor.roleCodes, requestedRoleCodes)

      if (requestedRoleCodes.includes('STUDENT') !== Boolean(student)) {
        throw new UserAccessValidationError(
          'assignments',
          'STUDENT role must match the existing student profile',
        )
      }

      const roleRows = await transaction
        .select({ id: roles.id, code: roles.code })
        .from(roles)
        .where(inArray(roles.code, requestedRoleCodes))
      const roleIdByCode = new Map(
        roleRows.filter((row) => isSystemRoleCode(row.code)).map((row) => [row.code, row.id]),
      )
      if (roleIdByCode.size !== requestedRoleCodes.length) {
        throw new UserAccessNotFoundError('roleCode')
      }

      for (const assignment of assignments) {
        const allowedTypes = ROLE_SCOPE_TYPES[assignment.roleCode]
        if (assignment.roleCode === 'STUDENT') {
          if (assignment.scopeIds.length > 0) {
            throw new UserAccessValidationError(
              'scopeIds',
              'STUDENT role does not accept authorization scopes',
            )
          }
          continue
        }
        if (assignment.scopeIds.length === 0) {
          throw new UserAccessValidationError(
            'scopeIds',
            `${assignment.roleCode} requires at least one scope`,
          )
        }

        for (const scopeId of assignment.scopeIds) {
          const scope = scopeById.get(scopeId)
          if (!scope) throw new UserAccessNotFoundError('scopeId')
          if (!isScopeActive(scope) || !allowedTypes.includes(scope.type)) {
            throw new UserAccessValidationError(
              'scopeIds',
              `Scope is not active or compatible with ${assignment.roleCode}`,
            )
          }
          if (!actorCoversScope(actor.authorityScopes, scope)) {
            throw new UserAccessForbiddenError()
          }
        }

        if (
          assignment.roleCode === 'SYSTEM_ADMIN' &&
          (assignment.scopeIds.length !== 1 ||
            scopeById.get(assignment.scopeIds[0]!)?.type !== 'GLOBAL')
        ) {
          throw new UserAccessValidationError(
            'scopeIds',
            'SYSTEM_ADMIN must have exactly the GLOBAL scope',
          )
        }
      }

      if (
        currentRoleCodes.includes('ACADEMIC_ADVISOR') &&
        !requestedRoleCodes.includes('ACADEMIC_ADVISOR')
      ) {
        const [activeAssignment] = await transaction
          .select({ id: academicAdvisorAssignments.id })
          .from(academicAdvisorAssignments)
          .where(
            and(
              eq(academicAdvisorAssignments.advisorUserId, target.id),
              eq(academicAdvisorAssignments.status, 'ACTIVE'),
              or(
                isNull(academicAdvisorAssignments.validTo),
                gt(academicAdvisorAssignments.validTo, input.changedAt),
              ),
            ),
          )
          .limit(1)
        if (activeAssignment) {
          throw new UserAccessConflictError(
            'assignments',
            'End active advisor assignments before removing the role',
          )
        }
      }

      const serialize = (rows: Array<{ roleCode: string; scopeId: string | null }>) =>
        rows.map((row) => `${row.roleCode}:${row.scopeId ?? 'NONE'}`).sort()
      const before = serialize(currentRows)
      const after = assignments
        .flatMap((assignment) =>
          assignment.scopeIds.length
            ? assignment.scopeIds.map((scopeId) => `${assignment.roleCode}:${scopeId}`)
            : [`${assignment.roleCode}:NONE`],
        )
        .sort()
      if (JSON.stringify(before) === JSON.stringify(after)) {
        throw new UserAccessConflictError('assignments', 'Access assignments have not changed')
      }

      await transaction.delete(userRoles).where(eq(userRoles.userId, target.id))
      await transaction.insert(userRoles).values(
        assignments.map((assignment) => ({
          userId: target.id,
          roleId: roleIdByCode.get(assignment.roleCode)!,
          assignedAt: input.changedAt,
        })),
      )
      const scopeAssignments = assignments.flatMap((assignment) =>
        assignment.scopeIds.map((scopeId) => ({
          userId: target.id,
          roleId: roleIdByCode.get(assignment.roleCode)!,
          scopeId,
          assignedAt: input.changedAt,
        })),
      )
      if (scopeAssignments.length > 0) {
        await transaction.insert(userRoleScopes).values(scopeAssignments)
      }

      await transaction.insert(auditLogs).values({
        actorType: 'USER',
        actorUserId: input.actor.userId,
        actorUsername: input.actor.username,
        action: 'ROLE_ASSIGNMENT_UPDATE',
        resourceType: 'USER',
        resourceId: target.id,
        outcome: 'SUCCESS',
        occurredAt: input.changedAt,
        requestId: input.audit.requestId,
        ipAddress: input.audit.ipAddress,
        userAgent: input.audit.userAgent,
        metadata: {},
        before: { assignments: before },
        after: { assignments: after },
      })
    })
  }
}
