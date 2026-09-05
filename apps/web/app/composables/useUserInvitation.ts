import type {
  CreateUserInvitationInput,
  CreateUserInvitationResponse,
} from '~/types/user-invitation'

export function useUserInvitation() {
  const config = useRuntimeConfig()

  async function createInvitation(input: CreateUserInvitationInput) {
    return await $fetch<CreateUserInvitationResponse>(
      `${config.public.apiBase}/api/v1/admin/users/invitations`,
      {
        method: 'POST',
        body: input,
        credentials: 'include',
      },
    )
  }

  async function resendInvitation(userId: string) {
    return await $fetch<CreateUserInvitationResponse>(
      `${config.public.apiBase}/api/v1/admin/users/${userId}/invitations/resend`,
      {
        method: 'POST',
        credentials: 'include',
      },
    )
  }

  return { createInvitation, resendInvitation }
}
