import type { VueWrapper } from '@vue/test-utils'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { reactive } from 'vue'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import Detail from '../../app/pages/training-reviews/[id].vue'
import List from '../../app/pages/training-reviews/index.vue'
import Result from '../../app/components/TrainingReviewResult.vue'
import type { ReviewDetail, ReviewQueue, ReviewRoster } from '../../app/types/training-review'
const id = '00000000-0000-4000-8000-000000000001',
  route = reactive({ params: { id } })
function sample(): ReviewDetail {
  return {
    id,
    periodId: '00000000-0000-4000-8000-000000000002',
    period: {
      name: 'Đợt giả định',
      academicYear: '2026-2027',
      semester: '1',
      policyLabel: 'Bộ tiêu chí giả',
      criteria: ['A', 'B', 'C', 'D', 'E'].map((code) => ({
        code: code as 'A',
        label: 'Giả định ' + code,
        maxPoints: 20,
        evidenceRequired: false,
      })),
    },
    student: {
      fullName: 'Sinh viên giả',
      studentCode: 'GIA001',
      classCode: 'GIA',
      facultyCode: 'GIA',
    },
    answers: Object.fromEntries(
      ['A', 'B', 'C', 'D', 'E'].map((c) => [
        c,
        { points: c === 'A' ? 10 : 0, note: c === 'A' ? 'Tự khai A' : '' },
      ]),
    ),
    totalPoints: 10,
    submittedAt: '2026-10-15T00:00:00Z',
    declarationSha256: 'a'.repeat(64),
    files: [],
    state: 'WAITING_ADVISOR',
    revision: 0,
    decisions: [],
    historyTruncated: false,
    canAdvisorSign: true,
    canFacultyDecide: false,
    canMonitorConfirm: false,
    canAdvisorBypass: false,
  }
}
function decision(
  action: 'ADVISOR_SIGNED' | 'FACULTY_APPROVED',
  revision: number,
): ReviewDetail['decisions'][number] {
  return {
    id: '00000000-0000-4000-8000-00000000000' + revision,
    revision,
    action,
    actor: {
      userId: '00000000-0000-4000-8000-00000000001' + revision,
      username: 'fake-reviewer-' + revision,
      fullName: action === 'ADVISOR_SIGNED' ? 'Cố vấn giả' : 'Cán bộ khoa giả',
      roleCode: action === 'ADVISOR_SIGNED' ? 'ACADEMIC_ADVISOR' : 'FACULTY_REVIEWER',
    },
    answers: { ...sample().answers, A: { points: 8, note: 'Đối chiếu A' } },
    totalPoints: 8,
    comment: 'Nhận xét giả định',
    declarationSha256: 'a'.repeat(64),
    parentDecisionId: action === 'FACULTY_APPROVED' ? '00000000-0000-4000-8000-000000000001' : null,
    requestId: '00000000-0000-4000-8000-00000000002' + revision,
    inputRevision: revision - 1,
    payloadSha256: 'b'.repeat(64),
    confirmedAt: '2026-10-15T00:10:00Z',
    technicalSignatureStatus: 'NOT_VERIFIED',
    legalEffect: false,
  }
}
function mockApi() {
  return {
    detail: vi.fn().mockResolvedValue(sample()),
    act: vi.fn(),
    own: vi.fn().mockResolvedValue(sample()),
    download: vi.fn(),
    periods: vi.fn().mockResolvedValue({
      items: [{ id: 'period', name: 'Đợt giả', classCode: 'GIA', academicYear: '2026-2027' }],
      truncated: false,
    }),
    queue: vi.fn(),
    exportPeriod: vi.fn(),
    roster: vi.fn().mockResolvedValue(roster('ADVISOR')),
    appointMonitor: vi.fn(),
    monitorAudit: vi.fn().mockResolvedValue({ items: [] }),
  }
}
function roster(viewerRole: ReviewRoster['viewerRole']): ReviewRoster {
  return {
    period: { id: 'period', classCode: 'GIA', name: 'Đợt giả' },
    canAppointMonitor: viewerRole === 'ADVISOR',
    viewerRole,
    monitor: null,
    students: [
      {
        userId: '00000000-0000-4000-8000-000000000101',
        studentCode: 'GIA001',
        fullName: 'Sinh viên giả',
        email: 'gia001@example.invalid',
        cohortYear: 2021,
        dateOfBirth: '2003-05-09',
        declarationState: 'SUBMITTED',
        declarationId: id,
        isMonitor: false,
      },
      {
        userId: '00000000-0000-4000-8000-000000000102',
        studentCode: 'GIA002',
        fullName: 'Sinh viên chưa khai',
        email: null,
        cohortYear: null,
        dateOfBirth: null,
        declarationState: 'NONE',
        declarationId: null,
        isMonitor: false,
      },
    ],
    truncated: false,
  }
}
let api = mockApi()
// ADR 0033: the suggestion/settings panels are covered in activity-suggestions.acceptance.test.ts.
mockNuxtImport('useActivitySuggestions', () => () => ({
  forStudent: () => new Promise(() => {}),
  forReview: () => new Promise(() => {}),
  settings: () => new Promise(() => {}),
}))
mockNuxtImport('useTrainingReviews', () => () => api)
mockNuxtImport('useRoute', () => () => route)
function button(w: VueWrapper, name: string) {
  return w.findAll('button').find((b) => b.text() === name)!
}
beforeEach(() => {
  api = mockApi()
  route.params.id = id
  Object.defineProperty(window, 'confirm', { value: () => true, configurable: true })
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    value: () => {},
    configurable: true,
  })
})
afterEach(() => {
  Reflect.deleteProperty(window, 'confirm')
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
})
describe('training advisor/faculty workflow', () => {
  it('requires an explicit confirmation and keeps original scores separate from reviewed scores', async () => {
    api.act.mockResolvedValue({
      ...sample(),
      state: 'WAITING_FACULTY',
      revision: 1,
      canAdvisorSign: false,
      decisions: [decision('ADVISOR_SIGNED', 1)],
    })
    const w = await mountSuspended(Detail)
    await flushPromises()
    await w.get('#assessed-A').setValue('8')
    await w.get('#review-note-A').setValue('Đối chiếu A')
    await w.get('#review-comment').setValue('Đã kiểm tra')
    await button(w, 'Kiểm tra xác nhận cố vấn').trigger('click')
    expect(api.act).not.toHaveBeenCalled()
    expect(button(w, 'Xác nhận cố vấn').attributes('disabled')).toBeDefined()
    await w.get('#review-confirm input[type="checkbox"]').setValue(true)
    await button(w, 'Xác nhận cố vấn').trigger('click')
    await flushPromises()
    expect(api.act).toHaveBeenCalledWith(
      expect.objectContaining({ id, revision: 0 }),
      'advisor-sign',
      'Đã kiểm tra',
      expect.objectContaining({ A: { points: 8, note: 'Đối chiếu A' } }),
    )
    expect(w.text()).toContain('Chờ khoa')
    expect(w.text()).toContain('Điểm sinh viên tự khai: 10 / 100')
    w.unmount()
  })
  it('conflict retains notes and disables further actions until reload', async () => {
    api.act.mockRejectedValue({ status: 409, message: 'Đã thay đổi', issues: [] })
    const w = await mountSuspended(Detail)
    await flushPromises()
    await w.get('#review-comment').setValue('Giữ lời nhận xét')
    await button(w, 'Kiểm tra xác nhận cố vấn').trigger('click')
    await w.get('#review-confirm input').setValue(true)
    await button(w, 'Xác nhận cố vấn').trigger('click')
    await flushPromises()
    expect((w.get('#review-comment').element as HTMLTextAreaElement).value).toBe('Giữ lời nhận xét')
    expect(button(w, 'Kiểm tra xác nhận cố vấn').attributes('disabled')).toBeDefined()
    expect(w.get('[role="alert"]').text()).toContain('Đã thay đổi')
    w.unmount()
  })
  it('clears private student data when rights are revoked during download', async () => {
    const d = sample()
    d.files = [
      {
        id: 'file',
        criterion: 'A',
        name: 'proof.pdf',
        mimeType: 'application/pdf',
        size: 10,
        sha256: 'a'.repeat(64),
        signatureStatus: 'NOT_CHECKED',
      },
    ]
    api.detail.mockResolvedValue(d)
    api.download.mockRejectedValue({ status: 404, message: 'Đã mất quyền', issues: [] })
    const w = await mountSuspended(Detail)
    await flushPromises()
    await button(w, 'Tải proof.pdf').trigger('click')
    await flushPromises()
    expect(w.text()).not.toContain('GIA001')
    expect(w.find('#review-comment').exists()).toBe(false)
    w.unmount()
  })
  it('late detail response cannot overwrite another declaration', async () => {
    let complete!: (d: ReviewDetail) => void
    api.detail.mockImplementationOnce(
      () =>
        new Promise<ReviewDetail>((resolve) => {
          complete = resolve
        }),
    )
    const w = await mountSuspended(Detail)
    route.params.id = '00000000-0000-4000-8000-000000000003'
    api.detail.mockResolvedValue({
      ...sample(),
      id: route.params.id,
      student: { ...sample().student, fullName: 'Sinh viên thứ hai' },
    })
    await flushPromises()
    complete(sample())
    await flushPromises()
    expect(w.text()).toContain('Sinh viên thứ hai')
    expect(w.text()).not.toContain('Sinh viên giả')
    w.unmount()
  })
  it('class summary counts approved points separately and appends a keyset page', async () => {
    const queue: ReviewQueue = {
      period: {
        id: 'period',
        name: 'Đợt giả',
        classCode: 'GIA',
        academicYear: '2026-2027',
        semester: '1',
        status: 'OPEN',
      },
      summary: {
        submitted: 2,
        waitingMonitor: 0,
        waitingAdvisor: 1,
        waitingFaculty: 0,
        returnedToAdvisor: 0,
        approved: 1,
        approvedTotalPoints: 8,
        approvedAveragePoints: 8,
      },
      items: [
        {
          id,
          student: sample().student,
          selfPoints: 10,
          reviewPoints: 8,
          revision: 2,
          state: 'APPROVED',
        },
      ],
      nextCursor: id,
    }
    api.queue.mockResolvedValueOnce(queue).mockResolvedValueOnce({
      ...queue,
      items: [{ ...queue.items[0]!, id: 'other', state: 'WAITING_ADVISOR' }],
      nextCursor: null,
    })
    const w = await mountSuspended(List)
    await flushPromises()
    expect(w.text()).toContain('Điểm trung bình đã duyệt: 8')
    await button(w, 'Tải thêm bản kê khai').trigger('click')
    await flushPromises()
    expect(api.queue).toHaveBeenLastCalledWith('period', id, undefined)
    expect(w.findAll('li')).toHaveLength(2)
    w.unmount()
  })
  it('student sees own faculty result without presenting account confirmation as verified signature', async () => {
    const d = sample()
    d.state = 'APPROVED'
    d.revision = 2
    d.decisions = [decision('ADVISOR_SIGNED', 1), decision('FACULTY_APPROVED', 2)]
    d.canAdvisorSign = false
    api.own.mockResolvedValue(d)
    const w = await mountSuspended(Result, { props: { declarationId: id } })
    await flushPromises()
    expect(api.own).toHaveBeenCalledWith(id)
    expect(w.text()).toContain('Khoa đã duyệt')
    expect(w.text()).toContain('chưa phải chữ ký số đã xác minh')
    expect(w.text()).toContain('Điểm tự kê khai được giữ riêng')
    w.unmount()
  })
  it('student result reports lost rights so the parent can clear private data and explain the failure', async () => {
    const denied = { status: 403, message: 'Không còn quyền xem kết quả', issues: [] }
    api.own.mockRejectedValue(denied)
    const w = await mountSuspended(Result, { props: { declarationId: id } })
    await flushPromises()
    expect(w.get('[role="alert"]').text()).toContain(denied.message)
    expect(w.emitted('unavailable')?.[0]).toEqual([denied])
    expect(w.find('.tp-score').exists()).toBe(false)
    w.unmount()
  })
  it('blank reviewed points remain unknown and block confirmation while an explicit zero is allowed', async () => {
    const w = await mountSuspended(Detail)
    await flushPromises()
    await w.get('#assessed-A').setValue('')
    await w.get('#assessed-B').setValue('5')
    await w.get('#review-comment').setValue('Kiểm tra ô trống')
    expect(w.text()).toMatch(/Điểm đang đối chiếu:\s*5 \/ 100/)
    await button(w, 'Kiểm tra xác nhận cố vấn').trigger('click')
    await w.get('#review-confirm input').setValue(true)
    expect(button(w, 'Xác nhận cố vấn').attributes('disabled')).toBeDefined()
    expect(api.act).not.toHaveBeenCalled()
    await button(w, 'Quay lại đối chiếu').trigger('click')
    await w.get('#assessed-A').setValue('0')
    expect((w.get('#assessed-A').element as HTMLInputElement).value).toBe('0')
    expect(w.text()).toMatch(/Điểm đang đối chiếu:\s*5 \/ 100/)
    await button(w, 'Kiểm tra xác nhận cố vấn').trigger('click')
    await w.get('#review-confirm input').setValue(true)
    expect(button(w, 'Xác nhận cố vấn').attributes('disabled')).toBeUndefined()
    w.unmount()
  })
})

function exportQueue(): ReviewQueue {
  return {
    period: {
      id: 'period',
      name: 'Đợt giả',
      classCode: 'GIA',
      academicYear: '2026-2027',
      semester: '1',
      status: 'OPEN',
    },
    summary: {
      submitted: 3,
      waitingMonitor: 0,
      waitingAdvisor: 1,
      waitingFaculty: 1,
      returnedToAdvisor: 0,
      approved: 1,
      approvedTotalPoints: 8,
      approvedAveragePoints: 8,
    },
    items: [
      {
        id,
        student: sample().student,
        selfPoints: 10,
        reviewPoints: 8,
        revision: 2,
        state: 'APPROVED',
      },
    ],
    nextCursor: null,
  }
}
describe('training export panel', () => {
  it('previews scope and counts, blocks double clicks and reports the snapshot and hash', async () => {
    api.queue.mockResolvedValue(exportQueue())
    let resolve!: (v: unknown) => void
    api.exportPeriod.mockReturnValue(new Promise((r) => (resolve = r)))
    const w = await mountSuspended(List)
    await flushPromises()
    expect(w.text()).toContain('Sẽ xuất 1 bản khoa đã duyệt.')
    expect(w.text()).toContain('2 bản chưa duyệt chỉ được đếm trong thống kê')
    await button(w, 'Tải gói ZIP').trigger('click')
    await flushPromises()
    expect(api.exportPeriod).toHaveBeenCalledWith('period', 'zip')
    expect(button(w, 'Tải Excel').attributes('disabled')).toBeDefined()
    await button(w, 'Tải PDF').trigger('click')
    expect(api.exportPeriod).toHaveBeenCalledTimes(1)
    resolve({
      name: 'training-export-x.zip',
      size: 2048,
      snapshotId: '10000000-0000-4000-8000-000000000001',
      sha256: 'c'.repeat(64),
      verified: true,
    })
    await flushPromises()
    expect(w.text()).toContain('Đã tải training-export-x.zip (2 KB)')
    expect(w.text()).toContain('10000000-0000-4000-8000-000000000001')
    expect(w.text()).toContain('đã đối chiếu trên trình duyệt')
    expect(w.text()).toContain('không phải chữ ký số')
    expect(button(w, 'Tải Excel').attributes('disabled')).toBeUndefined()
    w.unmount()
  })
  it('class sheet button requests the school-format class sheet', async () => {
    api.queue.mockResolvedValue(exportQueue())
    api.exportPeriod.mockResolvedValue({
      name: 'training-class-sheet-x.xlsx',
      size: 4096,
      snapshotId: '10000000-0000-4000-8000-000000000001',
      sha256: 'd'.repeat(64),
      verified: true,
    })
    const w = await mountSuspended(List)
    await flushPromises()
    await button(w, 'Tải bảng điểm lớp').trigger('click')
    await flushPromises()
    expect(api.exportPeriod).toHaveBeenCalledWith('period', 'class-sheet')
    expect(w.text()).toContain('Đã tải training-class-sheet-x.xlsx')
    w.unmount()
  })
  it('converter failures stay on the panel without clearing the class data', async () => {
    api.queue.mockResolvedValue(exportQueue())
    api.exportPeriod.mockRejectedValue({
      status: 503,
      message: 'Chưa tạo được PDF biên bản. Bạn vẫn có thể tải bản Word.',
      issues: [],
    })
    const w = await mountSuspended(List)
    await flushPromises()
    await button(w, 'Tải PDF').trigger('click')
    await flushPromises()
    expect(w.get('#training-export-error').text()).toContain('vẫn có thể tải bản Word')
    expect(w.text()).toContain('Sinh viên giả')
    w.unmount()
  })
  it('lost rights during export clear every private row and the period list', async () => {
    api.queue.mockResolvedValue(exportQueue())
    api.exportPeriod.mockRejectedValue({
      status: 403,
      message: 'Tài khoản hiện không có quyền sử dụng chức năng trong phạm vi này.',
      issues: [],
    })
    const w = await mountSuspended(List)
    await flushPromises()
    expect(w.text()).toContain('Sinh viên giả')
    await button(w, 'Tải Excel').trigger('click')
    await flushPromises()
    expect(w.text()).not.toContain('Sinh viên giả')
    expect(w.text()).not.toContain('Sẽ xuất')
    expect(w.find('#review-period option[value="period"]').exists()).toBe(false)
    expect(w.text()).toContain('không có quyền')
    w.unmount()
  })
})
describe('class monitor (ADR 0028)', () => {
  it('monitor confirms without sending scores and sees the self-declared total', async () => {
    api.detail.mockResolvedValue({
      ...sample(),
      state: 'WAITING_MONITOR',
      canAdvisorSign: false,
      canMonitorConfirm: true,
    })
    api.act.mockResolvedValue({ ...sample(), canMonitorConfirm: false, canAdvisorSign: false })
    const w = await mountSuspended(Detail)
    await flushPromises()
    expect(button(w, 'Kiểm tra xác nhận cố vấn')).toBeUndefined()
    await w.get('#review-comment').setValue('Đã kiểm tra minh chứng')
    await button(w, 'Kiểm tra xác nhận của lớp trưởng').trigger('click')
    expect(w.get('#review-confirm').text()).toContain('Giữ nguyên điểm sinh viên tự khai: 10 / 100')
    await w.get('#review-confirm input[type="checkbox"]').setValue(true)
    await w.get('#review-confirm button').trigger('click')
    await flushPromises()
    expect(api.act).toHaveBeenCalledWith(
      expect.objectContaining({ id }),
      'monitor-confirm',
      'Đã kiểm tra minh chứng',
      expect.anything(),
    )
    w.unmount()
  })
  it('advisor may bypass a waiting monitor step only with a reason', async () => {
    api.detail.mockResolvedValue({
      ...sample(),
      state: 'WAITING_MONITOR',
      canAdvisorSign: false,
      canAdvisorBypass: true,
    })
    const w = await mountSuspended(Detail)
    await flushPromises()
    await button(w, 'Bỏ qua bước lớp trưởng').trigger('click')
    await w.get('#review-confirm input[type="checkbox"]').setValue(true)
    expect(w.get('#review-confirm button').attributes('disabled')).toBeDefined()
    expect(api.act).not.toHaveBeenCalled()
    w.unmount()
  })
  it('monitor sees the roster with date of birth and only the class sheet export', async () => {
    api.queue.mockResolvedValue(exportQueue())
    api.roster.mockResolvedValue(roster('MONITOR'))
    api.exportPeriod.mockResolvedValue({
      name: 'training-form-x.docx',
      size: 1024,
      snapshotId: '10000000-0000-4000-8000-000000000001',
      sha256: 'e'.repeat(64),
      verified: true,
    })
    const w = await mountSuspended(List)
    await flushPromises()
    expect(w.text()).toContain('09/05/2003')
    expect(w.text()).toContain('Chưa có')
    expect(button(w, 'Tải bảng điểm lớp')).toBeDefined()
    expect(button(w, 'Tải gói ZIP')).toBeUndefined()
    expect(button(w, 'Tải Excel')).toBeUndefined()
    expect(w.find('#monitor-candidate').exists()).toBe(false)
    // Only the submitted declaration offers printing.
    expect(w.findAll('button').filter((b) => b.text() === 'Word')).toHaveLength(1)
    await button(w, 'Word').trigger('click')
    await flushPromises()
    expect(api.exportPeriod).toHaveBeenCalledWith('period', 'form-docx', id)
    expect(w.text()).toContain('Đã tải training-form-x.docx.')
    w.unmount()
  })
  it('advisor appoints a monitor and reads the monitor audit log', async () => {
    api.queue.mockResolvedValue(exportQueue())
    const appointed = roster('ADVISOR')
    appointed.monitor = {
      userId: appointed.students[0]!.userId,
      fullName: 'Sinh viên giả',
      validFrom: '2026-10-01T00:00:00Z',
      validTo: null,
    }
    api.appointMonitor.mockResolvedValue(appointed)
    api.monitorAudit.mockResolvedValue({
      items: [
        {
          id: 'a1',
          occurredAt: '2026-10-02T00:00:00Z',
          actor: 'gia001',
          action: 'training.monitor.declaration_viewed',
          metadata: {},
        },
      ],
    })
    const w = await mountSuspended(List)
    await flushPromises()
    expect(w.text()).toContain('Chưa bổ nhiệm')
    await w.get('#monitor-candidate').setValue(appointed.students[0]!.userId)
    await button(w, 'Bổ nhiệm').trigger('click')
    await flushPromises()
    expect(api.appointMonitor).toHaveBeenCalledWith('period', appointed.students[0]!.userId)
    expect(w.text()).toContain('Đã bổ nhiệm lớp trưởng.')
    await button(w, 'Xem nhật ký lớp trưởng').trigger('click')
    await flushPromises()
    expect(w.text()).toContain('Xem phiếu')
    w.unmount()
  })
})
