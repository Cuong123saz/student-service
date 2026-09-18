import type { ActivateAccountInput } from '~/types/account-activation'

export function useAccountActivation() {
  const config = useRuntimeConfig()

  async function activateAccount(input: ActivateAccountInput): Promise<void> {
    await $fetch(`${config.public.apiBase}/api/v1/auth/activate`, {
      method: 'POST',
      body: input,
    })
  }

  return {
    activateAccount,
  }
}
