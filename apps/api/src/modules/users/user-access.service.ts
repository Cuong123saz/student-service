import type { SystemRoleCode } from '../auth/auth.constants.js'
import type { AuthorizationScopeType } from '../auth/authorization.schema.js'

export interface AccessActor {
  userId: string
  username: string
}

export interface AccessAuditContext {
  requestId: string | null
  ipAddress: string | null
  userAgent: string | null
}

export interface AccessScope {
  id: string
  type: AuthorizationScopeType
  label: string
  targetId: string | null
}

export interface AccessRole {
  id: number
  code: SystemRoleCode
  name: string
  description: string | null
  allowedScopeTypes: AuthorizationScopeType[]
  permissions: string[]
}

export interface UserAccessAssignment {
  roleCode: SystemRoleCode
  roleName: string
  scopeIds: string[]
}

export interface ManagedAccessUser {
  id: string
  username: string
  fullName: string
  email: string | null
  status: string
  studentCode: string | null
  assignments: UserAccessAssignment[]
  canManage: boolean
}

export interface UserAccessSnapshot {
  users: ManagedAccessUser[]
  roles: AccessRole[]
  scopes: AccessScope[]
}

export interface ListUserAccessInput {
  actorUserId: string
  search?: string
}

export interface ReplaceUserAccessInput {
  actor: AccessActor
  audit: AccessAuditContext
  targetUserId: string
  assignments: Array<{
    roleCode: SystemRoleCode
    scopeIds: string[]
  }>
  changedAt: Date
}

export interface UserAccessRepository {
  getSnapshot(input: ListUserAccessInput): Promise<UserAccessSnapshot>

  replaceAssignments(input: ReplaceUserAccessInput): Promise<void>
}

export interface UserAccessUseCase {
  getSnapshot(input: ListUserAccessInput): Promise<UserAccessSnapshot>

  replaceAssignments(input: Omit<ReplaceUserAccessInput, 'changedAt'>): Promise<void>
}

export class UserAccessService implements UserAccessUseCase {
  constructor(
    private readonly repository: UserAccessRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  getSnapshot(input: ListUserAccessInput): Promise<UserAccessSnapshot> {
    return this.repository.getSnapshot(input)
  }

  replaceAssignments(input: Omit<ReplaceUserAccessInput, 'changedAt'>): Promise<void> {
    return this.repository.replaceAssignments({
      ...input,
      changedAt: this.clock(),
    })
  }
}
