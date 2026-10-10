import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import StudentDraftEditor from '../../app/components/StudentDraftEditor.vue'
import type { StudentDraft } from '../../app/types/submission'
function sample(): StudentDraft {
  return {
    id: 'draft-1',
    serviceId: 1,
    serviceName: 'Thủ tục thử nghiệm',
    revision: 1,
    status: 'DRAFT',
    roundNumber: 0,
    lastSubmittedAt: null,
    decisionAt: null,
    rounds: [],
    events: [],
    submittedAt: null,
    reviewStartedAt: null,
    editable: true,
    readOnlyReason: null,
    updatedAt: '2026-10-09T00:00:00Z',
    procedure: {
      versionId: 'version-1',
      versionNumber: 1,
      processingMode: 'ONLINE',
      processingUnitName: 'Phòng CTSV',
      contactInstructions: 'Hướng dẫn',
      maxTotalAttachmentBytes: 20971520,
      fields: [
        {
          key: 'name',
          label: 'Họ tên',
          source: 'PROFILE',
          profileKey: 'fullName',
          type: 'TEXT',
          required: true,
          maxLength: 255,
          options: [],
        },
        {
          key: 'purpose',
          label: 'Mục đích',
          source: 'STUDENT_INPUT',
          profileKey: null,
          type: 'TEXTAREA',
          required: true,
          maxLength: 200,
          options: [],
        },
        {
          key: 'agreed',
          label: 'Đã xác nhận?',
          source: 'STUDENT_INPUT',
          profileKey: null,
          type: 'BOOLEAN',
          required: true,
          maxLength: 20,
          options: [],
        },
      ],
      attachments: [
        {
          key: 'proof',
          label: 'Minh chứng',
          required: true,
          mimeTypes: ['application/pdf'],
          maxFiles: 1,
          maxBytes: 5242880,
        },
      ],
    },
    values: { name: 'Nguyễn Minh An', purpose: null, agreed: null },
    files: [],
    issues: [],
  }
}
function mockApi() {
  return {
    submit: vi.fn(),
    save: vi.fn(),
    upload: vi.fn(),
    remove: vi.fn(),
    get: vi.fn(),
    roundDownloadUrl: vi.fn(
      (id, roundNumber, fileId) => '/history/' + id + '/' + roundNumber + '/' + fileId,
    ),
    downloadUrl: vi.fn(() => '/private-file'),
  }
}
let api = mockApi()
mockNuxtImport('useSubmissions', () => () => api)
beforeEach(() => {
  api = mockApi()
})
describe('student draft editor', () => {
  it('locks profile, identifies unsubmitted draft and saves partial input without profile keys', async () => {
    const initial = sample()
    api.save.mockResolvedValue({ ...initial, revision: 2 })
    const wrapper = await mountSuspended(StudentDraftEditor, { props: { initialDraft: initial } })
    expect(wrapper.get('#field-name').attributes('readonly')).toBeDefined()
    expect(wrapper.text()).toContain('Bản nháp · Chưa gửi')
    expect(wrapper.findAll('button').some((b) => b.text() === 'Nộp hồ sơ')).toBe(false)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(api.save).toHaveBeenCalledWith('draft-1', 1, { purpose: null, agreed: null })
    expect(wrapper.text()).toContain('Đã lưu bản nháp. Hồ sơ chưa được gửi.')
    wrapper.unmount()
  })
  it('keeps typed input on conflict and reloads current revision without discarding it', async () => {
    api.save.mockRejectedValue({ status: 409, message: 'Bản nháp đã thay đổi', issues: [] })
    api.get.mockResolvedValue({
      ...sample(),
      revision: 2,
      values: { ...sample().values, purpose: 'Ở phiên khác' },
    })
    const wrapper = await mountSuspended(StudentDraftEditor, { props: { initialDraft: sample() } })
    await wrapper.get('#field-purpose').setValue('Nội dung đang viết')
    expect(wrapper.get('#upload-proof').attributes('disabled')).toBeDefined()
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('#field-purpose').element).toHaveProperty('value', 'Nội dung đang viết')
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Tải bản lưu mới, giữ nội dung đang nhập')!
      .trigger('click')
    await flushPromises()
    expect(wrapper.get('#field-purpose').element).toHaveProperty('value', 'Nội dung đang viết')
    api.save.mockResolvedValue({
      ...sample(),
      revision: 3,
      values: { ...sample().values, purpose: 'Nội dung đang viết' },
    })
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(api.save).toHaveBeenLastCalledWith('draft-1', 2, {
      purpose: 'Nội dung đang viết',
      agreed: null,
    })
    wrapper.unmount()
  })
  it('shows inline validation with accessible connection and treats false as an answer', async () => {
    api.save.mockRejectedValue({
      status: 422,
      message: 'Kiểm tra trường',
      issues: [{ path: 'values.purpose', message: 'Nội dung quá dài' }],
    })
    const wrapper = await mountSuspended(StudentDraftEditor, { props: { initialDraft: sample() } })
    await wrapper.get('#field-agreed').setValue('false')
    expect(wrapper.get('aside').text()).not.toContain('Cần bổ sung đã xác nhận?')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('#field-purpose').attributes('aria-invalid')).toBe('true')
    expect(wrapper.get('#field-purpose').attributes('aria-describedby')).toBe('error-purpose')
    expect(wrapper.get('#error-purpose').text()).toBe('Nội dung quá dài')
    wrapper.unmount()
  })
  it('renders filenames/answers as plain text and labels every evidence signature as unverified', async () => {
    const draft = sample()
    draft.values.purpose = '<img src=x onerror=alert(1)>'
    draft.files = [
      {
        id: 'file-1',
        attachmentKey: 'proof',
        name: '<script>danger</script>.pdf',
        mimeType: 'application/pdf',
        size: 50,
        sha256: 'a'.repeat(64),
        signatureStatus: 'NOT_CHECKED',
      },
    ]
    const wrapper = await mountSuspended(StudentDraftEditor, { props: { initialDraft: draft } })
    expect(wrapper.get('aside').text()).toContain('<img src=x onerror=alert(1)>')
    expect(wrapper.find('aside img').exists()).toBe(false)
    expect(wrapper.find('script').exists()).toBe(false)
    expect(wrapper.text()).toContain('Chữ ký chưa được xác minh')
    expect(wrapper.get('.draft-file-list a').attributes('href')).toBe('/private-file')
    wrapper.unmount()
  })
  it('retired drafts disable saving/uploads and explain how to get the current form', async () => {
    const draft = { ...sample(), editable: false, readOnlyReason: 'Biểu mẫu đã cập nhật' }
    const wrapper = await mountSuspended(StudentDraftEditor, { props: { initialDraft: draft } })
    expect(wrapper.get('fieldset').attributes('disabled')).toBeDefined()
    expect(wrapper.get('#upload-proof').attributes('disabled')).toBeDefined()
    expect(
      wrapper
        .findAll('button')
        .find((b) => b.text() === 'Lưu bản nháp')!
        .attributes('disabled'),
    ).toBeDefined()
    expect(wrapper.text()).toContain('Biểu mẫu đã cập nhật')
    wrapper.unmount()
  })
  it('uploads one selected file and updates revision and signature notice', async () => {
    const draft = sample()
    api.upload.mockResolvedValue({
      ...draft,
      revision: 2,
      files: [
        {
          id: 'file-1',
          attachmentKey: 'proof',
          name: 'proof.pdf',
          mimeType: 'application/pdf',
          size: 50,
          sha256: 'a'.repeat(64),
          signatureStatus: 'NOT_CHECKED',
        },
      ],
    })
    const wrapper = await mountSuspended(StudentDraftEditor, { props: { initialDraft: draft } })
    const file = new File(['%PDF-1.4'], 'proof.pdf', { type: 'application/pdf' })
    const input = wrapper.get('#upload-proof')
    Object.defineProperty(input.element, 'files', { configurable: true, value: [file] })
    await input.trigger('change')
    await flushPromises()
    expect(api.upload).toHaveBeenCalledWith('draft-1', 1, 'proof', file)
    expect(wrapper.text()).toContain('Chữ ký chưa được xác minh')
    expect(wrapper.get('#upload-proof').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })
})

function complete(): StudentDraft {
  const draft = sample()
  draft.values = { ...draft.values, purpose: 'Xin xác nhận học tập', agreed: false }
  draft.files = [
    {
      id: 'file-1',
      attachmentKey: 'proof',
      name: 'proof.pdf',
      mimeType: 'application/pdf',
      size: 50,
      sha256: 'a'.repeat(64),
      signatureStatus: 'NOT_CHECKED',
    },
  ]
  return draft
}
function sent(status: 'SUBMITTED' | 'IN_REVIEW' = 'SUBMITTED'): StudentDraft {
  return {
    ...complete(),
    status,
    editable: false,
    revision: 2,
    submittedAt: '2026-10-09T01:00:00Z',
    reviewStartedAt: status === 'IN_REVIEW' ? '2026-10-09T02:00:00Z' : null,
  }
}
function button(wrapper: Awaited<ReturnType<typeof mountSuspended>>, label: string) {
  return wrapper.findAll('button').find((item) => item.text() === label)!
}
async function confirm(wrapper: Awaited<ReturnType<typeof mountSuspended>>) {
  await button(wrapper, 'Xem lại thông tin').trigger('click')
  await wrapper.get('#confirm-submission').setValue(true)
}
describe('student submission', () => {
  it('requires complete saved answers, review and explicit confirmation before sending', async () => {
    const wrapper = await mountSuspended(StudentDraftEditor, {
      props: { initialDraft: complete() },
    })
    expect(wrapper.get('#confirm-submission').attributes('disabled')).toBeDefined()
    expect(button(wrapper, 'Gửi hồ sơ').attributes('disabled')).toBeDefined()
    await button(wrapper, 'Gửi hồ sơ').trigger('click')
    expect(api.submit).not.toHaveBeenCalled()
    await button(wrapper, 'Xem lại thông tin').trigger('click')
    expect(button(wrapper, 'Gửi hồ sơ').attributes('disabled')).toBeDefined()
    await wrapper.get('#confirm-submission').setValue(true)
    expect(button(wrapper, 'Gửi hồ sơ').attributes('disabled')).toBeUndefined()
    await wrapper.get('#field-purpose').setValue('Nội dung mới chưa lưu')
    expect(wrapper.get('#confirm-submission').element).toHaveProperty('checked', false)
    expect(button(wrapper, 'Gửi hồ sơ').attributes('disabled')).toBeDefined()
    await button(wrapper, 'Xem lại thông tin').trigger('click')
    expect(wrapper.get('#confirm-submission').attributes('disabled')).toBeDefined()
    expect(api.submit).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it('blocks sending when a required answer or attachment is missing', async () => {
    const wrapper = await mountSuspended(StudentDraftEditor, { props: { initialDraft: sample() } })
    await button(wrapper, 'Xem lại thông tin').trigger('click')
    expect(wrapper.get('#confirm-submission').attributes('disabled')).toBeDefined()
    expect(wrapper.get('aside a[href="#attachment-proof"]').exists()).toBe(true)
    await button(wrapper, 'Gửi hồ sơ').trigger('click')
    expect(api.submit).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it('sends the saved revision once, then hides all edit controls and preserves private downloads', async () => {
    let resolve!: (value: StudentDraft) => void
    api.submit.mockReturnValue(
      new Promise<StudentDraft>((done) => {
        resolve = done
      }),
    )
    const wrapper = await mountSuspended(StudentDraftEditor, {
      props: { initialDraft: complete() },
    })
    await confirm(wrapper)
    await button(wrapper, 'Gửi hồ sơ').trigger('click')
    expect(api.submit).toHaveBeenCalledWith('draft-1', 1)
    expect(button(wrapper, 'Gửi hồ sơ').attributes('disabled')).toBeDefined()
    await button(wrapper, 'Gửi hồ sơ').trigger('click')
    expect(api.submit).toHaveBeenCalledOnce()
    resolve(sent())
    await flushPromises()
    expect(wrapper.text()).toContain('Đã gửi · Chờ tiếp nhận')
    expect(wrapper.get('time').attributes('datetime')).toBe('2026-10-09T01:00:00Z')
    expect(wrapper.find('textarea, select, input').exists()).toBe(false)
    expect(wrapper.findAll('button')).toHaveLength(0)
    expect(wrapper.get('.draft-file-list a').attributes('href')).toBe('/private-file')
    expect(wrapper.get('#field-purpose').text()).toBe('Xin xác nhận học tập')
    wrapper.unmount()
  })
  it('resets review and confirmation after saving or changing evidence', async () => {
    const draft = complete()
    draft.procedure.attachments[0]!.required = false
    draft.files = []
    api.save.mockResolvedValue({ ...draft, revision: 2 })
    const wrapper = await mountSuspended(StudentDraftEditor, { props: { initialDraft: draft } })
    await confirm(wrapper)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('#confirm-submission').element).toHaveProperty('checked', false)
    expect(wrapper.get('#confirm-submission').attributes('disabled')).toBeDefined()
    await confirm(wrapper)
    api.upload.mockResolvedValue({ ...draft, revision: 3, files: complete().files })
    const input = wrapper.get('#upload-proof')
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: [new File(['pdf'], 'proof.pdf', { type: 'application/pdf' })],
    })
    await input.trigger('change')
    await flushPromises()
    expect(wrapper.get('#confirm-submission').element).toHaveProperty('checked', false)
    expect(wrapper.get('#confirm-submission').attributes('disabled')).toBeDefined()
    await confirm(wrapper)
    api.remove.mockResolvedValue({ ...draft, revision: 4 })
    await button(wrapper, 'Gỡ').trigger('click')
    await flushPromises()
    expect(wrapper.get('#confirm-submission').element).toHaveProperty('checked', false)
    expect(wrapper.get('#confirm-submission').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })
  it('keeps saved answers and focuses linked attachment validation errors after a rejected submission', async () => {
    api.submit.mockRejectedValue({
      status: 422,
      message: 'Kiểm tra minh chứng',
      issues: [{ path: 'attachments.proof', message: 'Cần thêm minh chứng' }],
    })
    const wrapper = await mountSuspended(StudentDraftEditor, {
      props: { initialDraft: complete() },
      attachTo: document.body,
    })
    await confirm(wrapper)
    await button(wrapper, 'Gửi hồ sơ').trigger('click')
    await flushPromises()
    expect(wrapper.get('#field-purpose').element).toHaveProperty('value', 'Xin xác nhận học tập')
    expect(wrapper.get('.draft-error a').attributes('href')).toBe('#attachment-proof')
    expect(wrapper.get('#attachment-proof').exists()).toBe(true)
    expect(document.activeElement).toBe(wrapper.get('.draft-error').element)
    wrapper.unmount()
  })
  it.each([undefined, 503])(
    'requires a successful status check after uncertain submit outcome (%s)',
    async (status) => {
      api.submit.mockRejectedValue({ status, message: 'Mất kết nối', issues: [] })
      api.get
        .mockRejectedValueOnce({ status: 503, message: 'Chưa kết nối được', issues: [] })
        .mockResolvedValueOnce(complete())
      const wrapper = await mountSuspended(StudentDraftEditor, {
        props: { initialDraft: complete() },
      })
      await confirm(wrapper)
      await button(wrapper, 'Gửi hồ sơ').trigger('click')
      await flushPromises()
      expect(wrapper.text()).toContain('Chưa xác định được hồ sơ đã gửi hay chưa')
      expect(wrapper.get('fieldset').attributes('disabled')).toBeDefined()
      expect(button(wrapper, 'Lưu bản nháp').attributes('disabled')).toBeDefined()
      expect(button(wrapper, 'Gỡ').attributes('disabled')).toBeDefined()
      expect(wrapper.get('#upload-proof').attributes('disabled')).toBeDefined()
      await wrapper.get('form').trigger('submit')
      await button(wrapper, 'Gỡ').trigger('click')
      expect(api.save).not.toHaveBeenCalled()
      expect(api.remove).not.toHaveBeenCalled()
      expect(api.upload).not.toHaveBeenCalled()
      await button(wrapper, 'Kiểm tra trạng thái hồ sơ').trigger('click')
      await flushPromises()
      expect(button(wrapper, 'Gửi hồ sơ').attributes('disabled')).toBeDefined()
      expect(api.submit).toHaveBeenCalledOnce()
      await button(wrapper, 'Kiểm tra trạng thái hồ sơ').trigger('click')
      await flushPromises()
      expect(wrapper.get('fieldset').attributes('disabled')).toBeUndefined()
      expect(wrapper.get('#confirm-submission').attributes('disabled')).toBeDefined()
      await confirm(wrapper)
      expect(button(wrapper, 'Gửi hồ sơ').attributes('disabled')).toBeUndefined()
      wrapper.unmount()
    },
  )
  it('shows the authoritative submission after another tab sends, preserving differing unsaved input separately', async () => {
    api.save.mockRejectedValue({ status: 409, message: 'Hồ sơ đã thay đổi', issues: [] })
    api.get.mockResolvedValue(sent('IN_REVIEW'))
    const wrapper = await mountSuspended(StudentDraftEditor, {
      props: { initialDraft: complete() },
    })
    await wrapper.get('#field-purpose').setValue('Nội dung local chưa lưu')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    await button(wrapper, 'Tải bản lưu mới, giữ nội dung đang nhập').trigger('click')
    await flushPromises()
    expect(wrapper.get('#field-purpose').text()).toBe('Xin xác nhận học tập')
    expect(wrapper.get('aside').text()).not.toContain('Nội dung local chưa lưu')
    expect(wrapper.get('details').text()).toContain('Nội dung local chưa lưu')
    expect(wrapper.get('details').text()).toContain('chưa nằm trong hồ sơ đã gửi')
    expect(wrapper.text()).toContain('Đang xử lý')
    expect(wrapper.find('textarea, input, select').exists()).toBe(false)
    expect(wrapper.findAll('time')).toHaveLength(2)
    wrapper.unmount()
  })
  it('preserves saved content after submit conflict and requires review of the reloaded revision', async () => {
    api.submit.mockRejectedValue({ status: 409, message: 'Bản lưu đã thay đổi', issues: [] })
    api.get.mockResolvedValue({ ...complete(), revision: 3 })
    const wrapper = await mountSuspended(StudentDraftEditor, {
      props: { initialDraft: complete() },
    })
    await confirm(wrapper)
    await button(wrapper, 'Gửi hồ sơ').trigger('click')
    await flushPromises()
    expect(wrapper.get('#field-purpose').element).toHaveProperty('value', 'Xin xác nhận học tập')
    expect(wrapper.get('fieldset').attributes('disabled')).toBeDefined()
    await button(wrapper, 'Tải bản lưu mới, giữ nội dung đang nhập').trigger('click')
    await flushPromises()
    expect(wrapper.get('#confirm-submission').element).toHaveProperty('checked', false)
    expect(wrapper.get('#confirm-submission').attributes('disabled')).toBeDefined()
    await confirm(wrapper)
    api.submit.mockResolvedValue(sent())
    await button(wrapper, 'Gửi hồ sơ').trigger('click')
    await flushPromises()
    expect(api.submit).toHaveBeenLastCalledWith('draft-1', 3)
    expect(wrapper.text()).toContain('chưa phải là cấp văn bản hoặc xác minh chữ ký số')
    wrapper.unmount()
  })
})

function supplement(): StudentDraft {
  const view = complete()
  const round = {
    roundNumber: 1,
    submittedAt: '2026-10-10T01:00:00Z',
    studentSnapshot: {
      fullName: 'Nguyễn Minh An',
      studentCode: 'SV001',
      classCode: 'K20A',
      facultyCode: 'QLGD',
    },
    values: { ...view.values, purpose: 'Bản gửi trước' },
    files: [...view.files],
    source: 'LIVE' as const,
  }
  return {
    ...view,
    status: 'NEEDS_SUPPLEMENT',
    revision: 5,
    roundNumber: 1,
    submittedAt: round.submittedAt,
    lastSubmittedAt: round.submittedAt,
    reviewStartedAt: '2026-10-10T02:00:00Z',
    rounds: [round],
    events: [
      {
        id: 'event-1',
        roundNumber: 1,
        action: 'SUPPLEMENT_REQUESTED',
        actorName: 'Cán bộ A',
        note: '<b>Bổ sung nội dung và thay minh chứng</b>',
        createdAt: '2026-10-10T03:00:00Z',
      },
    ],
  }
}
describe('student supplement and history', () => {
  it('clearly shows the request, retains the previous round, saves then confirms a resubmission', async () => {
    const initial = supplement()
    const updated = {
      ...initial,
      revision: 6,
      values: { ...initial.values, purpose: 'Đã bổ sung nội dung' },
    }
    api.save.mockResolvedValue(updated)
    api.submit.mockResolvedValue({
      ...updated,
      status: 'IN_REVIEW',
      editable: false,
      revision: 7,
      roundNumber: 2,
      lastSubmittedAt: '2026-10-10T04:00:00Z',
    })
    const wrapper = await mountSuspended(StudentDraftEditor, { props: { initialDraft: initial } })
    expect(wrapper.text()).toContain('Hồ sơ cần bổ sung')
    expect(wrapper.text()).toContain('<b>Bổ sung nội dung và thay minh chứng</b>')
    expect(wrapper.find('.draft-reason b').exists()).toBe(false)
    expect(wrapper.get('fieldset').attributes('disabled')).toBeUndefined()
    expect(wrapper.get('.history-files a').attributes('href')).toBe('/history/draft-1/1/file-1')
    expect(wrapper.get('.history-round').text()).toContain('Bản gửi trước')
    await wrapper.get('#field-purpose').setValue('Đã bổ sung nội dung')
    expect(button(wrapper, 'Gửi bổ sung').attributes('disabled')).toBeDefined()
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('Nội dung mới chưa được gửi đến cán bộ')
    await confirm(wrapper)
    await button(wrapper, 'Gửi bổ sung').trigger('click')
    await flushPromises()
    expect(api.submit).toHaveBeenCalledWith('draft-1', 6)
    expect(wrapper.text()).toContain('Đã gửi bổ sung đến cán bộ đang xử lý.')
    expect(wrapper.text()).toContain('Đang xử lý')
    expect(wrapper.find('#field-purpose').element.tagName).toBe('P')
    wrapper.unmount()
  })
  it.each([409, 503, undefined])(
    'preserves supplement input and blocks mutation until successful status check (%s)',
    async (status) => {
      const initial = supplement()
      api.submit.mockRejectedValue({
        status,
        message: 'Chưa kiểm tra được gửi bổ sung',
        issues: [],
      })
      api.get.mockResolvedValue({
        ...initial,
        revision: 6,
        values: { ...initial.values, purpose: 'Bản lưu từ phiên khác' },
      })
      const wrapper = await mountSuspended(StudentDraftEditor, { props: { initialDraft: initial } })
      await confirm(wrapper)
      await button(wrapper, 'Gửi bổ sung').trigger('click')
      await flushPromises()
      expect(button(wrapper, 'Lưu bổ sung').attributes('disabled')).toBeDefined()
      expect(wrapper.get('#upload-proof').attributes('disabled')).toBeDefined()
      await button(
        wrapper,
        status === 409 ? 'Tải bản lưu mới, giữ nội dung đang nhập' : 'Kiểm tra trạng thái hồ sơ',
      ).trigger('click')
      await flushPromises()
      expect(wrapper.get('#field-purpose').element).toHaveProperty('value', initial.values.purpose)
      expect(button(wrapper, 'Gửi bổ sung').attributes('disabled')).toBeDefined()
      expect(api.submit).toHaveBeenCalledOnce()
      wrapper.unmount()
    },
  )
  it.each(['APPROVED', 'REJECTED'] as const)(
    'renders terminal %s as read-only with a plain-text decision and history',
    async (status) => {
      const initial = supplement()
      const wrapper = await mountSuspended(StudentDraftEditor, {
        props: {
          initialDraft: {
            ...initial,
            status,
            editable: false,
            decisionAt: '2026-10-10T04:00:00Z',
            events: [
              ...initial.events,
              {
                id: 'decision',
                roundNumber: 1,
                action: status,
                actorName: 'Cán bộ A',
                note: '<script>reason</script>',
                createdAt: '2026-10-10T04:00:00Z',
              },
            ],
          },
        },
      })
      expect(wrapper.find('#upload-proof').exists()).toBe(false)
      expect(wrapper.find('#confirm-submission').exists()).toBe(false)
      expect(wrapper.text()).toContain(
        status === 'APPROVED' ? 'Đã duyệt nội dung' : 'Không chấp thuận',
      )
      expect(wrapper.text()).toContain('<script>reason</script>')
      expect(wrapper.find('script').exists()).toBe(false)
      expect(wrapper.text()).toContain('chưa phải là cấp văn bản')
      wrapper.unmount()
    },
  )
  it('does not apply a delayed save to a different student dossier', async () => {
    let finish!: (view: StudentDraft) => void
    api.save.mockReturnValue(
      new Promise<StudentDraft>((resolve) => {
        finish = resolve
      }),
    )
    const wrapper = await mountSuspended(StudentDraftEditor, {
      props: { initialDraft: supplement() },
    })
    await wrapper.get('form').trigger('submit')
    await wrapper.setProps({
      initialDraft: { ...sample(), id: 'draft-2', serviceName: 'Hồ sơ mới' },
    })
    finish({ ...supplement(), revision: 9 })
    await flushPromises()
    expect(wrapper.text()).toContain('Hồ sơ mới')
    expect(wrapper.text()).not.toContain('Đã lưu bổ sung')
    expect(wrapper.get('#field-purpose').element).toHaveProperty('value', '')
    wrapper.unmount()
  })
})
