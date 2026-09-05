export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) return

  const { ensureCurrentUser } = useAdminAuth()
  const user = await ensureCurrentUser()

  if (!user) return navigateTo('/admin/login')

  const isChangePasswordPage = to.path === '/admin/change-password'
  if (user.mustChangePassword && !isChangePasswordPage) {
    return navigateTo('/admin/change-password')
  }
  if (!user.mustChangePassword && isChangePasswordPage) {
    return navigateTo('/admin')
  }
})
