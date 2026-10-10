import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SubmissionReassignment from '../../app/components/SubmissionReassignment.vue'
import type { ReviewSubmissionDetail } from '../../app/types/submission'
const { api } = vi.hoisted(() => ({ api: { assignees: vi.fn(), reassign: vi.fn() } }))
mockNuxtImport('useReviewSubmissions', () => () => api)
function sample(): ReviewSubmissionDetail {
  return {
    id: 'one',
    serviceId: 1,
    serviceName: 'Thử nghiệm',
    status: 'IN_REVIEW',
    revision: 4,
    roundNumber: 1,
    lastSubmittedAt: '2026-10-10T00:00:00Z',
    decisionAt: null,
    submittedAt: '2026-10-10T00:00:00Z',
    reviewStartedAt: '2026-10-10T01:00:00Z',
    processingUnitName: 'Phòng CTSV',
    student: { fullName: 'Sinh viên', studentCode: 'SV01' },
    reviewerName: 'Người cũ',
    canClaim: false,
    canReassign: true,
    allowedActions: [],
    rounds: [],
    events: [],
    values: {},
    files: [],
    studentSnapshot: {
      fullName: 'Sinh viên',
      studentCode: 'SV01',
      classCode: 'A',
      facultyCode: 'B',
    },
    procedure: {
      versionId: 'v',
      versionNumber: 1,
      processingMode: 'ONLINE',
      processingUnitName: 'CTSV',
      contactInstructions: 'Hướng dẫn',
      fields: [],
      attachments: [],
      maxTotalAttachmentBytes: 100,
    },
  }
}
beforeEach(() => {
  api.assignees
    .mockReset()
    .mockResolvedValue({ candidates: [{ id: 'next', fullName: 'Người mới' }] })
  api.reassign.mockReset()
})
async function form() {
  const wrapper = await mountSuspended(SubmissionReassignment, {
    props: { portal: 'admin', detail: sample(), blocked: false },
  })
  await flushPromises()
  await wrapper.get('#handover-recipient').setValue('next')
  await wrapper.get('#handover-note').setValue('  Bàn giao vì thay cán bộ  ')
  return wrapper
}
function button(wrapper: Awaited<ReturnType<typeof form>>, name: string) {
  return wrapper.findAll('button').find((b) => b.text() === name)!
}
describe('handover confirmation', () => {
  it('hides transfer without server permission and does not list assignees', async () => {
    const wrapper = await mountSuspended(SubmissionReassignment, {
      props: { portal: 'user', detail: { ...sample(), canReassign: false }, blocked: false },
    })
    expect(wrapper.find('#handover-recipient').exists()).toBe(false)
    expect(api.assignees).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it('requires review and confirmation, resets on edits and submits a trimmed note with revision', async () => {
    const wrapper = await form()
    expect(button(wrapper, 'Bàn giao hồ sơ')).toBeUndefined()
    await button(wrapper, 'Xem lại bàn giao').trigger('click')
    expect(button(wrapper, 'Bàn giao hồ sơ').attributes('disabled')).toBeDefined()
    await wrapper.get('#handover-confirm').setValue(true)
    await wrapper.get('#handover-note').setValue('  Lý do cập nhật  ')
    expect(wrapper.find('#handover-confirm').exists()).toBe(false)
    await button(wrapper, 'Xem lại bàn giao').trigger('click')
    await wrapper.get('#handover-confirm').setValue(true)
    api.reassign.mockResolvedValue({ ...sample(), revision: 5, reviewerName: 'Người mới' })
    await button(wrapper, 'Bàn giao hồ sơ').trigger('click')
    await flushPromises()
    expect(api.reassign).toHaveBeenCalledWith('one', 4, 'next', 'Lý do cập nhật')
    expect(wrapper.emitted('updated')?.[0]?.[0].reviewerName).toBe('Người mới')
    wrapper.unmount()
  })
  it('preserves recipient and note after failure for the parent to reload', async () => {
    const wrapper = await form()
    await button(wrapper, 'Xem lại bàn giao').trigger('click')
    await wrapper.get('#handover-confirm').setValue(true)
    api.reassign.mockRejectedValue({ status: 409, message: 'Đã thay đổi' })
    await button(wrapper, 'Bàn giao hồ sơ').trigger('click')
    await flushPromises()
    expect(wrapper.get('#handover-recipient').element.value).toBe('next')
    expect(wrapper.get('#handover-note').element.value).toContain('Bàn giao vì thay cán bộ')
    expect(wrapper.emitted('failed')?.[0]?.[0].status).toBe(409)
    await wrapper.setProps({ blocked: true })
    expect(wrapper.get('fieldset').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })
  it('ignores a delayed transfer reply after navigating to another dossier', async () => {
    const wrapper = await form()
    let done!: (value: ReviewSubmissionDetail) => void
    api.reassign.mockReturnValue(
      new Promise<ReviewSubmissionDetail>((resolve) => {
        done = resolve
      }),
    )
    await button(wrapper, 'Xem lại bàn giao').trigger('click')
    await wrapper.get('#handover-confirm').setValue(true)
    await button(wrapper, 'Bàn giao hồ sơ').trigger('click')
    await wrapper.setProps({ detail: { ...sample(), id: 'two' } })
    done({ ...sample(), revision: 5 })
    await flushPromises()
    expect(wrapper.emitted('updated')).toBeUndefined()
    wrapper.unmount()
  })
})
