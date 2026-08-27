import type {
  AdminChangePasswordInput,
  AdminLoginInput,
  AdminLoginResponse,
  AdminSessionUser,
  CurrentAdminResponse,
} from '~/types/auth'
export function useAdminAuth() {
  const config = useRuntimeConfig()

  const user =
    useState<AdminSessionUser | null>(
      'admin-session-user',
      () => null,
    )

  async function login(
    input: AdminLoginInput,
  ) {
    const response =
      await $fetch<AdminLoginResponse>(
        `${config.public.apiBase}/api/v1/admin/auth/login`,
        {
          method: 'POST',
          body: input,
          credentials: 'include',
        },
      )

    user.value = response.user

    return response.user
  }

  async function loadCurrentUser() {
    const response =
      await $fetch<CurrentAdminResponse>(
        `${config.public.apiBase}/api/v1/admin/auth/me`,
        {
          credentials: 'include',
        },
      )

    user.value = response.user

    return response.user
  }
async function changePassword(
  input: AdminChangePasswordInput,
) {
  await $fetch(
    `${config.public.apiBase}/api/v1/admin/auth/change-password`,
    {
      method: 'POST',
      body: input,
      credentials: 'include',
    },
  )

  // Backend đã xóa cookie sau khi đổi.
  user.value = null
}
  async function logout() {
    await $fetch(
      `${config.public.apiBase}/api/v1/admin/auth/logout`,
      {
        method: 'POST',
        credentials: 'include',
      },
    )

    user.value = null
  }

  return {
    user: readonly(user),
    login,
    loadCurrentUser,
    changePassword,
    logout,
  }
}