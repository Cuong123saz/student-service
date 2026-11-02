import type { VueWrapper } from '@vue/test-utils'
import { flushPromises } from '@vue/test-utils'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Student from '../../app/pages/activities/index.vue'
import Manage from '../../app/pages/activity-management/index.vue'
import Detail from '../../app/pages/activity-management/[id].vue'
import type { ActivityDetail, ActivityOptions } from '../../app/types/activity'

const id = '00000000-0000-4000-8000-000000000401',
  fac = '00000000-0000-4000-8000-000000000402',
  club = {
    id: '00000000-0000-4000-8000-000000000403',
    code: 'DOIMAU',
    name: 'Đội Máu',
    status: 'ACTIVE' as const,
  },
  route = reactive({ params: { id } })
function activity(over: Partial<ActivityDetail> = {}): ActivityDetail {
  return {
    id,
    kind: 'MANDATORY',
    category: 'SCHOOL',
    ownerType: 'STUDENT_AFFAIRS',
    ownerClub: null,
    delegatedClub: null,
    title: 'Sinh hoạt công dân (giả định)',
    description: '',
    location: 'Hội trường A',
    startsAt: '2026-11-20T01:00:00.000Z',
    endsAt: '2026-11-20T03:00:00.000Z',
    capacity: 100,
    eligibility: { facultyIds: [fac], classIds: [], cohortYears: [2021] },
    status: 'DRAFT',
    statusReason: null,
    revision: 0,
    publishedAt: null,
    createdAt: '2026-11-02T00:00:00.000Z',
    canEdit: true,
    canPublish: true,
    canCancel: true,
    canDelegate: true,
    canSuspend: false,
    canResume: false,
    events: [
      {
        id: 'e1',
        revision: 0,
        action: 'CREATED',
        actor: 'ctsv.gia',
        reason: null,
        before: null,
        after: null,
        createdAt: '2026-11-02T00:00:00.000Z',
      },
    ],
    ...over,
  }
}
function options(over: Partial<ActivityOptions> = {}): ActivityOptions {
  return {
    mandatoryOwners: ['STUDENT_AFFAIRS'],
    trainingFacultyLimited: false,
    faculties: [{ id: fac, code: 'CNTT', name: 'Công nghệ thông tin' }],
    classes: [],
    leaderClubs: [],
    delegationClubs: [club],
    ...over,
  }
}
function mockApi() {
  return {
    available: vi.fn(),
    list: vi.fn().mockResolvedValue({ items: [activity()], truncated: false }),
    options: vi.fn().mockResolvedValue(options()),
    detail: vi.fn().mockResolvedValue(activity()),
    create: vi.fn().mockResolvedValue(activity()),
    update: vi.fn(),
    transition: vi.fn(),
    delegate: vi.fn(),
  }
}
let api = mockApi()
const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }))
mockNuxtImport('useActivities', () => () => api)
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
describe('activities (ADR 0030)', () => {
  it('students see only what the server returns, in Vietnam time, without audience lists', async () => {
    api.available.mockResolvedValue({
      items: [{ ...activity(), eligibility: undefined }],
      truncated: false,
    })
    const w = await mountSuspended(Student)
    await flushPromises()
    expect(w.text()).toContain('Sinh hoạt công dân (giả định)')
    expect(w.text()).toContain('08:00')
    expect(w.text()).toContain('Bắt buộc · Học viện tổ chức/điều động · CTSV')
    expect(w.text()).toContain('Tối đa 100 người')
    w.unmount()
  })
  it('CTSV creates a mandatory draft with Vietnam-time instants and a cohort audience', async () => {
    const w = await mountSuspended(Manage)
    await flushPromises()
    expect(w.find('#activity-club').exists()).toBe(false)
    expect(button(w, 'Tạo bản nháp')!.attributes('disabled')).toBeDefined()
    await w.get('#new-activity-title').setValue('Tuần sinh hoạt công dân')
    await w.get('#new-activity-location').setValue('Hội trường A')
    await w.get('#new-activity-starts').setValue('2026-11-20T08:00')
    await w.get('#new-activity-ends').setValue('2026-11-20T10:00')
    await w.get('#new-activity-cohorts').setValue('K15')
    await button(w, 'Tạo bản nháp')!.trigger('click')
    await flushPromises()
    expect(api.create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'MANDATORY',
        ownerType: 'STUDENT_AFFAIRS',
        title: 'Tuần sinh hoạt công dân',
        startsAt: '2026-11-20T01:00:00.000Z',
        endsAt: '2026-11-20T03:00:00.000Z',
        eligibility: { facultyIds: [], classIds: [], cohortYears: [2021] },
      }),
    )
    expect(navigate).toHaveBeenCalledWith('/activity-management/' + id)
    w.unmount()
  })
  it('a club leader can only create voluntary activities for its clubs', async () => {
    api.options.mockResolvedValue(
      options({ mandatoryOwners: [], leaderClubs: [club], delegationClubs: [] }),
    )
    const w = await mountSuspended(Manage)
    await flushPromises()
    const kinds = w
      .get('#activity-kind')
      .findAll('option')
      .map((o) => o.text())
    expect(kinds).toEqual(['Tự nguyện'])
    expect(w.get('#activity-club').text()).toContain('DOIMAU')
    w.unmount()
  })
  it('publishing, delegation and cancellation follow the server permission flags', async () => {
    api.transition.mockResolvedValue(
      activity({ status: 'PUBLISHED', revision: 1, canPublish: false }),
    )
    api.delegate.mockResolvedValue(activity({ revision: 2, delegatedClub: club }))
    const w = await mountSuspended(Detail)
    await flushPromises()
    expect(w.text()).toContain('Đối tượng: Khoa: CNTT · Niên khóa: K15')
    await button(w, 'Công bố')!.trigger('click')
    await flushPromises()
    expect(api.transition).toHaveBeenCalledWith(id, 'publish', 0, '')
    expect(w.text()).toContain('Đã công bố hoạt động.')
    await w.get('#activity-delegate').setValue(club.id)
    await button(w, 'Cập nhật giao CLB')!.trigger('click')
    await flushPromises()
    expect(api.delegate).toHaveBeenCalledWith(id, 1, club.id, '')
    expect(w.text()).toContain('thực hiện: Đội Máu')
    expect(button(w, 'Hủy hoạt động')!.attributes('disabled')).toBeDefined()
    await w.get('#activity-reason').setValue('Đổi lịch')
    confirmAnswer = false
    await button(w, 'Hủy hoạt động')!.trigger('click')
    expect(api.transition).toHaveBeenCalledTimes(1)
    w.unmount()
  })
  it('a delegated club sees the activity read-only', async () => {
    api.detail.mockResolvedValue(
      activity({
        delegatedClub: club,
        canEdit: false,
        canPublish: false,
        canCancel: false,
        canDelegate: false,
      }),
    )
    const w = await mountSuspended(Detail)
    await flushPromises()
    expect(w.find('#edit-activity-title').exists()).toBe(false)
    expect(w.find('#activity-delegate').exists()).toBe(false)
    expect(w.find('#activity-reason').exists()).toBe(false)
    expect(w.text()).toContain('Lịch sử')
    w.unmount()
  })
  it('lost rights clear the activity from the page', async () => {
    api.transition.mockRejectedValue({ status: 403, message: 'Không có quyền', issues: [] })
    const w = await mountSuspended(Detail)
    await flushPromises()
    await button(w, 'Công bố')!.trigger('click')
    await flushPromises()
    expect(w.get('[role="alert"]').text()).toContain('Không có quyền')
    expect(w.text()).not.toContain('Hội trường A')
    w.unmount()
  })
})
