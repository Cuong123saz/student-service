import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SubmissionIntake from '../../app/components/SubmissionIntake.vue'
import type { ReviewSubmissionDetail } from '../../app/types/submission'

function sample(): ReviewSubmissionDetail {
  return {
    id: 'submission-1',
    serviceId: 1,
    serviceName: 'Xác nhận học tập',
    status: 'SUBMITTED',
    roundNumber: 1,
    lastSubmittedAt: '2026-10-09T01:00:00Z',
    decisionAt: null,
    rounds: [],
    events: [],
    allowedActions: [],
    revision: 3,
    submittedAt: '2026-10-09T01:00:00Z',
    reviewStartedAt: null,
    processingUnitName: 'Phòng CTSV',
    student: { fullName: 'Nguyễn Minh An', studentCode: 'SV001' },
    reviewerName: null,
    canClaim: true,
    studentSnapshot: {
      fullName: 'Nguyễn Minh An',
      studentCode: 'SV001',
      classCode: 'K20A',
      facultyCode: 'QLGD',
    },
    procedure: {
      versionId: 'version-1',
      versionNumber: 1,
      processingMode: 'ONLINE',
      processingUnitName: 'Phòng CTSV',
      contactInstructions: 'Hướng dẫn tiếp nhận',
      maxTotalAttachmentBytes: 5242880,
      fields: [
        {
          key: 'text',
          label: 'Thông tin',
          type: 'TEXT',
          source: 'STUDENT_INPUT',
          profileKey: null,
          required: true,
          maxLength: 200,
          options: [],
        },
        {
          key: 'long',
          label: 'Nội dung',
          type: 'TEXTAREA',
          source: 'STUDENT_INPUT',
          profileKey: null,
          required: false,
          maxLength: 500,
          options: [],
        },
        {
          key: 'number',
          label: 'Số bản',
          type: 'NUMBER',
          source: 'STUDENT_INPUT',
          profileKey: null,
          required: true,
          maxLength: 20,
          options: [],
        },
        {
          key: 'date',
          label: 'Ngày cần',
          type: 'DATE',
          source: 'STUDENT_INPUT',
          profileKey: null,
          required: true,
          maxLength: 20,
          options: [],
        },
        {
          key: 'select',
          label: 'Mục đích',
          type: 'SELECT',
          source: 'STUDENT_INPUT',
          profileKey: null,
          required: true,
          maxLength: 20,
          options: [{ value: 'study', label: 'Học tập' }],
        },
        {
          key: 'boolean',
          label: 'Đã nhận trước đây',
          type: 'BOOLEAN',
          source: 'STUDENT_INPUT',
          profileKey: null,
          required: true,
          maxLength: 20,
          options: [],
        },
      ],
      attachments: [
        {
          key: 'proof',
          label: 'Giấy tờ',
          required: true,
          mimeTypes: ['application/pdf'],
          maxFiles: 1,
          maxBytes: 5242880,
        },
      ],
    },
    values: {
      text: '<script>alert(1)</script>',
      long: 'Dòng 1\nDòng 2',
      number: 0,
      date: '2026-10-09',
      select: 'study',
      boolean: false,
    },
    files: [
      {
        id: 'file-1',
        attachmentKey: 'proof',
        name: 'proof.pdf',
        mimeType: 'application/pdf',
        size: 1024,
        sha256: 'a'.repeat(64),
        signatureStatus: 'NOT_CHECKED',
      },
    ],
  }
}
function createApi() {
  return {
    list: vi.fn(),
    get: vi.fn(),
    claim: vi.fn(),
    resolve: vi.fn(),
    roundDownloadUrl: vi.fn(
      (id, roundNumber, fileId) => '/history/' + id + '/' + roundNumber + '/' + fileId,
    ),
    downloadUrl: vi.fn((id: string, fileId: string) => '/private/' + id + '/' + fileId),
  }
}
let api = createApi()
let requestedPortal = ''
mockNuxtImport('useReviewSubmissions', () => (portal: string) => {
  requestedPortal = portal
  return api
})
beforeEach(() => {
  api = createApi()
  requestedPortal = ''
})
function button(wrapper: Awaited<ReturnType<typeof mountSuspended>>, label: string) {
  return wrapper.findAll('button').find((item) => item.text() === label)!
}

describe('submission intake', () => {
  it('shows loading, then the empty queue without inventing counts outside scope', async () => {
    let resolve!: (value: []) => void
    api.list.mockReturnValue(
      new Promise<[]>((done) => {
        resolve = done
      }),
    )
    const wrapper = await mountSuspended(SubmissionIntake, { props: { portal: 'user' } })
    expect(wrapper.text()).toContain('Đang tải hồ sơ…')
    resolve([])
    await flushPromises()
    expect(wrapper.text()).toContain('Chưa có hồ sơ chờ tiếp nhận')
    expect(api.list).toHaveBeenCalledWith('SUBMITTED')
    expect(wrapper.find('.intake-list').exists()).toBe(false)
    expect(requestedPortal).toBe('user')
    wrapper.unmount()
  })
  it('provides a retry for queue errors and preserves server order and real status', async () => {
    const first = sample()
    const second = {
      ...sample(),
      id: 'submission-2',
      status: 'SUBMITTED' as const,
      reviewerName: null,
    }
    api.list
      .mockRejectedValueOnce({ status: 503, message: 'Chưa tải được hàng đợi', issues: [] })
      .mockResolvedValueOnce([first, second])
    const wrapper = await mountSuspended(SubmissionIntake, { props: { portal: 'admin' } })
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Chưa tải được hàng đợi')
    await button(wrapper, 'Thử lại').trigger('click')
    await flushPromises()
    const links = wrapper.findAll('.intake-list a')
    expect(links.map((link) => link.attributes('href'))).toEqual([
      '/admin/review-submissions/submission-1',
      '/admin/review-submissions/submission-2',
    ])
    expect(links[0]!.text()).toContain('SV001')
    expect(links[0]!.text()).toContain('Đã gửi · Chờ tiếp nhận')
    expect(links[1]!.text()).toContain('Đã gửi · Chờ tiếp nhận')
    expect(api.list).toHaveBeenLastCalledWith('SUBMITTED')
    expect(requestedPortal).toBe('admin')
    wrapper.unmount()
  })
  it('shows the four-field snapshot, all answer types and authorized file links as read-only content', async () => {
    api.get.mockResolvedValue(sample())
    const wrapper = await mountSuspended(SubmissionIntake, {
      props: { portal: 'user', id: 'submission-1' },
    })
    await flushPromises()
    expect(api.get).toHaveBeenCalledWith('submission-1')
    for (const value of [
      'Nguyễn Minh An',
      'SV001',
      'K20A',
      'QLGD',
      '<script>alert(1)</script>',
      'Dòng 1',
      '0',
      '09/10/2026',
      'Học tập',
      'Không',
    ])
      expect(wrapper.text()).toContain(value)
    expect(wrapper.find('script, input, select, textarea').exists()).toBe(false)
    expect(wrapper.get('.intake-files a').attributes('href')).toBe('/private/submission-1/file-1')
    expect(wrapper.text()).toContain('Chữ ký chưa được xác minh')
    expect(wrapper.text()).not.toContain('a'.repeat(64))
    wrapper.unmount()
  })
  it('receives a submission once and uses the resulting handler/status from the server', async () => {
    api.get.mockResolvedValue(sample())
    let resolve!: (value: ReviewSubmissionDetail) => void
    api.claim.mockReturnValue(
      new Promise<ReviewSubmissionDetail>((done) => {
        resolve = done
      }),
    )
    const wrapper = await mountSuspended(SubmissionIntake, {
      props: { portal: 'admin', id: 'submission-1' },
    })
    await flushPromises()
    await button(wrapper, 'Nhận xử lý').trigger('click')
    expect(api.claim).toHaveBeenCalledWith('submission-1', 3)
    expect(button(wrapper, 'Nhận xử lý').attributes('disabled')).toBeDefined()
    await button(wrapper, 'Nhận xử lý').trigger('click')
    expect(api.claim).toHaveBeenCalledOnce()
    resolve({
      ...sample(),
      status: 'IN_REVIEW',
      revision: 4,
      reviewerName: 'Cán bộ A',
      canClaim: false,
      reviewStartedAt: '2026-10-09T02:00:00Z',
    })
    await flushPromises()
    expect(wrapper.text()).toContain('Đã nhận hồ sơ để xử lý.')
    expect(wrapper.text()).toContain('Đang xử lý')
    expect(wrapper.text()).toContain('Cán bộ A')
    expect(wrapper.findAll('button').some((item) => item.text() === 'Nhận xử lý')).toBe(false)
    wrapper.unmount()
  })
  it.each([409, 503, undefined])(
    'keeps detail after failed claim and requires successful reload before retry (%s)',
    async (status) => {
      api.get
        .mockResolvedValueOnce(sample())
        .mockRejectedValueOnce({ status: 503, message: 'Tải lại chưa được', issues: [] })
        .mockResolvedValueOnce({
          ...sample(),
          status: 'IN_REVIEW',
          revision: 4,
          canClaim: false,
          reviewerName: 'Cán bộ khác',
        })
      api.claim.mockRejectedValue({ status, message: 'Không xác nhận được nhận xử lý', issues: [] })
      const wrapper = await mountSuspended(SubmissionIntake, {
        props: { portal: 'user', id: 'submission-1' },
        attachTo: document.body,
      })
      await flushPromises()
      await button(wrapper, 'Nhận xử lý').trigger('click')
      await flushPromises()
      expect(wrapper.text()).toContain('Nguyễn Minh An')
      expect(wrapper.text()).toContain('lần tải thành công trước')
      expect(document.activeElement).toBe(wrapper.get('[role="alert"]').element)
      expect(button(wrapper, 'Nhận xử lý').attributes('disabled')).toBeDefined()
      await button(wrapper, 'Tải lại trạng thái hồ sơ').trigger('click')
      await flushPromises()
      expect(button(wrapper, 'Nhận xử lý').attributes('disabled')).toBeDefined()
      await button(wrapper, 'Nhận xử lý').trigger('click')
      expect(api.claim).toHaveBeenCalledOnce()
      await button(wrapper, 'Tải lại trạng thái hồ sơ').trigger('click')
      await flushPromises()
      expect(wrapper.text()).toContain('Cán bộ khác')
      expect(wrapper.text()).toContain('Đang xử lý')
      expect(wrapper.find('[role="alert"]').exists()).toBe(false)
      wrapper.unmount()
    },
  )
  it('does not offer claim when the server withholds canClaim', async () => {
    api.get.mockResolvedValue({ ...sample(), canClaim: false })
    const wrapper = await mountSuspended(SubmissionIntake, {
      props: { portal: 'user', id: 'submission-1' },
    })
    await flushPromises()
    expect(wrapper.findAll('button').some((item) => item.text() === 'Nhận xử lý')).toBe(false)
    expect(wrapper.text()).toContain('Bạn hiện không thể nhận xử lý hồ sơ này.')
    expect(api.claim).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it('loads each status from the server, clears old rows while loading, and shows an empty group', async () => {
    let resolve!: (value: ReviewSubmissionDetail[]) => void
    api.list
      .mockResolvedValueOnce([sample()])
      .mockReturnValueOnce(
        new Promise<ReviewSubmissionDetail[]>((done) => {
          resolve = done
        }),
      )
      .mockResolvedValueOnce([])
      .mockResolvedValue([])
    const wrapper = await mountSuspended(SubmissionIntake, { props: { portal: 'user' } })
    await flushPromises()
    expect(button(wrapper, 'Chờ tiếp nhận').attributes('aria-pressed')).toBe('true')
    expect(button(wrapper, 'Đang xử lý').attributes('aria-pressed')).toBe('false')
    expect(wrapper.text()).toContain('Tối đa 50 hồ sơ trong nhóm đang chọn')
    await button(wrapper, 'Đang xử lý').trigger('click')
    expect(api.list).toHaveBeenLastCalledWith('IN_REVIEW')
    expect(wrapper.find('.intake-list').exists()).toBe(false)
    expect(wrapper.text()).toContain('Đang tải hồ sơ…')
    expect(button(wrapper, 'Đang xử lý').attributes('disabled')).toBeDefined()
    resolve([{ ...sample(), status: 'IN_REVIEW', canClaim: false, reviewerName: 'Cán bộ B' }])
    await flushPromises()
    expect(button(wrapper, 'Đang xử lý').attributes('aria-pressed')).toBe('true')
    expect(wrapper.get('.intake-list').text()).toContain('Cán bộ B')
    await button(wrapper, 'Chờ tiếp nhận').trigger('click')
    await flushPromises()
    expect(api.list).toHaveBeenLastCalledWith('SUBMITTED')
    expect(wrapper.find('.intake-list').exists()).toBe(false)
    expect(wrapper.text()).toContain('Chưa có hồ sơ chờ tiếp nhận')
    await button(wrapper, 'Đang xử lý').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Chưa có hồ sơ đang xử lý')
    wrapper.unmount()
  })
  it('blocks claiming stale detail when a status reload fails and rechecks server capability', async () => {
    api.get
      .mockResolvedValueOnce(sample())
      .mockRejectedValueOnce({ status: 403, message: 'Quyền tiếp nhận đã thay đổi', issues: [] })
      .mockResolvedValueOnce({ ...sample(), canClaim: false })
    const wrapper = await mountSuspended(SubmissionIntake, {
      props: { portal: 'user', id: 'submission-1' },
    })
    await flushPromises()
    expect(wrapper.find('.intake-filters').exists()).toBe(false)
    await button(wrapper, 'Tải lại').trigger('click')
    await flushPromises()
    expect(button(wrapper, 'Nhận xử lý').attributes('disabled')).toBeDefined()
    await button(wrapper, 'Nhận xử lý').trigger('click')
    expect(api.claim).not.toHaveBeenCalled()
    await button(wrapper, 'Tải lại trạng thái hồ sơ').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Bạn hiện không thể nhận xử lý hồ sơ này.')
    expect(wrapper.findAll('button').some((item) => item.text() === 'Nhận xử lý')).toBe(false)
    wrapper.unmount()
  })
  it('does not apply a delayed claim response to another submission after navigation', async () => {
    let resolve!: (value: ReviewSubmissionDetail) => void
    api.get.mockResolvedValueOnce(sample()).mockResolvedValueOnce({
      ...sample(),
      id: 'submission-2',
      serviceName: 'Hồ sơ thứ hai',
      canClaim: false,
    })
    api.claim.mockReturnValue(
      new Promise<ReviewSubmissionDetail>((done) => {
        resolve = done
      }),
    )
    const wrapper = await mountSuspended(SubmissionIntake, {
      props: { portal: 'user', id: 'submission-1' },
    })
    await flushPromises()
    await button(wrapper, 'Nhận xử lý').trigger('click')
    await wrapper.setProps({ id: 'submission-2' })
    await flushPromises()
    expect(api.get).toHaveBeenLastCalledWith('submission-2')
    expect(wrapper.text()).toContain('Hồ sơ thứ hai')
    resolve({ ...sample(), status: 'IN_REVIEW', canClaim: false })
    await flushPromises()
    expect(wrapper.text()).toContain('Hồ sơ thứ hai')
    expect(wrapper.text()).not.toContain('Đã nhận hồ sơ để xử lý.')
    expect(wrapper.get('.intake-files a').attributes('href')).toBe('/private/submission-2/file-1')
    wrapper.unmount()
  })
  it('offers an appropriate sign-in route when detail cannot be loaded', async () => {
    api.get.mockRejectedValue({ status: 401, message: 'Phiên đã hết hạn', issues: [] })
    const wrapper = await mountSuspended(SubmissionIntake, {
      props: { portal: 'admin', id: 'submission-1' },
    })
    await flushPromises()
    expect(wrapper.get('[role="alert"] a').attributes('href')).toBe('/admin/login')
    expect(wrapper.find('.intake-columns').exists()).toBe(false)
    expect(api.claim).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})

function processing(): ReviewSubmissionDetail {
  const initial = sample()
  return {
    ...initial,
    status: 'IN_REVIEW',
    revision: 4,
    canClaim: false,
    reviewerName: 'Cán bộ A',
    reviewStartedAt: '2026-10-10T02:00:00Z',
    allowedActions: ['REQUEST_SUPPLEMENT', 'APPROVE', 'REJECT'],
    rounds: [
      {
        roundNumber: 1,
        submittedAt: initial.submittedAt,
        studentSnapshot: initial.studentSnapshot,
        values: initial.values,
        files: initial.files,
        source: 'MIGRATION',
      },
    ],
    events: [
      {
        id: 'claim-1',
        roundNumber: 1,
        action: 'CLAIMED',
        actorName: 'Cán bộ A',
        note: null,
        createdAt: '2026-10-10T02:00:00Z',
      },
    ],
  }
}
async function reviewDecision(
  wrapper: Awaited<ReturnType<typeof mountSuspended>>,
  action = 'REQUEST_SUPPLEMENT',
  note = 'Bổ sung minh chứng đúng nội dung',
) {
  await wrapper.get('#resolution-action').setValue(action)
  await wrapper.get('#resolution-note').setValue(note)
  await button(wrapper, 'Xem lại quyết định').trigger('click')
}
describe('submission resolution', () => {
  it.each([
    ['REQUEST_SUPPLEMENT', 'NEEDS_SUPPLEMENT', 'Chờ bổ sung'],
    ['APPROVE', 'APPROVED', 'Đã duyệt nội dung'],
    ['REJECT', 'REJECTED', 'Không chấp thuận'],
  ] as const)(
    'requires review and explicit confirmation for %s and uses the returned status',
    async (action, status, label) => {
      api.get.mockResolvedValue(processing())
      let finish!: (value: ReviewSubmissionDetail) => void
      api.resolve.mockReturnValue(
        new Promise<ReviewSubmissionDetail>((resolve) => {
          finish = resolve
        }),
      )
      const wrapper = await mountSuspended(SubmissionIntake, {
        props: { portal: 'user', id: 'submission-1' },
        attachTo: document.body,
      })
      await flushPromises()
      expect(wrapper.text()).toContain('chưa cấp văn bản hoặc xác minh chữ ký số')
      await reviewDecision(wrapper, action, '  Lý do xử lý rõ ràng  ')
      expect(document.activeElement).toBe(wrapper.get('.resolution-summary').element)
      expect(button(wrapper, 'Ghi quyết định').attributes('disabled')).toBeDefined()
      await button(wrapper, 'Ghi quyết định').trigger('click')
      expect(api.resolve).not.toHaveBeenCalled()
      await wrapper.get('#resolution-confirm').setValue(true)
      await button(wrapper, 'Ghi quyết định').trigger('click')
      await button(wrapper, 'Ghi quyết định').trigger('click')
      expect(api.resolve).toHaveBeenCalledExactlyOnceWith(
        'submission-1',
        4,
        action,
        'Lý do xử lý rõ ràng',
      )
      finish({
        ...processing(),
        status,
        revision: 5,
        allowedActions: [],
        decisionAt: status === 'NEEDS_SUPPLEMENT' ? null : '2026-10-10T03:00:00Z',
      })
      await flushPromises()
      expect(wrapper.text()).toContain(label)
      expect(wrapper.find('#resolution-action').exists()).toBe(false)
      expect(wrapper.text()).toContain('Chữ ký chưa được xác minh')
      wrapper.unmount()
    },
  )
  it('does not offer actions withheld by the server and keeps submitted round downloads independent of current files', async () => {
    api.get.mockResolvedValue({ ...processing(), allowedActions: ['APPROVE'] })
    const wrapper = await mountSuspended(SubmissionIntake, {
      props: { portal: 'admin', id: 'submission-1' },
    })
    await flushPromises()
    expect(
      wrapper.findAll('#resolution-action option').map((option) => option.attributes('value')),
    ).toEqual(['', 'APPROVE'])
    expect(wrapper.get('.history-files a').attributes('href')).toBe(
      '/history/submission-1/1/file-1',
    )
    expect(wrapper.get('.history-round').text()).toContain('không có diễn biến thao tác trước đó')
    expect(wrapper.get('.history-events').text()).toContain('Cán bộ nhận xử lý')
    expect(wrapper.find('script').exists()).toBe(false)
    wrapper.unmount()
  })
  it('requires a trimmed note of at most 2000 characters and resets review after editing it', async () => {
    api.get.mockResolvedValue(processing())
    const wrapper = await mountSuspended(SubmissionIntake, {
      props: { portal: 'user', id: 'submission-1' },
    })
    await flushPromises()
    await wrapper.get('#resolution-action').setValue('APPROVE')
    for (const note of ['   ', 'x'.repeat(2001)]) {
      await wrapper.get('#resolution-note').setValue(note)
      expect(button(wrapper, 'Xem lại quyết định').attributes('disabled')).toBeDefined()
      expect(wrapper.get('#resolution-note').attributes('aria-invalid')).toBe('true')
    }
    await reviewDecision(wrapper, 'APPROVE', '<script>plain note</script>')
    expect(wrapper.get('.resolution-summary').text()).toContain('<script>plain note</script>')
    expect(wrapper.find('script').exists()).toBe(false)
    await wrapper.get('#resolution-confirm').setValue(true)
    await wrapper.get('#resolution-note').setValue('Đổi lý do')
    expect(wrapper.find('.resolution-summary').exists()).toBe(false)
    expect(api.resolve).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it.each([409, 503, undefined])(
    'retains reason after uncertain or conflicting resolution and requires successful GET (%s)',
    async (status) => {
      api.get
        .mockResolvedValueOnce(processing())
        .mockRejectedValueOnce({ status: 503, message: 'Chưa tải được', issues: [] })
        .mockResolvedValueOnce({ ...processing(), revision: 5 })
      api.resolve.mockRejectedValue({ status, message: 'Cần kiểm tra quyết định', issues: [] })
      const wrapper = await mountSuspended(SubmissionIntake, {
        props: { portal: 'user', id: 'submission-1' },
      })
      await flushPromises()
      await reviewDecision(wrapper)
      await wrapper.get('#resolution-confirm').setValue(true)
      await button(wrapper, 'Ghi quyết định').trigger('click')
      await flushPromises()
      expect(wrapper.get('#resolution-note').element).toHaveProperty(
        'value',
        'Bổ sung minh chứng đúng nội dung',
      )
      expect(wrapper.get('.resolution-fields').attributes('disabled')).toBeDefined()
      await button(wrapper, 'Tải lại trạng thái hồ sơ').trigger('click')
      await flushPromises()
      expect(wrapper.get('.resolution-fields').attributes('disabled')).toBeDefined()
      await button(wrapper, 'Tải lại trạng thái hồ sơ').trigger('click')
      await flushPromises()
      expect(wrapper.get('#resolution-note').element).toHaveProperty(
        'value',
        'Bổ sung minh chứng đúng nội dung',
      )
      expect(wrapper.find('#resolution-confirm').exists()).toBe(false)
      expect(api.resolve).toHaveBeenCalledOnce()
      wrapper.unmount()
    },
  )
  it('hides decisions from a scoped reader who is not the assigned reviewer and shows supplement reason as text', async () => {
    const initial = processing()
    api.get.mockResolvedValue({
      ...initial,
      status: 'NEEDS_SUPPLEMENT',
      allowedActions: [],
      events: [
        ...initial.events,
        {
          id: 'supplement-1',
          roundNumber: 1,
          action: 'SUPPLEMENT_REQUESTED',
          actorName: 'Cán bộ A',
          note: '<b>Thiếu minh chứng</b>',
          createdAt: '2026-10-10T03:00:00Z',
        },
      ],
    })
    const wrapper = await mountSuspended(SubmissionIntake, {
      props: { portal: 'admin', id: 'submission-1' },
    })
    await flushPromises()
    expect(wrapper.find('#resolution-note').exists()).toBe(false)
    expect(wrapper.text()).toContain('phần sinh viên đang sửa chưa được chuyển đến cán bộ')
    expect(wrapper.get('.history-events').text()).toContain('<b>Thiếu minh chứng</b>')
    expect(wrapper.find('.history-events b').exists()).toBe(false)
    wrapper.unmount()
  })
  it.each(['NEEDS_SUPPLEMENT', 'APPROVED', 'REJECTED'] as const)(
    'loads the separate %s queue before limit is applied by the server',
    async (status) => {
      api.list.mockResolvedValue([])
      const wrapper = await mountSuspended(SubmissionIntake, { props: { portal: 'user' } })
      await flushPromises()
      expect(wrapper.findAll('.intake-filters button')).toHaveLength(5)
      const label =
        status === 'NEEDS_SUPPLEMENT'
          ? 'Chờ bổ sung'
          : status === 'APPROVED'
            ? 'Đã duyệt nội dung'
            : 'Không chấp thuận'
      await button(wrapper, label).trigger('click')
      await flushPromises()
      expect(api.list).toHaveBeenLastCalledWith(status)
      expect(button(wrapper, label).attributes('aria-pressed')).toBe('true')
      expect(wrapper.get('.intake-empty').text()).toContain('Chưa có hồ sơ')
      wrapper.unmount()
    },
  )
  it('drops a late resolution response after navigation without clearing the new detail', async () => {
    let finish!: (value: ReviewSubmissionDetail) => void
    api.get
      .mockResolvedValueOnce(processing())
      .mockResolvedValueOnce({ ...sample(), id: 'submission-2', serviceName: 'Hồ sơ khác' })
    api.resolve.mockReturnValue(
      new Promise<ReviewSubmissionDetail>((resolve) => {
        finish = resolve
      }),
    )
    const wrapper = await mountSuspended(SubmissionIntake, {
      props: { portal: 'user', id: 'submission-1' },
    })
    await flushPromises()
    await reviewDecision(wrapper)
    await wrapper.get('#resolution-confirm').setValue(true)
    await button(wrapper, 'Ghi quyết định').trigger('click')
    await wrapper.setProps({ id: 'submission-2' })
    await flushPromises()
    finish({ ...processing(), status: 'APPROVED', allowedActions: [] })
    await flushPromises()
    expect(wrapper.text()).toContain('Hồ sơ khác')
    expect(wrapper.text()).not.toContain('Đã ghi quyết định duyệt nội dung.')
    expect(wrapper.get('.intake-files a').attributes('href')).toBe('/private/submission-2/file-1')
    wrapper.unmount()
  })
})

describe('resolution response recovery', () => {
  it('preserves a rejected note and exposes the server issue beside the reason field', async () => {
    api.get.mockResolvedValue(processing())
    api.resolve.mockRejectedValue({
      status: 422,
      message: 'Kiểm tra lý do',
      issues: [{ path: 'note', message: 'Lý do phải có 1–2000 ký tự' }],
    })
    const wrapper = await mountSuspended(SubmissionIntake, {
      props: { portal: 'user', id: 'submission-1' },
    })
    await flushPromises()
    await reviewDecision(wrapper, 'REJECT', 'Lý do đang nhập')
    await wrapper.get('#resolution-confirm').setValue(true)
    await button(wrapper, 'Ghi quyết định').trigger('click')
    await flushPromises()
    expect(wrapper.get('#resolution-note').element).toHaveProperty('value', 'Lý do đang nhập')
    expect(wrapper.get('#resolution-note').attributes('aria-invalid')).toBe('true')
    expect(wrapper.get('#resolution-note').attributes('aria-describedby')).toContain(
      'resolution-note-error',
    )
    expect(wrapper.get('#resolution-note-error').text()).toBe('Lý do phải có 1–2000 ký tự')
    expect(wrapper.find('#resolution-confirm').exists()).toBe(false)
    wrapper.unmount()
  })
  it('keeps the local reason for comparison when status check confirms an already committed decision', async () => {
    api.get.mockResolvedValueOnce(processing()).mockResolvedValueOnce({
      ...processing(),
      status: 'APPROVED',
      revision: 5,
      allowedActions: [],
      events: [
        {
          id: 'approved-1',
          roundNumber: 1,
          action: 'APPROVED',
          actorName: 'Cán bộ A',
          note: 'Đủ thông tin đã đối chiếu',
          createdAt: '2026-10-10T04:00:00Z',
        },
      ],
    })
    api.resolve.mockRejectedValue({ message: 'Mất phản hồi', issues: [] })
    const wrapper = await mountSuspended(SubmissionIntake, {
      props: { portal: 'admin', id: 'submission-1' },
    })
    await flushPromises()
    await reviewDecision(wrapper, 'APPROVE', 'Đủ thông tin đã đối chiếu')
    await wrapper.get('#resolution-confirm').setValue(true)
    await button(wrapper, 'Ghi quyết định').trigger('click')
    await flushPromises()
    await button(wrapper, 'Tải lại trạng thái hồ sơ').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Đã duyệt nội dung')
    expect(wrapper.find('#resolution-note').exists()).toBe(false)
    expect(wrapper.text()).toContain('Lý do đã nhập trước khi kiểm tra trạng thái')
    expect(wrapper.get('.history-events').text()).toContain('Đủ thông tin đã đối chiếu')
    expect(api.resolve).toHaveBeenCalledOnce()
    wrapper.unmount()
  })
})
