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
    save: vi.fn(),
    upload: vi.fn(),
    remove: vi.fn(),
    get: vi.fn(),
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
    expect(wrapper.get('#attachment-proof').attributes('disabled')).toBeDefined()
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
    expect(wrapper.get('#attachment-proof').attributes('disabled')).toBeDefined()
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
    const input = wrapper.get('#attachment-proof')
    Object.defineProperty(input.element, 'files', { configurable: true, value: [file] })
    await input.trigger('change')
    await flushPromises()
    expect(api.upload).toHaveBeenCalledWith('draft-1', 1, 'proof', file)
    expect(wrapper.text()).toContain('Chữ ký chưa được xác minh')
    expect(wrapper.get('#attachment-proof').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })
})
