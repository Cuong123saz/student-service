import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import Component from '../../app/components/SubmissionMockSignature.vue'
const fetcher = vi.fn()
beforeEach(() => {
  fetcher.mockReset()
  vi.stubGlobal('fetch', fetcher)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
const props = { submissionId: 'fake-case', roundNumber: 2, reviewPortal: 'admin' as const }
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })
function state(
  canSign = true,
  receipt = false,
  outcome: 'SIMULATION_MATCH' | 'SIMULATION_MISMATCH' = 'SIMULATION_MATCH',
) {
  return {
    enabled: true,
    notice: 'DEMO – KHÔNG CÓ GIÁ TRỊ PHÁP LÝ',
    documents: [
      {
        format: 'pdf',
        stored: true,
        expectedRevision: 7,
        canSign: canSign && !receipt,
        receipt: receipt ? { id: 'pinned-receipt', simulatedAt: '2026-10-14T01:00:00Z' } : null,
        checks: receipt
          ? [
              {
                id: 'check',
                checkedAt: '2026-10-14T01:01:00Z',
                result: {
                  outcome,
                  reason: outcome === 'SIMULATION_MATCH' ? 'MATCH' : 'DOCUMENT_CHANGED',
                },
              },
            ]
          : [],
        historyTruncated: false,
      },
    ],
  }
}
async function mounted(body = state(), portal: 'user' | 'admin' | null = 'admin') {
  fetcher.mockResolvedValueOnce(json(body))
  const host = document.createElement('div')
  document.body.appendChild(host)
  const w = await mountSuspended(Component, {
    props: { ...props, reviewPortal: portal ?? undefined },
    attachTo: host,
  })
  await flushPromises()
  return {
    w,
    dispose: () => {
      w.unmount()
      host.remove()
    },
  }
}
const button = (w: Awaited<ReturnType<typeof mounted>>['w'], text: string) =>
  w.findAll('button').find((b) => b.text() === text)!
async function confirm(w: Awaited<ReturnType<typeof mounted>>['w']) {
  await button(w, 'Xem lại ký mô phỏng PDF').trigger('click')
  await w.get('input[type="checkbox"]').setValue(true)
}
describe('mock signing stays separate from legal signature and issuance', () => {
  it('requires review focus and explicit acknowledgement before one POST', async () => {
    const { w, dispose } = await mounted()
    expect(w.text()).toContain('DEMO – KHÔNG CÓ GIÁ TRỊ PHÁP LÝ')
    expect(fetcher).toHaveBeenCalledTimes(1)
    await button(w, 'Xem lại ký mô phỏng PDF').trigger('click')
    expect(w.get('[aria-label="Xem lại ký mô phỏng"]').element).toBe(document.activeElement)
    expect(button(w, 'Xác nhận ký mô phỏng PDF').attributes('disabled')).toBeDefined()
    await w.get('input').setValue(true)
    fetcher
      .mockResolvedValueOnce(json({ id: 'receipt', legalEffect: false }))
      .mockResolvedValueOnce(json(state(false, true)))
    await button(w, 'Xác nhận ký mô phỏng PDF').trigger('click')
    await flushPromises()
    const [url, options] = fetcher.mock.calls[1]!
    expect(url).toBe(
      'http://localhost:3000/api/v1/admin/review-submissions/fake-case/rounds/2/documents/pdf/mock-sign',
    )
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body)).toMatchObject({
      expectedRevision: 7,
      requestId: expect.any(String),
    })
    expect(w.text()).toContain('Tài liệu gốc được giữ nguyên')
    expect(w.find('input').exists()).toBe(false)
    dispose()
  })
  it('owner can verify a pinned receipt while having no signing control', async () => {
    const { w, dispose } = await mounted(state(false, true), null)
    expect(w.findAll('button').some((b) => b.text().startsWith('Xem lại ký'))).toBe(false)
    fetcher
      .mockResolvedValueOnce(json({ outcome: 'SIMULATION_MATCH', legalEffect: false }))
      .mockResolvedValueOnce(json(state(false, true)))
    await button(w, 'Đối chiếu mô phỏng PDF').trigger('click')
    await flushPromises()
    expect(fetcher.mock.calls[1]![0]).toContain(
      '/user/submissions/fake-case/rounds/2/documents/pdf/mock-verify',
    )
    expect(JSON.parse(fetcher.mock.calls[1]![1].body)).toMatchObject({
      receiptId: 'pinned-receipt',
      requestId: expect.any(String),
    })
    expect(w.text()).toContain('Chưa xác minh chữ ký số')
    expect(w.text()).not.toContain('Chữ ký hợp lệ')
    dispose()
  })
  it('uncertain POST reuses its request id instead of creating a second signature', async () => {
    const { w, dispose } = await mounted()
    await confirm(w)
    fetcher.mockRejectedValueOnce(new Error('Mất phản hồi'))
    await button(w, 'Xác nhận ký mô phỏng PDF').trigger('click')
    await flushPromises()
    const first = JSON.parse(fetcher.mock.calls[1]![1].body)
    fetcher
      .mockResolvedValueOnce(json({ id: 'receipt', replayed: true }))
      .mockResolvedValueOnce(json(state(false, true)))
    await button(w, 'Xác nhận ký mô phỏng PDF').trigger('click')
    await flushPromises()
    expect(JSON.parse(fetcher.mock.calls[2]![1].body)).toEqual(first)
    dispose()
  })
  it('mismatch is shown as a problem and never as a legally verified signature', async () => {
    const { w, dispose } = await mounted(state(false, true))
    fetcher
      .mockResolvedValueOnce(
        json({ outcome: 'SIMULATION_MISMATCH', reason: 'DOCUMENT_CHANGED', legalEffect: false }),
      )
      .mockResolvedValueOnce(json(state(false, true, 'SIMULATION_MISMATCH')))
    await button(w, 'Đối chiếu mô phỏng PDF').trigger('click')
    await flushPromises()
    expect(w.text()).toContain('không khớp')
    expect(w.text()).toContain('Không khớp, cần kiểm tra tài liệu')
    expect(w.text()).toContain('chưa cấp văn bản')
    dispose()
  })
  it('403 clears prior receipt and signing controls', async () => {
    const { w, dispose } = await mounted(state(false, true))
    fetcher.mockResolvedValueOnce(json({ message: 'Quyền đã thay đổi' }, 403))
    await button(w, 'Tải lại kết quả mô phỏng').trigger('click')
    await flushPromises()
    expect(w.get('[role="alert"]').text()).toBe('Quyền đã thay đổi')
    expect(w.text()).not.toContain('Đã ghi ký mô phỏng')
    expect(w.findAll('button').some((b) => b.text().startsWith('Đối chiếu mô phỏng'))).toBe(false)
    dispose()
  })
  it('late action from an old dossier cannot overwrite the next dossier', async () => {
    const { w, dispose } = await mounted()
    await confirm(w)
    let finish: (value: unknown) => void = () => {}
    fetcher.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    await button(w, 'Xác nhận ký mô phỏng PDF').trigger('click')
    fetcher.mockResolvedValueOnce(json(state(false, false)))
    await w.setProps({ submissionId: 'next-case' })
    await flushPromises()
    finish(json({ id: 'old-receipt', legalEffect: false }))
    await flushPromises()
    expect(w.text()).not.toContain('Đã ghi kết quả ký mô phỏng')
    expect(w.text()).not.toContain('Đã ghi ký mô phỏng')
    expect(w.find('input').exists()).toBe(false)
    dispose()
  })
  it('cancel returns focus to the original action without a POST', async () => {
    const { w, dispose } = await mounted()
    await button(w, 'Xem lại ký mô phỏng PDF').trigger('click')
    await button(w, 'Hủy').trigger('click')
    await flushPromises()
    expect(button(w, 'Xem lại ký mô phỏng PDF').element).toBe(document.activeElement)
    expect(fetcher).toHaveBeenCalledTimes(1)
    dispose()
  })
})
