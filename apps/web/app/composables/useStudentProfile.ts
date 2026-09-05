import type {
  CurrentAdvisorResponse,
  StudentProfile,
} from '~/types/student-profile'

export function useStudentProfile() {
  const config = useRuntimeConfig()
  const profile = ref<StudentProfile | null>(null)
  const advisor = ref<CurrentAdvisorResponse | null>(null)
  const isLoading = ref(false)
  const errorMessage = ref('')

  async function load() {
    isLoading.value = true
    errorMessage.value = ''

    const [profileResult, advisorResult] =
      await Promise.allSettled([
        $fetch<{ profile: StudentProfile }>(
          `${config.public.apiBase}/api/v1/user/profile`,
          { credentials: 'include' },
        ),
        $fetch<CurrentAdvisorResponse>(
          `${config.public.apiBase}/api/v1/user/advisor`,
          { credentials: 'include' },
        ),
      ])

    if (profileResult.status === 'fulfilled') {
      profile.value = profileResult.value.profile
    } else {
      profile.value = null
      errorMessage.value =
        'Chưa có hồ sơ học vụ được cấu hình cho tài khoản này.'
    }

    if (advisorResult.status === 'fulfilled') {
      advisor.value = advisorResult.value
    } else {
      advisor.value = null
      if (!errorMessage.value) {
        errorMessage.value =
          'Không thể tải thông tin cố vấn. Vui lòng thử lại sau.'
      }
    }

    isLoading.value = false
  }

  return {
    profile: readonly(profile),
    advisor: readonly(advisor),
    isLoading: readonly(isLoading),
    errorMessage: readonly(errorMessage),
    load,
  }
}
