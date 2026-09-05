export default defineNuxtRouteMiddleware(async () => {
  if (import.meta.server) return

  const { ensureCurrentUser } = useUserAuth()
  const user = await ensureCurrentUser()

  if (user) return navigateTo('/portal')
})
