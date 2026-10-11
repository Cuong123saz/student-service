import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SubmissionDocumentDownloads from '../../app/components/SubmissionDocumentDownloads.vue'
import { submissionDocumentUrl } from '../../app/utils/submission-document'
const fetcher = vi.fn()
const createObjectURL = vi.fn(() => 'blob:test-document')
const revokeObjectURL = vi.fn()
let click: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  fetcher.mockReset()
  createObjectURL.mockClear()
  revokeObjectURL.mockClear()
  vi.stubGlobal('fetch', fetcher)
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = createObjectURL
      static revokeObjectURL = revokeObjectURL
    },
  )
  click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
async function mount(reviewPortal?: 'user' | 'admin') {
  return mountSuspended(SubmissionDocumentDownloads, {
    props: { submissionId: 'fake-id', roundNumber: 2, reviewPortal },
  })
}
function file(type: string) {
  return {
    ok: true,
    headers: new Headers({ 'content-type': type }),
    blob: () => Promise.resolve(new Blob(['document'], { type })),
  }
}
describe('submission document downloads', () => {
  it.each([undefined, 'user', 'admin'] as const)(
    'uses the correct %s route, credentials and file extension',
    async (portal) => {
      fetcher.mockResolvedValue(
        file('application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
      )
      const wrapper = await mount(portal)
      await wrapper.findAll('button')[0]!.trigger('click')
      await flushPromises()
      expect(fetcher).toHaveBeenCalledWith(
        submissionDocumentUrl('http://localhost:3000', portal, 'fake-id', 2, 'docx'),
        { credentials: 'include' },
      )
      expect(click).toHaveBeenCalledTimes(1)
      expect(createObjectURL).toHaveBeenCalledTimes(1)
      expect(wrapper.text()).toContain('Đã tải phiếu Word của lần gửi 2.')
      expect(wrapper.text()).toContain('Bản kê khai chưa ký')
      wrapper.unmount()
    },
  )
  it('shows progress, prevents repeated downloads, and keeps a PDF error actionable', async () => {
    const pending = Promise.withResolvers<unknown>()
    fetcher.mockReturnValue(pending.promise)
    const wrapper = await mount()
    await wrapper.findAll('button')[1]!.trigger('click')
    expect(wrapper.text()).toContain('Đang tạo PDF...')
    expect(
      wrapper.findAll('button').every((button) => button.attributes('disabled') !== undefined),
    ).toBe(true)
    expect(wrapper.get('[role="status"]').text()).toContain('không cần gửi lại')
    pending.resolve({
      ok: false,
      status: 503,
      json: () =>
        Promise.resolve({
          message: 'Chưa tạo được PDF. Bạn vẫn có thể tải Word.',
          requestId: 'doc-req',
        }),
    })
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Bạn vẫn có thể tải Word')
    expect(wrapper.text()).toContain('doc-req')
    expect(
      wrapper.findAll('button').every((button) => button.attributes('disabled') === undefined),
    ).toBe(true)
    expect(click).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it('rejects HTML/error responses and handles an expired admin session', async () => {
    fetcher.mockResolvedValue(file('text/html'))
    const wrapper = await mount('admin')
    await wrapper.findAll('button')[1]!.trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('đúng định dạng')
    expect(click).not.toHaveBeenCalled()
    fetcher.mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ message: 'Phiên đã hết hạn' }),
    })
    await wrapper.findAll('button')[1]!.trigger('click')
    await flushPromises()
    expect(wrapper.get('a').attributes('href')).toBe('/admin/login')
    wrapper.unmount()
  })
  it('does not download a stale response after the selected round changes', async () => {
    const pending = Promise.withResolvers<unknown>()
    fetcher.mockReturnValue(pending.promise)
    const wrapper = await mount()
    await wrapper.findAll('button')[0]!.trigger('click')
    await wrapper.setProps({ roundNumber: 3 })
    pending.resolve(file('application/vnd.openxmlformats-officedocument.wordprocessingml.document'))
    await flushPromises()
    expect(click).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('lần gửi 3')
    wrapper.unmount()
  })
  it('encodes IDs and distinguishes student and review endpoints', () => {
    expect(submissionDocumentUrl('http://test/', undefined, 's/1', 1, 'pdf')).toContain(
      's%2F1/rounds/1/documents/pdf',
    )
    expect(submissionDocumentUrl('http://test/', 'admin', 's1', 2, 'docx')).toBe(
      'http://test/api/v1/admin/review-submissions/s1/rounds/2/documents/docx',
    )
  })
})
