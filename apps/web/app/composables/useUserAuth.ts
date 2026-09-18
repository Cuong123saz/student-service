import type {
  CurrentUserResponse,
  UserLoginInput,
  UserLoginResponse,
  UserSessionUser,
} from '~/types/auth'

export function useUserAuth() {
  const config = useRuntimeConfig()
  const user = useState<UserSessionUser | null>('user-session-user', () => null)
  const isResolved = useState('user-session-resolved', () => false)

  async function login(input: UserLoginInput) {
    const response = await $fetch<UserLoginResponse>(
      `${config.public.apiBase}/api/v1/user/auth/login`,
      {
        method: 'POST',
        body: input,
        credentials: 'include',
      },
    )

    user.value = response.user
    isResolved.value = true
    return response.user
  }

  async function loadCurrentUser() {
    try {
      const response = await $fetch<CurrentUserResponse>(
        `${config.public.apiBase}/api/v1/user/auth/me`,
        { credentials: 'include' },
      )

      user.value = response.user
      return response.user
    } catch (error) {
      user.value = null
      throw error
    } finally {
      isResolved.value = true
    }
  }

  async function ensureCurrentUser() {
    if (isResolved.value) {
      return user.value
    }

    try {
      return await loadCurrentUser()
    } catch {
      return null
    }
  }

  async function logout() {
    try {
      await $fetch(`${config.public.apiBase}/api/v1/user/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      })
    } finally {
      user.value = null
      isResolved.value = true
    }
  }

  return {
    user: readonly(user),
    isResolved: readonly(isResolved),
    login,
    loadCurrentUser,
    ensureCurrentUser,
    logout,
  }
}
