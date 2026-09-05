import type {
  CurrentUserResponse,
  UserLoginInput,
  UserLoginResponse,
  UserSessionUser,
} from '~/types/auth'

export function useUserAuth() {
  const config = useRuntimeConfig()

  const user =
    useState<UserSessionUser | null>(
      'user-session-user',
      () => null,
    )

  async function login(
    input: UserLoginInput,
  ) {
    const response =
      await $fetch<UserLoginResponse>(
        `${config.public.apiBase}/api/v1/user/auth/login`,
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
      await $fetch<CurrentUserResponse>(
        `${config.public.apiBase}/api/v1/user/auth/me`,
        {
          credentials: 'include',
        },
      )

    user.value = response.user

    return response.user
  }

  async function logout() {
    await $fetch(
      `${config.public.apiBase}/api/v1/user/auth/logout`,
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
    logout,
  }
}