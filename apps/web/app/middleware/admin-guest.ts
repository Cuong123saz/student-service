export default defineNuxtRouteMiddleware(async () => {
  if (import.meta.server) return

  const { ensureCurrentUser } = useAdminAuth()
  const user = await ensureCurrentUser()

  if (!user) return
  return navigateTo(user.mustChangePassword ? '/admin/change-password' : '/admin')
})
