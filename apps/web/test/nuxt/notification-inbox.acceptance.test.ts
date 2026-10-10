import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import NotificationInbox from '../../app/components/NotificationInbox.vue'
const { api, navigate } = vi.hoisted(() => ({
  api: { identity: { value: 'person:1' }, unreadCount: { value: 2 }, list: vi.fn(), read: vi.fn() },
  navigate: vi.fn(),
}))
mockNuxtImport('useNotifications', () => () => api)
mockNuxtImport('navigateTo', () => navigate)
const id = '11111111-1111-4111-8111-111111111111'
function item(n = 1) {
  return {
    id: 'notice-' + n,
    action: 'SUPPLEMENT_REQUESTED',
    title: 'Yêu cầu bổ sung',
    message: 'Mở hồ sơ để đọc yêu cầu.',
    createdAt: '2026-10-10T00:00:00Z',
    readAt: null,
    targetUrl: '/submissions/' + id,
  }
}
function page() {
  return { items: [item()], nextCursor: 'next', unreadCount: 2 }
}
beforeEach(() => {
  api.identity = ref('person:1')
  api.unreadCount = ref(2)
  api.list.mockReset().mockResolvedValue(page())
  api.read.mockReset()
  navigate.mockReset()
})
function button(wrapper: Awaited<ReturnType<typeof mountSuspended>>, name: string) {
  return wrapper.findAll('button').find((b) => b.text() === name)!
}
describe('personal inbox', () => {
  it('supports unread filtering, pagination and does not mark read on viewing the inbox', async () => {
    const wrapper = await mountSuspended(NotificationInbox, { props: { portal: 'user' } })
    await flushPromises()
    expect(api.read).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('2 thông báo chưa đọc')
    api.list.mockResolvedValue({ items: [item(2)], nextCursor: null, unreadCount: 2 })
    await button(wrapper, 'Tải thêm thông báo').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('article')).toHaveLength(2)
    expect(api.list).toHaveBeenLastCalledWith({ unreadOnly: false, cursor: 'next' })
    await button(wrapper, 'Chưa đọc').trigger('click')
    await flushPromises()
    expect(api.list).toHaveBeenLastCalledWith({ unreadOnly: true })
    wrapper.unmount()
  })
  it('keeps unread and stays on page when mark-read fails; retry opens only after success', async () => {
    const wrapper = await mountSuspended(NotificationInbox, { props: { portal: 'user' } })
    await flushPromises()
    api.read.mockRejectedValue({ message: 'Không ghi được trạng thái đọc' })
    await button(wrapper, 'Mở hồ sơ').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Không ghi được trạng thái đọc')
    expect(wrapper.text()).toContain('Chưa đọc')
    expect(navigate).not.toHaveBeenCalled()
    api.read.mockResolvedValue({ id: 'notice-1', readAt: '2026-10-10T01:00:00Z', unreadCount: 1 })
    await button(wrapper, 'Mở hồ sơ').trigger('click')
    await flushPromises()
    expect(navigate).toHaveBeenCalledWith('/submissions/' + id)
    expect(button(wrapper, 'Đánh dấu đã đọc')).toBeUndefined()
    wrapper.unmount()
  })
  it('rejects external links instead of navigating or marking read', async () => {
    api.list.mockResolvedValue({
      items: [{ ...item(), targetUrl: 'https://example.com/private' }],
      nextCursor: null,
      unreadCount: 1,
    })
    const wrapper = await mountSuspended(NotificationInbox, { props: { portal: 'user' } })
    await flushPromises()
    await button(wrapper, 'Mở hồ sơ').trigger('click')
    expect(api.read).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Liên kết hồ sơ không hợp lệ')
    wrapper.unmount()
  })
  it('clears old inbox immediately on session change and ignores its delayed reply', async () => {
    let done!: (value: unknown) => void
    api.list.mockReturnValueOnce(
      new Promise((resolve) => {
        done = resolve
      }),
    )
    const wrapper = await mountSuspended(NotificationInbox, { props: { portal: 'user' } })
    api.identity.value = null
    await flushPromises()
    done(page())
    await flushPromises()
    expect(wrapper.findAll('article')).toHaveLength(0)
    wrapper.unmount()
  })
})
