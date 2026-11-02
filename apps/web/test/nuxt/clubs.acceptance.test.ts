import type { VueWrapper } from '@vue/test-utils'
import { flushPromises } from '@vue/test-utils'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import List from '../../app/pages/clubs/index.vue'
import Detail from '../../app/pages/clubs/[id].vue'
import type { ClubDetail } from '../../app/types/club'

const id = '00000000-0000-4000-8000-000000000201',
  route = reactive({ params: { id } })
function club(over: Partial<ClubDetail> = {}): ClubDetail {
  return {
    id,
    code: 'DOIMAU',
    name: 'CLB Đội Máu (giả định)',
    description: 'Hiến máu tình nguyện',
    status: 'ACTIVE',
    statusReason: null,
    revision: 0,
    activeLeaders: 1,
    isLeader: false,
    createdAt: '2026-11-02T00:00:00.000Z',
    dissolvedAt: null,
    canManage: true,
    leaders: [
      {
        id: '00000000-0000-4000-8000-000000000301',
        userId: '00000000-0000-4000-8000-000000000302',
        username: 'leader.gia',
        fullName: 'Người phụ trách giả',
        validFrom: '2026-11-01T00:00:00.000Z',
        validTo: null,
        status: 'ACTIVE',
        endReason: null,
      },
    ],
    ...over,
  }
}
function mockApi() {
  return {
    list: vi.fn().mockResolvedValue({ canManage: true, items: [club()], truncated: false }),
    detail: vi.fn().mockResolvedValue(club()),
    create: vi.fn().mockResolvedValue(club()),
    update: vi.fn(),
    changeStatus: vi.fn(),
    assignLeader: vi.fn(),
    endLeader: vi.fn(),
  }
}
let api = mockApi()
const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }))
mockNuxtImport('useClubs', () => () => api)
mockNuxtImport('useRoute', () => () => route)
mockNuxtImport('navigateTo', () => navigate)
const button = (w: VueWrapper, name: string) => w.findAll('button').find((b) => b.text() === name)
let confirmAnswer = true
beforeEach(() => {
  api = mockApi()
  navigate.mockReset()
  confirmAnswer = true
  Object.defineProperty(window, 'confirm', { value: () => confirmAnswer, configurable: true })
})
afterEach(() => {
  Reflect.deleteProperty(window, 'confirm')
})
describe('clubs (ADR 0029)', () => {
  it('CTSV creates a club and opens it', async () => {
    const w = await mountSuspended(List)
    await flushPromises()
    expect(w.text()).toContain('CLB Đội Máu (giả định) · DOIMAU')
    expect(w.text()).toContain('Đang hoạt động · 1 người phụ trách')
    expect(button(w, 'Tạo CLB')!.attributes('disabled')).toBeDefined()
    await w.get('#club-code').setValue('tinhnguyen')
    await w.get('#club-name').setValue('CLB Tình nguyện')
    await button(w, 'Tạo CLB')!.trigger('click')
    await flushPromises()
    expect(api.create).toHaveBeenCalledWith({
      code: 'tinhnguyen',
      name: 'CLB Tình nguyện',
      description: '',
    })
    expect(navigate).toHaveBeenCalledWith('/clubs/' + id)
    w.unmount()
  })
  it('a leader or Phòng Đào tạo sees no create form', async () => {
    api.list.mockResolvedValue({
      canManage: false,
      items: [{ ...club(), isLeader: true }],
      truncated: false,
    })
    const w = await mountSuspended(List)
    await flushPromises()
    expect(w.find('#club-code').exists()).toBe(false)
    expect(w.text()).toContain('Bạn đang phụ trách')
    w.unmount()
  })
  it('a plain student is told about missing rights and sees no club data', async () => {
    api.list.mockRejectedValue({ status: 403, message: 'Không có quyền quản lý CLB', issues: [] })
    const w = await mountSuspended(List)
    await flushPromises()
    expect(w.get('[role="alert"]').text()).toContain('Không có quyền')
    expect(w.text()).not.toContain('DOIMAU')
    w.unmount()
  })
  it('status change needs a reason and dissolution needs confirmation', async () => {
    api.changeStatus.mockResolvedValue(
      club({ status: 'SUSPENDED', revision: 1, statusReason: 'Tạm' }),
    )
    const w = await mountSuspended(Detail)
    await flushPromises()
    await w.get('#club-status').setValue('DISSOLVED')
    expect(button(w, 'Cập nhật trạng thái')!.attributes('disabled')).toBeDefined()
    await w.get('#club-status-reason').setValue('Giải thể giả định')
    confirmAnswer = false
    await button(w, 'Cập nhật trạng thái')!.trigger('click')
    await flushPromises()
    expect(api.changeStatus).not.toHaveBeenCalled()
    await w.get('#club-status').setValue('SUSPENDED')
    await button(w, 'Cập nhật trạng thái')!.trigger('click')
    await flushPromises()
    expect(api.changeStatus).toHaveBeenCalledWith(id, {
      expectedRevision: 0,
      status: 'SUSPENDED',
      reason: 'Giải thể giả định',
    })
    expect(w.text()).toContain('Tạm dừng')
    expect(w.text()).toContain('Đã cập nhật trạng thái CLB.')
    w.unmount()
  })
  it('ending a leader term requires a reason; a dissolved club is read-only', async () => {
    api.endLeader.mockResolvedValue(
      club({
        dissolvedAt: '2026-11-03T00:00:00.000Z',
        status: 'DISSOLVED',
        activeLeaders: 0,
        leaders: [{ ...club().leaders[0]!, status: 'INACTIVE', endReason: 'Hết nhiệm kỳ' }],
      }),
    )
    const w = await mountSuspended(Detail)
    await flushPromises()
    await button(w, 'Kết thúc nhiệm kỳ leader.gia')!.trigger('click')
    expect(button(w, 'Xác nhận kết thúc')!.attributes('disabled')).toBeDefined()
    await w.get('#end-reason-' + club().leaders[0]!.id).setValue('Hết nhiệm kỳ')
    await button(w, 'Xác nhận kết thúc')!.trigger('click')
    await flushPromises()
    expect(api.endLeader).toHaveBeenCalledWith(id, club().leaders[0]!.id, 'Hết nhiệm kỳ')
    expect(w.text()).toContain('Đã kết thúc')
    expect(w.find('#club-status').exists()).toBe(false)
    expect(w.find('#club-leader').exists()).toBe(false)
    w.unmount()
  })
  it('a conflict keeps the page and shows the reload message', async () => {
    api.assignLeader.mockRejectedValue({ status: 409, message: 'CLB đã thay đổi', issues: [] })
    const w = await mountSuspended(Detail)
    await flushPromises()
    await w.get('#club-leader').setValue('nguoi.moi')
    await button(w, 'Gán người phụ trách')!.trigger('click')
    await flushPromises()
    expect(api.assignLeader).toHaveBeenCalledWith(id, 'nguoi.moi')
    expect(w.get('[role="alert"]').text()).toContain('CLB đã thay đổi')
    expect(w.text()).toContain('DOIMAU')
    w.unmount()
  })
})
