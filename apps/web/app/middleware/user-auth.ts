export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) return

  const { ensureCurrentUser } = useUserAuth()
  const user = await ensureCurrentUser()

  if (!user) {
    return navigateTo({
      path: '/login',
      query: { redirect: to.fullPath },
    })
  }
})
