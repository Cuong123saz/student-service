import type { SessionUser } from '~/types/auth'
import type { NotificationPage } from '~/types/notification'
import { getApiErrorContext } from '~/utils/api-error'
type Portal = 'user' | 'admin'
interface NoticeState {
  owner: string | null
  version: number
  unreadCount: number | null
}
export function resetNotificationState(portal: Portal) {
  const state = useState<NoticeState>('notifications-' + portal, () => ({
    owner: null,
    version: 0,
    unreadCount: null,
  }))
  state.value = { owner: null, version: state.value.version + 1, unreadCount: null }
}
export function useNotifications(portal: Portal) {
  const user = useState<SessionUser | null>(portal + '-session-user', () => null)
  const state = useState<NoticeState>('notifications-' + portal, () => ({
    owner: null,
    version: 0,
    unreadCount: null,
  }))
  watch(
    () => user.value?.id ?? null,
    (id) => {
      if (state.value.owner !== id)
        state.value = { owner: id, version: state.value.version + 1, unreadCount: null }
    },
    { immediate: true, flush: 'sync' },
  )
  const identity = computed(() =>
    state.value.owner ? state.value.owner + ':' + state.value.version : null,
  )
  const unreadCount = computed(() => state.value.unreadCount)
  const base = String(useRuntimeConfig().public.apiBase) + '/api/v1/' + portal + '/notifications'
  async function request<T>(path: string, options: Parameters<typeof $fetch<T>>[1] = {}) {
    const scope = identity.value
    if (!scope) throw { status: 401, message: 'Hãy đăng nhập để xem thông báo.' }
    try {
      const result = await $fetch<T>(base + path, { ...options, credentials: 'include' })
      if (scope !== identity.value)
        throw { status: 401, code: 'STALE_SESSION', message: 'Phiên đăng nhập đã thay đổi.' }
      return result
    } catch (error) {
      if (scope !== identity.value)
        throw { status: 401, code: 'STALE_SESSION', message: 'Phiên đăng nhập đã thay đổi.' }
      const context = getApiErrorContext(error)
      const detail = error as { data?: { message?: string }; message?: string }
      throw {
        ...context,
        message: detail.data?.message ?? 'Không tải được thông báo. Vui lòng thử lại.',
      }
    }
  }
  async function list(options: { cursor?: string; unreadOnly?: boolean } = {}) {
    const scope = identity.value
    const page = await request<NotificationPage>('', { query: options })
    if (scope !== identity.value)
      throw { status: 401, code: 'STALE_SESSION', message: 'Phiên đăng nhập đã thay đổi.' }
    state.value.unreadCount = page.unreadCount
    return page
  }
  async function refreshCount() {
    const scope = identity.value
    if (!scope) return
    try {
      const result = await request<{ unreadCount: number }>('/unread-count')
      if (scope === identity.value) state.value.unreadCount = result.unreadCount
    } catch {
      if (scope === identity.value) state.value.unreadCount = null
    }
  }
  async function read(id: string) {
    const scope = identity.value
    const result = await request<{ id: string; readAt: string; unreadCount: number }>(
      '/' + encodeURIComponent(id) + '/read',
      { method: 'POST', body: {} },
    )
    if (scope !== identity.value)
      throw { status: 401, code: 'STALE_SESSION', message: 'Phiên đăng nhập đã thay đổi.' }
    state.value.unreadCount = result.unreadCount
    return result
  }
  return { identity, unreadCount, list, read, refreshCount }
}
