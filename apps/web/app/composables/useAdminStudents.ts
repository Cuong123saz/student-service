import type {
  AdminStudentDirectoryItem,
  AdminStudentDirectoryQuery,
  AdminStudentDirectoryResponse,
  UpdateAdminStudentInput,
} from '~/types/admin-student'

function getResponseStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined

  const candidate = error as {
    statusCode?: unknown
    response?: { status?: unknown }
  }

  if (typeof candidate.statusCode === 'number') {
    return candidate.statusCode
  }

  return typeof candidate.response?.status === 'number'
    ? candidate.response.status
    : undefined
}

export function useAdminStudents() {
  const config = useRuntimeConfig()
  const students = ref<AdminStudentDirectoryItem[]>([])
  const nextCursor = ref<string | null>(null)
  const isLoading = ref(false)
  const hasLoaded = ref(false)
  const errorMessage = ref('')
  const isUpdating = ref(false)
  const updateErrorMessage = ref('')

  async function load(
    query: AdminStudentDirectoryQuery = {},
  ): Promise<boolean> {
    if (isLoading.value) return false

    isLoading.value = true
    errorMessage.value = ''
    students.value = []
    nextCursor.value = null

    try {
      const response =
        await $fetch<AdminStudentDirectoryResponse>(
          `${config.public.apiBase}/api/v1/admin/students`,
          {
            credentials: 'include',
            query,
          },
        )

      students.value = response.students
      nextCursor.value = response.nextCursor
      return true
    } catch (error: unknown) {
      const status = getResponseStatus(error)

      if (status === 401) {
        errorMessage.value =
          'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
      } else if (status === 403) {
        errorMessage.value =
          'Tài khoản của bạn chưa được cấp quyền xem danh sách sinh viên.'
      } else {
        errorMessage.value =
          'Không thể tải danh sách sinh viên. Vui lòng thử lại sau.'
      }

      return false
    } finally {
      isLoading.value = false
      hasLoaded.value = true
    }
  }

  async function updateStudent(
    userId: string,
    input: UpdateAdminStudentInput,
  ): Promise<boolean> {
    if (isUpdating.value) return false

    isUpdating.value = true
    updateErrorMessage.value = ''

    try {
      await $fetch(
        `${config.public.apiBase}/api/v1/admin/students/${userId}`,
        {
          method: 'PATCH',
          credentials: 'include',
          body: input,
        },
      )
      return true
    } catch (error: unknown) {
      const status = getResponseStatus(error)
      if (status === 409) {
        updateErrorMessage.value = 'Mã sinh viên đã tồn tại.'
      } else if (status === 403) {
        updateErrorMessage.value = 'Bạn không có quyền sửa sinh viên hoặc lớp đã chọn.'
      } else if (status === 404) {
        updateErrorMessage.value = 'Không tìm thấy sinh viên trong phạm vi quản lý.'
      } else if (status === 400) {
        updateErrorMessage.value = 'Thông tin chưa hợp lệ. Hãy kiểm tra lại các trường.'
      } else {
        updateErrorMessage.value = 'Không thể lưu thay đổi. Vui lòng thử lại.'
      }
      return false
    } finally {
      isUpdating.value = false
    }
  }

  return {
    students: readonly(students),
    nextCursor: readonly(nextCursor),
    isLoading: readonly(isLoading),
    hasLoaded: readonly(hasLoaded),
    errorMessage: readonly(errorMessage),
    isUpdating: readonly(isUpdating),
    updateErrorMessage: readonly(updateErrorMessage),
    load,
    updateStudent,
  }
}
