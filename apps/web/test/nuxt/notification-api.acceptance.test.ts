import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { defineComponent } from 'vue'
import { clearNuxtState, useState } from '#imports'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNotifications, resetNotificationState } from '../../app/composables/useNotifications'
import type { SessionUser } from '../../app/types/auth'
const { fetcher } = vi.hoisted(() => ({ fetcher: vi.fn() }))
mockNuxtImport('$fetch', () => fetcher)
const wrappers: { unmount: () => void }[] = []
beforeEach(() => {
  clearNuxtState()
  fetcher.mockReset()
})
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
})
async function setup(portal: 'user' | 'admin', id = 'person-one') {
  let api!: ReturnType<typeof useNotifications>, setUser!: (id: string | null) => void
  const wrapper = await mountSuspended(
    defineComponent({
      setup() {
        const user = useState<SessionUser | null>(portal + '-session-user', () => null)
        setUser = (id) => {
          user.value = id
            ? {
                id,
                username: id,
                roles: [portal === 'admin' ? 'ADMIN' : 'STUDENT'],
                mustChangePassword: false,
              }
            : null
        }
        setUser(id)
        api = useNotifications(portal)
        return () => null
      },
    }),
  )
  wrappers.push(wrapper)
  return { api, setUser }
}
describe('personal notifications API', () => {
  it.each(['user', 'admin'] as const)(
    'uses correct %s prefix and cookie and updates counts only after server read',
    async (portal) => {
      const { api } = await setup(portal)
      fetcher.mockResolvedValue({ items: [], nextCursor: null, unreadCount: 3 })
      await api.list({ unreadOnly: true, cursor: 'next' })
      expect(fetcher).toHaveBeenLastCalledWith(
        'http://localhost:3000/api/v1/' + portal + '/notifications',
        { query: { unreadOnly: true, cursor: 'next' }, credentials: 'include' },
      )
      expect(api.unreadCount.value).toBe(3)
      fetcher.mockRejectedValue({ statusCode: 503 })
      await expect(api.read('id/one')).rejects.toBeDefined()
      expect(api.unreadCount.value).toBe(3)
      fetcher.mockResolvedValue({ id: 'id/one', readAt: 'now', unreadCount: 2 })
      await api.read('id/one')
      expect(fetcher).toHaveBeenLastCalledWith(
        'http://localhost:3000/api/v1/' + portal + '/notifications/id%2Fone/read',
        { method: 'POST', body: {}, credentials: 'include' },
      )
      expect(api.unreadCount.value).toBe(2)
    },
  )
  it('isolates admin and user counts for the same identity', async () => {
    const user = await setup('user'),
      admin = await setup('admin')
    fetcher.mockResolvedValueOnce({ unreadCount: 7 })
    await user.api.refreshCount()
    fetcher.mockResolvedValueOnce({ unreadCount: 1 })
    await admin.api.refreshCount()
    expect(user.api.unreadCount.value).toBe(7)
    expect(admin.api.unreadCount.value).toBe(1)
  })
  it('drops an old account reply when logout/login changes the session, including same-user login', async () => {
    const { api, setUser } = await setup('user')
    let done!: (value: unknown) => void
    fetcher.mockReturnValue(
      new Promise((resolve) => {
        done = resolve
      }),
    )
    const pending = api.list()
    resetNotificationState('user')
    setUser(null)
    setUser('person-one')
    done({ items: [{ id: 'private-old' }], nextCursor: null, unreadCount: 9 })
    await expect(pending).rejects.toMatchObject({ code: 'STALE_SESSION' })
    expect(api.unreadCount.value).toBeNull()
  })
})

it.each(['list', 'read'] as const)(
  'drops the %s continuation if session changes after request returns',
  async (method) => {
    const { api, setUser } = await setup('user')
    let done!: (value: unknown) => void
    fetcher.mockReturnValue(
      new Promise((resolve) => {
        done = resolve
      }),
    )
    const pending = method === 'list' ? api.list() : api.read('one')
    done(
      method === 'list'
        ? { items: [], nextCursor: null, unreadCount: 37 }
        : { id: 'one', readAt: 'now', unreadCount: 37 },
    )
    queueMicrotask(() => {
      resetNotificationState('user')
      setUser('person-two')
    })
    await expect(pending).rejects.toMatchObject({ code: 'STALE_SESSION' })
    expect(api.unreadCount.value).toBeNull()
  },
)
