import type { VueWrapper } from '@vue/test-utils'
import { flushPromises } from '@vue/test-utils'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CheckIn from '../../app/pages/activities/[id]/check-in.vue'
import Review from '../../app/components/ActivityAttendancePanel.vue'
import type { AttendanceEntry, AttendanceQueue, MyAttendance } from '../../app/types/activity'

const id = '00000000-0000-4000-8000-000000000501',
  route = reactive({ params: { id }, query: { code: 'C'.repeat(32) } as Record<string, string> })
const mine = (over: Partial<MyAttendance> = {}): MyAttendance => ({
  activityId: id,
  status: null,
  captureExpiresAt: null,
  reviewNote: null,
  certificateCode: null,
  ...over,
})
const entry = (n: number, over: Partial<AttendanceEntry> = {}): AttendanceEntry => ({
  id: 'att-' + n,
  studentUserId: 'u' + n,
  studentCode: 'SV00' + n,
  fullName: 'Sinh viên ' + n,
  classCode: 'GIA',
  status: 'PENDING_REVIEW',
  scannedAt: '2026-11-20T01:05:00.000Z',
  submittedAt: '2026-11-20T01:06:00.000Z',
  reviewedAt: null,
  reviewer: null,
  reviewNote: null,
  hasPhoto: true,
  certificate: null,
  revision: 1,
  ...over,
})
const queue = (over: Partial<AttendanceQueue> = {}): AttendanceQueue => ({
  canReview: true,
  canRevoke: false,
  summary: { pending: 2, approved: 0, rejected: 0 },
  items: [entry(1), entry(2)],
  truncated: false,
  ...over,
})
function mockApi() {
  return {
    attendance: vi.fn().mockResolvedValue(mine()),
    scan: vi.fn(),
    submitPhoto: vi.fn(),
    attendanceQueue: vi.fn().mockResolvedValue(queue()),
    attendancePhoto: vi.fn().mockResolvedValue(new Blob(['x'], { type: 'image/jpeg' })),
    review: vi.fn(),
    revokeCertificate: vi.fn(),
  }
}
let api = mockApi()
mockNuxtImport('useActivities', () => () => api)
mockNuxtImport('useRoute', () => () => route)
const button = (w: VueWrapper, name: string) => w.findAll('button').find((b) => b.text() === name)
let confirmAnswer = true
const stop = vi.fn()
beforeEach(() => {
  api = mockApi()
  confirmAnswer = true
  stop.mockReset()
  route.query = { code: 'C'.repeat(32) }
  Object.defineProperty(window, 'confirm', { value: () => confirmAnswer, configurable: true })
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }) },
    configurable: true,
  })
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    value: () => Promise.resolve(),
    configurable: true,
  })
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    value: () => ({ drawImage: () => {} }),
    configurable: true,
  })
  Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', {
    value: (cb: (b: Blob) => void, type: string) => cb(new Blob(['jpeg'], { type })),
    configurable: true,
  })
  Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:photo', configurable: true })
  Object.defineProperty(URL, 'revokeObjectURL', { value: () => {}, configurable: true })
})
afterEach(() => {
  Reflect.deleteProperty(window, 'confirm')
})
describe('check-in (ADR 0032)', () => {
  it('requires consent, opens the front camera after a valid scan and sends a JPEG', async () => {
    api.scan.mockResolvedValue(
      mine({ status: 'SCANNED', captureExpiresAt: new Date(Date.now() + 180000).toISOString() }),
    )
    api.submitPhoto.mockResolvedValue(mine({ status: 'PENDING_REVIEW' }))
    const w = await mountSuspended(CheckIn)
    await flushPromises()
    expect(w.find('input[type="file"]').exists()).toBe(false)
    expect(button(w, 'Xác nhận mã và mở camera')!.attributes('disabled')).toBeDefined()
    await w.get('input[type="checkbox"]').setValue(true)
    await button(w, 'Xác nhận mã và mở camera')!.trigger('click')
    await flushPromises()
    expect(api.scan).toHaveBeenCalledWith(id, 'C'.repeat(32))
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        video: expect.objectContaining({ facingMode: 'user' }),
        audio: false,
      }),
    )
    expect(w.text()).toMatch(/Còn (179|180) giây/)
    await button(w, 'Chụp và gửi')!.trigger('click')
    await flushPromises()
    const photo = api.submitPhoto.mock.calls[0]![1] as Blob
    expect(photo.type).toBe('image/jpeg')
    expect(w.text()).toContain('Chờ duyệt')
    expect(stop).toHaveBeenCalled()
    w.unmount()
  })
  it('without a QR code the page only explains how to check in', async () => {
    route.query = {}
    const w = await mountSuspended(CheckIn)
    await flushPromises()
    expect(w.text()).toContain('Hãy quét mã QR tại hội trường')
    expect(button(w, 'Xác nhận mã và mở camera')).toBeUndefined()
    w.unmount()
  })
  it('a server refusal is shown and the camera stays closed', async () => {
    api.scan.mockRejectedValue({
      status: 409,
      message: 'Chỉ điểm danh trong giờ diễn ra hoạt động.',
      issues: [],
    })
    const w = await mountSuspended(CheckIn)
    await flushPromises()
    await w.get('input[type="checkbox"]').setValue(true)
    await button(w, 'Xác nhận mã và mở camera')!.trigger('click')
    await flushPromises()
    expect(w.get('[role="alert"]').text()).toContain('trong giờ diễn ra')
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled()
    w.unmount()
  })
})
describe('attendance review (ADR 0032)', () => {
  it('batch approval asks for confirmation; rejection needs a reason; photos load on demand', async () => {
    api.review.mockResolvedValue(
      queue({
        summary: { pending: 0, approved: 2, rejected: 0 },
        items: [1, 2].map((n) =>
          entry(n, {
            status: 'APPROVED',
            certificate: {
              id: 'c' + n,
              code: 'CN-AAAAAAAAAAA' + n,
              status: 'ISSUED',
              revokeReason: null,
            },
          }),
        ),
      }),
    )
    const w = await mountSuspended(Review, { props: { activityId: id } })
    await flushPromises()
    await button(w, 'Xem ảnh SV001')!.trigger('click')
    await flushPromises()
    expect(api.attendancePhoto).toHaveBeenCalledWith(id, 'att-1')
    expect(w.find('img[alt="Ảnh điểm danh SV001"]').exists()).toBe(true)
    expect(button(w, 'Từ chối SV002')!.attributes('disabled')).toBeDefined()
    for (const box of w.findAll('input[type="checkbox"]')) await box.setValue(true)
    confirmAnswer = false
    await button(w, 'Duyệt 2 lượt đã chọn')!.trigger('click')
    expect(api.review).not.toHaveBeenCalled()
    confirmAnswer = true
    await button(w, 'Duyệt 2 lượt đã chọn')!.trigger('click')
    await flushPromises()
    expect(api.review).toHaveBeenCalledWith(
      id,
      [
        { id: 'att-1', revision: 1 },
        { id: 'att-2', revision: 1 },
      ],
      true,
      '',
    )
    expect(w.text()).toContain('Chứng nhận CN-AAAAAAAAAAA1')
    w.unmount()
  })
  it('only CTSV sees revocation, which requires a reason', async () => {
    api.attendanceQueue.mockResolvedValue(
      queue({
        canReview: false,
        canRevoke: true,
        items: [
          entry(1, {
            status: 'APPROVED',
            certificate: {
              id: 'c1',
              code: 'CN-AAAAAAAAAAAA',
              status: 'ISSUED',
              revokeReason: null,
            },
          }),
        ],
      }),
    )
    const w = await mountSuspended(Review, { props: { activityId: id } })
    await flushPromises()
    expect(button(w, 'Duyệt SV001')).toBeUndefined()
    expect(button(w, 'Thu hồi chứng nhận SV001')!.attributes('disabled')).toBeDefined()
    await w.get('#attendance-note-att-1').setValue('Ảnh ghép')
    await button(w, 'Thu hồi chứng nhận SV001')!.trigger('click')
    await flushPromises()
    expect(api.revokeCertificate).toHaveBeenCalledWith('c1', 'Ảnh ghép')
    w.unmount()
  })
})
