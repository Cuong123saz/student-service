import type { UserAccessApiError, UserAccessSnapshot } from '~/types/user-access'
import type { SystemRoleCode } from '~/types/auth'

function parseAccessError(error: unknown): UserAccessApiError {
  if (!error || typeof error !== 'object') {
    return { message: 'Không thể kết nối tới máy chủ.' }
  }
  const candidate = error as {
    statusCode?: unknown
    response?: { status?: unknown }
    data?: {
      message?: unknown
      error?: { field?: unknown; message?: unknown }
    }
  }
  const status =
    typeof candidate.statusCode === 'number'
      ? candidate.statusCode
      : typeof candidate.response?.status === 'number'
        ? candidate.response.status
        : undefined
  const field =
    typeof candidate.data?.error?.field === 'string' ? candidate.data.error.field : undefined
  const message = candidate.data?.error?.message ?? candidate.data?.message
  return {
    ...(status === undefined ? {} : { status }),
    ...(field === undefined ? {} : { field }),
    message: typeof message === 'string' ? message : 'Yêu cầu chưa thể thực hiện.',
  }
}

export function useUserAccess() {
  const config = useRuntimeConfig()
  const data = ref<UserAccessSnapshot | null>(null)
  const isLoading = ref(false)
  const hasLoaded = ref(false)
  const errorMessage = ref('')
  const baseUrl = `${config.public.apiBase}/api/v1/admin/access-control`

  async function load(search = ''): Promise<boolean> {
    if (isLoading.value) return false
    isLoading.value = true
    errorMessage.value = ''
    try {
      data.value = await $fetch<UserAccessSnapshot>(baseUrl, {
        credentials: 'include',
        query: search.trim() ? { search: search.trim() } : undefined,
      })
      return true
    } catch (error: unknown) {
      const parsed = parseAccessError(error)
      data.value = null
      errorMessage.value =
        parsed.status === 401
          ? 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
          : parsed.status === 403
            ? 'Tài khoản chưa được cấp quyền quản lý vai trò.'
            : 'Không thể tải dữ liệu phân quyền. Vui lòng thử lại.'
      return false
    } finally {
      isLoading.value = false
      hasLoaded.value = true
    }
  }

  async function replaceAssignments(
    userId: string,
    assignments: Array<{
      roleCode: SystemRoleCode
      scopeIds: string[]
    }>,
  ) {
    try {
      await $fetch(`${baseUrl}/users/${userId}/assignments`, {
        method: 'PUT',
        credentials: 'include',
        body: { assignments },
      })
    } catch (error: unknown) {
      throw parseAccessError(error)
    }
  }

  return {
    data: readonly(data),
    isLoading: readonly(isLoading),
    hasLoaded: readonly(hasLoaded),
    errorMessage: readonly(errorMessage),
    load,
    replaceAssignments,
  }
}
