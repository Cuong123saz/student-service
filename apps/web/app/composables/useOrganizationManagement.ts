import type {
  CreateOrganizationInput,
  OrganizationApiError,
  OrganizationManagementSnapshot,
  OrganizationStatus,
} from '~/types/organization-management'

function readOrganizationError(error: unknown): OrganizationApiError {
  if (!error || typeof error !== 'object') {
    return { message: 'Không thể kết nối tới máy chủ.' }
  }

  const candidate = error as {
    statusCode?: unknown
    response?: { status?: unknown }
    data?: {
      message?: unknown
      error?: {
        field?: unknown
        message?: unknown
      }
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
  const apiMessage = candidate.data?.error?.message ?? candidate.data?.message

  return {
    ...(status === undefined ? {} : { status }),
    ...(field === undefined ? {} : { field }),
    message: typeof apiMessage === 'string' ? apiMessage : 'Yêu cầu chưa thể thực hiện.',
  }
}

export function useOrganizationManagement() {
  const config = useRuntimeConfig()
  const data = ref<OrganizationManagementSnapshot | null>(null)
  const isLoading = ref(false)
  const hasLoaded = ref(false)
  const errorMessage = ref('')
  const baseUrl = `${config.public.apiBase}/api/v1/admin`

  async function load(): Promise<boolean> {
    if (isLoading.value) return false

    isLoading.value = true
    errorMessage.value = ''

    try {
      data.value = await $fetch<OrganizationManagementSnapshot>(
        `${baseUrl}/organization-management`,
        { credentials: 'include' },
      )
      return true
    } catch (error: unknown) {
      const parsed = readOrganizationError(error)
      data.value = null
      errorMessage.value =
        parsed.status === 401
          ? 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
          : parsed.status === 403
            ? 'Tài khoản chưa được cấp quyền quản lý cơ cấu tổ chức.'
            : 'Không thể tải dữ liệu cơ cấu. Vui lòng thử lại.'
      return false
    } finally {
      isLoading.value = false
      hasLoaded.value = true
    }
  }

  async function request<T>(path: string, options: Parameters<typeof $fetch<T>>[1]): Promise<T> {
    try {
      return await $fetch<T>(`${baseUrl}${path}`, {
        ...options,
        credentials: 'include',
      })
    } catch (error: unknown) {
      throw readOrganizationError(error)
    }
  }

  function createFaculty(input: CreateOrganizationInput) {
    return request<{ id: string }>('/faculties', {
      method: 'POST',
      body: input,
    })
  }

  function updateFaculty(
    facultyId: string,
    input: {
      code?: string
      name?: string
      status?: OrganizationStatus
    },
  ) {
    return request<void>(`/faculties/${facultyId}`, {
      method: 'PATCH',
      body: input,
    })
  }

  function createAcademicClass(input: CreateOrganizationInput & { facultyId: string }) {
    return request<{ id: string }>('/academic-classes', {
      method: 'POST',
      body: input,
    })
  }

  function createOrganizationalUnit(input: CreateOrganizationInput) {
    return request<{ id: string }>('/organizational-units', {
      method: 'POST',
      body: input,
    })
  }

  function updateOrganizationalUnit(
    organizationalUnitId: string,
    input: {
      code?: string
      name?: string
      status?: OrganizationStatus
    },
  ) {
    return request<void>(`/organizational-units/${organizationalUnitId}`, {
      method: 'PATCH',
      body: input,
    })
  }

  function updateAcademicClass(
    classId: string,
    input: {
      facultyId?: string
      code?: string
      name?: string
      status?: OrganizationStatus
    },
  ) {
    return request<void>(`/academic-classes/${classId}`, {
      method: 'PATCH',
      body: input,
    })
  }

  function setAcademicAdvisor(classId: string, advisorUserId: string | null) {
    return request<void>(`/academic-classes/${classId}/advisor`, {
      method: 'PUT',
      body: { advisorUserId },
    })
  }

  return {
    data: readonly(data),
    isLoading: readonly(isLoading),
    hasLoaded: readonly(hasLoaded),
    errorMessage: readonly(errorMessage),
    load,
    createFaculty,
    updateFaculty,
    createAcademicClass,
    updateAcademicClass,
    createOrganizationalUnit,
    updateOrganizationalUnit,
    setAcademicAdvisor,
  }
}
