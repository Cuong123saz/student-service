export interface RolePermissionActor {
  userId: string
  username: string
}

export interface RolePermissionAuditContext {
  requestId: string | null
  ipAddress: string | null
  userAgent: string | null
}

export interface PermissionCatalogItem {
  id: number
  code: string
  name: string
  description: string | null
}

export interface ManagedRolePermissions {
  id: number
  code: string
  name: string
  description: string | null
  permissionCodes: string[]
  canManage: boolean
}

export interface RolePermissionSnapshot {
  roles: ManagedRolePermissions[]
  permissions: PermissionCatalogItem[]
}

export interface ReplaceRolePermissionsInput {
  actor: RolePermissionActor
  audit: RolePermissionAuditContext
  roleId: number
  permissionCodes: string[]
  changedAt: Date
}

export interface RolePermissionRepository {
  getSnapshot(actorUserId: string): Promise<RolePermissionSnapshot>

  replacePermissions(
    input: ReplaceRolePermissionsInput,
  ): Promise<void>
}

export interface RolePermissionUseCase {
  getSnapshot(actorUserId: string): Promise<RolePermissionSnapshot>

  replacePermissions(
    input: Omit<ReplaceRolePermissionsInput, 'changedAt'>,
  ): Promise<void>
}

export class RolePermissionService
implements RolePermissionUseCase {
  constructor(
    private readonly repository: RolePermissionRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  getSnapshot(actorUserId: string): Promise<RolePermissionSnapshot> {
    return this.repository.getSnapshot(actorUserId)
  }

  replacePermissions(
    input: Omit<ReplaceRolePermissionsInput, 'changedAt'>,
  ): Promise<void> {
    return this.repository.replacePermissions({
      ...input,
      permissionCodes: [...new Set(input.permissionCodes)].sort(),
      changedAt: this.clock(),
    })
  }
}
