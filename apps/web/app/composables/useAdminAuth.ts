import type {
  AdminChangePasswordInput,
  AdminLoginInput,
  AdminLoginResponse,
  AdminSessionUser,
  CurrentAdminResponse,
} from '~/types/auth'

export function useAdminAuth() {
  const config = useRuntimeConfig()
  const user = useState<AdminSessionUser | null>('admin-session-user', () => null)
  const isResolved = useState('admin-session-resolved', () => false)

  async function login(input: AdminLoginInput) {
    const response = await $fetch<AdminLoginResponse>(
      `${config.public.apiBase}/api/v1/admin/auth/login`,
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
      const response = await $fetch<CurrentAdminResponse>(
        `${config.public.apiBase}/api/v1/admin/auth/me`,
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

  async function changePassword(input: AdminChangePasswordInput) {
    await $fetch(`${config.public.apiBase}/api/v1/admin/auth/change-password`, {
      method: 'POST',
      body: input,
      credentials: 'include',
    })

    user.value = null
    isResolved.value = true
  }

  async function logout() {
    try {
      await $fetch(`${config.public.apiBase}/api/v1/admin/auth/logout`, {
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
    changePassword,
    logout,
  }
}
