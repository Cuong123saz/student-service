import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import ProcedurePage from '../../app/pages/admin/procedures/index.vue'
import ProcedurePreview from '../../app/components/ProcedurePreview.vue'
import type { ProcedureVersion } from '../../app/types/procedure'
const unitId = '5294e2b8-f01e-4ca3-8c17-b15e0924b111'
const versionId = '63efef08-f4f8-4bed-bdf4-1c9fe7c54111'
function draft(): ProcedureVersion {
  return {
    id: versionId,
    serviceId: 1,
    ownerUnitId: unitId,
    versionNumber: 1,
    revision: 1,
    status: 'DRAFT',
    publishedAt: null,
    config: {
      processingMode: 'OFFLINE',
      processingUnitId: unitId,
      processorUserId: null,
      contactInstructions: 'Sinh viên đến trực tiếp Phòng CTSV.',
      fields: [
        {
          key: 'fullName',
          label: 'Họ tên',
          type: 'TEXT',
          source: 'PROFILE',
          profileKey: 'fullName',
          required: true,
          maxLength: 255,
          options: [],
        },
      ],
      attachments: [],
      maxTotalAttachmentBytes: 20971520,
    },
  }
}
function createMock() {
  return {
    catalog: vi.fn().mockResolvedValue({
      services: [
        {
          id: 1,
          code: 'STUDENT_CONFIRMATION',
          name: 'Giấy xác nhận sinh viên',
          status: 'ACTIVE',
        },
      ],
      units: [{ id: unitId, code: 'CTSV', name: 'Phòng CTSV' }],
      reviewers: [],
      canCreate: true,
    }),
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    update: vi.fn(),
    validate: vi.fn().mockResolvedValue({ valid: true, issues: [] }),
    publish: vi.fn(),
  }
}
let api = createMock()
mockNuxtImport('useProcedures', () => () => api)
beforeEach(() => {
  api = createMock()
})
afterEach(() => {
  document.body.innerHTML = ''
})
describe('cấu hình biểu mẫu và nơi xử lý', () => {
  it('retry initializes the service and owner after an initial catalog failure', async () => {
    api.catalog.mockRejectedValueOnce({ status: 500, message: 'Mất kết nối', issues: [] })
    const wrapper = await mountSuspended(ProcedurePage)
    await flushPromises()
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Thử lại')!
      .trigger('click')
    await flushPromises()
    expect(wrapper.get('#procedure-service').element).toHaveProperty('value', '1')
    expect(wrapper.get('#procedure-owner').element).toHaveProperty('value', unitId)
    expect(api.list).toHaveBeenCalledWith(1)
    wrapper.unmount()
  })

  it('creates a draft for direct CTSV handling without asking for an advisor', async () => {
    api.create.mockImplementation(async () => {
      api.list.mockResolvedValue([draft()])
      return draft()
    })
    const wrapper = await mountSuspended(ProcedurePage)
    await flushPromises()
    expect(wrapper.get('#procedure-owner').element).toHaveProperty('value', unitId)
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Tạo cấu hình')!
      .trigger('click')
    await flushPromises()
    expect(api.create).toHaveBeenCalledWith(1, unitId, null)
    expect(wrapper.get('#processing-mode').element).toHaveProperty('value', 'OFFLINE')
    expect(wrapper.get('#processing-person').text()).toContain('Theo phân công nội bộ')
    expect(wrapper.text()).not.toContain('Cố vấn xét duyệt')
    wrapper.unmount()
  })
  it('requires saving edited instructions before publishing', async () => {
    api.list.mockResolvedValue([draft()])
    api.update.mockImplementation(async (_id, _revision, config) => {
      const updated = { ...draft(), revision: 2, config }
      api.list.mockResolvedValue([updated])
      return updated
    })
    const wrapper = await mountSuspended(ProcedurePage)
    await flushPromises()
    await wrapper.get('#contact-instructions').setValue('Liên hệ trực tiếp CTSV với mã sinh viên.')
    const apply = () => wrapper.findAll('button').find((b) => b.text() === 'Áp dụng cấu hình')!
    expect(apply().attributes('disabled')).toBeDefined()
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Lưu bản nháp')!
      .trigger('submit')
    await flushPromises()
    expect(api.update).toHaveBeenCalledWith(
      versionId,
      1,
      expect.objectContaining({ contactInstructions: 'Liên hệ trực tiếp CTSV với mã sinh viên.' }),
    )
    expect(apply().attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })
  it('keeps edited text after a revision conflict', async () => {
    api.list.mockResolvedValue([draft()])
    api.update.mockRejectedValue({ status: 409, message: 'Cấu hình đã thay đổi.', issues: [] })
    const wrapper = await mountSuspended(ProcedurePage)
    await flushPromises()
    await wrapper.get('#contact-instructions').setValue('Nội dung chưa lưu của tôi')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('#contact-instructions').element).toHaveProperty(
      'value',
      'Nội dung chưa lưu của tôi',
    )
    expect(wrapper.get('[role=alert]').text()).toContain('Cấu hình đã thay đổi')
    wrapper.unmount()
  })
  it('publishes only after server validation and locks the editor', async () => {
    api.list.mockResolvedValue([draft()])
    api.publish.mockImplementation(async () => {
      const published = { ...draft(), status: 'PUBLISHED', revision: 2 }
      api.list.mockResolvedValue([published])
      return published
    })
    const wrapper = await mountSuspended(ProcedurePage)
    await flushPromises()
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Áp dụng cấu hình')!
      .trigger('click')
    await flushPromises()
    expect(api.validate).toHaveBeenCalledWith(versionId)
    expect(api.publish).toHaveBeenCalledWith(versionId, 1)
    expect(wrapper.get('fieldset').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('Tạo phiên bản mới')
    wrapper.unmount()
  })
  it('shows routing validation errors and does not publish', async () => {
    api.list.mockResolvedValue([draft()])
    api.validate.mockResolvedValue({
      valid: false,
      issues: [{ path: 'processorUserId', message: 'Chưa có cán bộ phù hợp.' }],
    })
    const wrapper = await mountSuspended(ProcedurePage)
    await flushPromises()
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Áp dụng cấu hình')!
      .trigger('click')
    await flushPromises()
    expect(api.publish).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Chưa có cán bộ phù hợp')
    wrapper.unmount()
  })
  it('preview escapes field labels and displays OFFLINE contact guidance', async () => {
    const config = draft().config
    config.fields[0]!.label = '<script>unsafe()</script>'
    const wrapper = await mountSuspended(ProcedurePreview, {
      props: { config, unitName: 'Phòng CTSV' },
    })
    expect(wrapper.find('script').exists()).toBe(false)
    expect(wrapper.text()).toContain('<script>unsafe()</script>')
    expect(wrapper.text()).toContain('Sinh viên làm việc trực tiếp')
    wrapper.unmount()
  })
})
