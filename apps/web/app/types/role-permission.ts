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

export interface RolePermissionApiError {
  status?: number
  field?: string
  message: string
}
