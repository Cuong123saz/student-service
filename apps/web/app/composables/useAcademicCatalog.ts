import type { AcademicCatalogFaculty, AcademicCatalogResponse } from '~/types/academic-catalog'

function getCatalogResponseStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined

  const candidate = error as {
    statusCode?: unknown
    response?: { status?: unknown }
  }

  if (typeof candidate.statusCode === 'number') {
    return candidate.statusCode
  }

  return typeof candidate.response?.status === 'number' ? candidate.response.status : undefined
}

export function useAcademicCatalog() {
  const config = useRuntimeConfig()
  const faculties = ref<AcademicCatalogFaculty[]>([])
  const isLoading = ref(false)
  const hasLoaded = ref(false)
  const errorMessage = ref('')

  async function load(): Promise<boolean> {
    if (isLoading.value) return false

    isLoading.value = true
    errorMessage.value = ''

    try {
      const response = await $fetch<AcademicCatalogResponse>(
        `${config.public.apiBase}/api/v1/admin/academic-catalog`,
        { credentials: 'include' },
      )

      faculties.value = response.faculties
      return true
    } catch (error: unknown) {
      faculties.value = []
      const status = getCatalogResponseStatus(error)

      if (status === 401) {
        errorMessage.value = 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
      } else if (status === 403) {
        errorMessage.value = 'Tài khoản chưa được cấp quyền xem danh mục khoa và lớp.'
      } else {
        errorMessage.value = 'Không thể tải danh mục khoa và lớp. Vui lòng thử lại.'
      }

      return false
    } finally {
      isLoading.value = false
      hasLoaded.value = true
    }
  }

  return {
    faculties: readonly(faculties),
    isLoading: readonly(isLoading),
    hasLoaded: readonly(hasLoaded),
    errorMessage: readonly(errorMessage),
    load,
  }
}
