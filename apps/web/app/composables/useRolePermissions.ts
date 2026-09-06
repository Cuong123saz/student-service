import type {
  RolePermissionApiError,
  RolePermissionSnapshot,
} from '~/types/role-permission'

function readApiError(error: unknown): RolePermissionApiError {
  if (!error || typeof error !== 'object') {
    return { message: 'Không thể kết nối tới máy chủ.' }
  }
  const candidate = error as {
    statusCode?: unknown
    response?: { status?: unknown }
    data?: {
      message?: unknown
      error?: { field?: unknown, message?: unknown }
    }
  }
  const status = typeof candidate.statusCode === 'number'
    ? candidate.statusCode
    : typeof candidate.response?.status === 'number'
      ? candidate.response.status
      : undefined
  const field = typeof candidate.data?.error?.field === 'string'
    ? candidate.data.error.field
    : undefined
  const message = candidate.data?.error?.message
    ?? candidate.data?.message
  return {
    ...(status === undefined ? {} : { status }),
    ...(field === undefined ? {} : { field }),
    message: typeof message === 'string'
      ? message
      : 'Yêu cầu chưa thể thực hiện.',
  }
}

export function useRolePermissions() {
  const config = useRuntimeConfig()
  const data = ref<RolePermissionSnapshot | null>(null)
  const isLoading = ref(false)
  const hasLoaded = ref(false)
  const errorMessage = ref('')
  const baseUrl = `${config.public.apiBase}/api/v1/admin`

  async function load(): Promise<boolean> {
    if (isLoading.value) return false
    isLoading.value = true
    errorMessage.value = ''
    try {
      data.value = await $fetch<RolePermissionSnapshot>(
        `${baseUrl}/role-permissions`,
        { credentials: 'include' },
      )
      return true
    } catch (error: unknown) {
      const parsed = readApiError(error)
      data.value = null
      errorMessage.value = parsed.status === 401
        ? 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
        : parsed.status === 403
          ? 'Chỉ quản trị hệ thống toàn cục được quản lý ma trận quyền.'
          : 'Không thể tải ma trận quyền. Vui lòng thử lại.'
      return false
    } finally {
      isLoading.value = false
      hasLoaded.value = true
    }
  }

  async function replacePermissions(
    roleId: number,
    permissionCodes: string[],
  ): Promise<void> {
    try {
      await $fetch(`${baseUrl}/roles/${roleId}/permissions`, {
        method: 'PUT',
        credentials: 'include',
        body: { permissionCodes },
      })
    } catch (error: unknown) {
      throw readApiError(error)
    }
  }

  return {
    data: readonly(data),
    isLoading: readonly(isLoading),
    hasLoaded: readonly(hasLoaded),
    errorMessage: readonly(errorMessage),
    load,
    replacePermissions,
  }
}
