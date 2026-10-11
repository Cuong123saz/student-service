import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SubmissionDocumentStatus from '../../app/components/SubmissionDocumentStatus.vue'
const fetcher = vi.fn()
beforeEach(() => {
  fetcher.mockReset()
  vi.stubGlobal('fetch', fetcher)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
const props = { submissionId: 'fake-id', roundNumber: 2, reviewPortal: 'admin' as const }
function state(retryAllowed = true) {
  return {
    enabled: true,
    documents: [
      {
        format: 'docx',
        state: 'READY',
        attempts: 1,
        attemptLimit: 3,
        attemptId: 'word',
        errorCode: null,
        retryAllowed: false,
        remainingAuthorizations: 3,
      },
      {
        format: 'pdf',
        state: 'EXHAUSTED',
        attempts: 3,
        attemptLimit: 3,
        attemptId: 'old-pdf-attempt',
        errorCode: 'CONVERT_FAILED',
        retryAllowed,
        remainingAuthorizations: 3,
      },
    ],
  }
}
function json(body: unknown, ok = true) {
  return { ok, json: async () => body }
}
async function inspect(portal: 'user' | 'admin' | undefined) {
  fetcher.mockResolvedValueOnce(json(state(Boolean(portal))))
  const wrapper = await mountSuspended(SubmissionDocumentStatus, {
    props: { ...props, reviewPortal: portal },
  })
  expect(fetcher).not.toHaveBeenCalled()
  await wrapper.find('button').trigger('click')
  await flushPromises()
  return wrapper
}
describe('document status and controlled retry', () => {
  it('checks status without generating a document and requires explicit repair acknowledgement', async () => {
    const wrapper = await inspect('admin')
    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/admin/review-submissions/fake-id/rounds/2/document-status',
      { credentials: 'include', cache: 'no-store' },
    )
    expect(wrapper.text()).toContain('Đã thử 3/3 lần')
    const action = wrapper.findAll('button')[1]!
    expect(action.attributes('disabled')).toBeDefined()
    await wrapper.get('input[type="checkbox"]').setValue(true)
    expect(action.attributes('disabled')).toBeUndefined()
    fetcher.mockResolvedValueOnce(json({ attemptLimit: 4, alreadyApplied: false }))
    await action.trigger('click')
    await flushPromises()
    const [url, options] = fetcher.mock.calls[1]!
    expect(url).toContain('/documents/pdf/retry')
    expect(options.method).toBe('POST')
    expect(options.credentials).toBe('include')
    expect(JSON.parse(options.body)).toMatchObject({
      expectedAttemptId: 'old-pdf-attempt',
      reasonCode: 'CONVERTER_FIXED',
    })
    expect(wrapper.text()).toContain('Đã ghi nhận người mở thêm một lượt')
    expect(wrapper.text()).toContain('3/4 lần')
    expect(wrapper.find('input').exists()).toBe(false)
    wrapper.unmount()
  })
  it('owner sees exhausted state without a retry control', async () => {
    const wrapper = await inspect(undefined)
    expect(wrapper.find('input').exists()).toBe(false)
    expect(wrapper.text()).toContain('không cần gửi lại hồ sơ')
    expect(fetcher.mock.calls[0]![0]).toContain('/user/submissions/')
    wrapper.unmount()
  })
  it('uncertain POST keeps the request UUID so resending cannot grant twice', async () => {
    const wrapper = await inspect('admin')
    await wrapper.get('input').setValue(true)
    fetcher.mockRejectedValueOnce(new Error('Kết nối gián đoạn'))
    await wrapper.findAll('button')[1]!.trigger('click')
    await flushPromises()
    const first = JSON.parse(fetcher.mock.calls[1]![1].body)
    expect(wrapper.get('[role="alert"]').text()).toContain('Kiểm tra tình trạng')
    fetcher.mockResolvedValueOnce(json({ attemptLimit: 4, alreadyApplied: true }))
    await wrapper.findAll('button')[1]!.trigger('click')
    await flushPromises()
    expect(JSON.parse(fetcher.mock.calls[2]![1].body).requestId).toBe(first.requestId)
    wrapper.unmount()
  })
  it('prevents repeated clicks while saving and reports revoked permission', async () => {
    const wrapper = await inspect('admin'),
      pending = Promise.withResolvers<unknown>()
    await wrapper.get('input').setValue(true)
    fetcher.mockReturnValueOnce(pending.promise)
    await wrapper.findAll('button')[1]!.trigger('click')
    expect(wrapper.findAll('button').every((b) => b.attributes('disabled') !== undefined)).toBe(
      true,
    )
    pending.resolve(json({ message: 'Quyền mở lượt đã bị thu hồi.' }, false))
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Quyền mở lượt đã bị thu hồi')
    expect(wrapper.text()).not.toContain('Đã ghi nhận người mở')
    wrapper.unmount()
  })
  it('discards responses from the previously displayed submission', async () => {
    const pending = Promise.withResolvers<unknown>()
    fetcher.mockReturnValueOnce(pending.promise)
    const wrapper = await mountSuspended(SubmissionDocumentStatus, { props })
    await wrapper.find('button').trigger('click')
    await wrapper.setProps({ submissionId: 'new-id' })
    pending.resolve(json(state()))
    await flushPromises()
    expect(wrapper.text()).not.toContain('Đã hết lượt thử')
    expect(wrapper.find('input').exists()).toBe(false)
    wrapper.unmount()
  })
  it('shows disabled environments clearly and blocks inspection during a download', async () => {
    const wrapper = await mountSuspended(SubmissionDocumentStatus, {
      props: { ...props, disabled: true },
    })
    await wrapper.find('button').trigger('click')
    expect(fetcher).not.toHaveBeenCalled()
    await wrapper.setProps({ disabled: false })
    fetcher.mockResolvedValueOnce(json({ enabled: false, documents: [] }))
    await wrapper.find('button').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('chưa bật theo dõi')
    wrapper.unmount()
  })
})
