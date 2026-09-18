import type { SystemRoleCode } from '~/types/auth'

export type AuthorizationScopeType = 'GLOBAL' | 'FACULTY' | 'CLASS' | 'ORGANIZATION'

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

export interface UserAccessApiError {
  status?: number
  field?: string
  message: string
}
