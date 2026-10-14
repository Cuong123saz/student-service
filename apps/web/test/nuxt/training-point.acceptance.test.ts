import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { reactive } from 'vue'
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import TrainingPage from '../../app/pages/training-points/[id].vue'
import type { TrainingDeclaration, TrainingCriterion } from '../../app/types/training-point'
const id = '00000000-0000-4000-8000-000000000001',
  route = reactive({ params: { id } })
const criteria: TrainingCriterion[] = ['A', 'B', 'C', 'D', 'E'].map((code) => ({
  code: code as TrainingCriterion['code'],
  label: 'Giả định ' + code,
  maxPoints: 20,
  evidenceRequired: code === 'A',
}))
function sample(): TrainingDeclaration {
  return {
    id,
    period: {
      id: '00000000-0000-4000-8000-000000000002',
      classId: '00000000-0000-4000-8000-000000000003',
      academicYear: '2026-2027',
      semester: '1',
      name: 'Đợt giả định',
      policyLabel: 'Tiêu chí giả định',
      startsAt: '2026-01-01T00:00:00Z',
      endsAt: '2027-01-01T00:00:00Z',
      criteria,
      status: 'OPEN',
      revision: 2,
    },
    state: 'DRAFT',
    revision: 1,
    answers: {},
    editable: true,
    student: {
      fullName: 'Nguyễn Minh An',
      studentCode: 'GIA001',
      classCode: 'GIA',
      facultyCode: 'GIA',
    },
    totalPoints: 0,
    submittedAt: null,
    files: [],
    history: [],
    historyTruncated: false,
    scoreStatus: 'SELF_DECLARED_NOT_REVIEWED',
  }
}
function mockApi() {
  return {
    detail: vi.fn().mockResolvedValue(sample()),
    save: vi.fn(),
    submit: vi.fn(),
    upload: vi.fn(),
    remove: vi.fn(),
    download: vi.fn(),
  }
}
let api = mockApi()
mockNuxtImport('useTrainingPoints', () => () => api)
mockNuxtImport('useRoute', () => () => route)
beforeEach(() => {
  api = mockApi()
  route.params.id = id
  Object.defineProperty(window, 'confirm', {
    value: () => true,
    configurable: true,
    writable: true,
  })
})
afterEach(() => {
  Reflect.deleteProperty(window, 'confirm')
})
function button(wrapper: Awaited<ReturnType<typeof mountSuspended>>, name: string) {
  return wrapper.findAll('button').find((b) => b.text() === name)!
}
describe('student training declaration', () => {
  it('saves zero and missing points without replacing unknown scores, and prevents upload with unsaved edits', async () => {
    api.save.mockImplementation(async (_d, answers) => ({ ...sample(), revision: 2, answers }))
    const w = await mountSuspended(TrainingPage)
    await flushPromises()
    await w.get('#tp-points-A').setValue('0')
    expect(w.get('#tp-file-A').attributes('disabled')).toBeDefined()
    await w.get('form').trigger('submit')
    await flushPromises()
    expect(api.save.mock.calls[0]![1]).toMatchObject({
      A: { points: 0, note: '' },
      B: { points: null, note: '' },
    })
    expect(w.get('#tp-file-A').attributes('disabled')).toBeUndefined()
    expect(w.text()).toContain('Điểm tự kê khai, chưa xét duyệt')
    w.unmount()
  })
  it('requires explicit confirmation and locks the successful submitted snapshot', async () => {
    const d = sample()
    d.answers = Object.fromEntries(criteria.map((c) => [c.code, { points: 0, note: '' }]))
    api.detail.mockResolvedValue(d)
    api.submit.mockResolvedValue({
      ...d,
      revision: 2,
      state: 'SUBMITTED',
      editable: false,
      submittedAt: '2026-10-14T00:00:00Z',
    })
    const w = await mountSuspended(TrainingPage)
    await flushPromises()
    await button(w, 'Kiểm tra và nộp').trigger('click')
    await flushPromises()
    expect(button(w, 'Xác nhận nộp').attributes('disabled')).toBeDefined()
    expect(api.submit).not.toHaveBeenCalled()
    await w.get('.tp-confirm input[type=checkbox]').setValue(true)
    await button(w, 'Xác nhận nộp').trigger('click')
    await flushPromises()
    expect(api.submit).toHaveBeenCalledOnce()
    expect(w.get('fieldset').attributes('disabled')).toBeDefined()
    expect(w.text()).toContain('Đã nộp — nội dung đã khóa')
    expect(w.find('#tp-file-A').exists()).toBe(false)
    w.unmount()
  })
  it('preserves typed input on conflict and removes private data when access is revoked', async () => {
    api.save.mockRejectedValue({ status: 409, message: 'Tải lại bản kê khai', issues: [] })
    const w = await mountSuspended(TrainingPage)
    await flushPromises()
    await w.get('#tp-points-A').setValue('3')
    await w.get('#tp-note-A').setValue('Đang nhập')
    await w.get('form').trigger('submit')
    await flushPromises()
    expect(w.get('#tp-note-A').element).toHaveProperty('value', 'Đang nhập')
    expect(w.get('fieldset').attributes('disabled')).toBeDefined()
    api.detail.mockRejectedValue({ status: 403, message: 'Đã thu hồi quyền', issues: [] })
    expect(typeof window.confirm).toBe('function')
    await button(w, 'Tải lại trạng thái').trigger('click')
    await flushPromises()
    expect(w.text()).not.toContain('Nguyễn Minh An')
    expect(w.find('form').exists()).toBe(false)
    vi.restoreAllMocks()
    w.unmount()
  })
  it('late response from a previous declaration cannot overwrite the current route', async () => {
    let resolveOld!: (d: TrainingDeclaration) => void
    api.detail.mockImplementationOnce(
      () =>
        new Promise<TrainingDeclaration>((resolve) => {
          resolveOld = resolve
        }),
    )
    const nextId = '00000000-0000-4000-8000-000000000004',
      next = {
        ...sample(),
        id: nextId,
        student: { ...sample().student, fullName: 'Sinh viên thứ hai' },
      }
    api.detail.mockResolvedValueOnce(next)
    const w = await mountSuspended(TrainingPage)
    await flushPromises()
    route.params.id = nextId
    await flushPromises()
    expect(w.text()).toContain('Sinh viên thứ hai')
    resolveOld(sample())
    await flushPromises()
    expect(w.text()).toContain('Sinh viên thứ hai')
    expect(w.text()).not.toContain('Nguyễn Minh An')
    w.unmount()
  })
})
