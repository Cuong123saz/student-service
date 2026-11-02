import type { VueWrapper } from '@vue/test-utils'
import { flushPromises } from '@vue/test-utils'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Suggestion from '../../app/components/ActivitySuggestionPanel.vue'
import Settings from '../../app/components/ActivitySettingsPanel.vue'
import Organizers from '../../app/components/ActivityOrganizersPanel.vue'
import type { ActivitySuggestion, SuggestionSettings } from '../../app/types/activity'

const suggestion: ActivitySuggestion = {
  window: { from: '2026-07-31T17:00:00.000Z', to: '2027-01-31T17:00:00.000Z' },
  notice: 'Gợi ý từ chứng nhận tham gia đang hiệu lực; cố vấn và khoa vẫn xét duyệt.',
  totals: { C: 5 },
  lines: [
    {
      group: 'C',
      rule: 'SCHOOL_ACTIVE',
      points: 5,
      explanation: 'Tích cực: 2/2 hoạt động bắt buộc và 2 hoạt động tự chọn (tối thiểu 2).',
      certificateCodes: ['CN-AAAAAAAAAAAA'],
    },
  ],
}
const settings: SuggestionSettings = {
  window: suggestion.window,
  school: { group: 'C', full: 3, active: 5, minVoluntary: 2, fullWithoutMandatory: true },
  club: { group: 'A', participant: 3, organizer: 2 },
  volunteer: { group: 'D', participant: 5 },
}
const criteria = ['A', 'B', 'C', 'D', 'E'].map((code) => ({
  code,
  label: code,
  maxPoints: 20,
  evidenceRequired: false,
}))
function mockApi() {
  return {
    forStudent: vi.fn().mockResolvedValue(suggestion),
    forReview: vi.fn().mockResolvedValue(suggestion),
    settings: vi.fn().mockResolvedValue({ settings, revision: 0, isDefault: true, criteria }),
    saveSettings: vi.fn(),
    organizers: vi.fn().mockResolvedValue({ canEdit: true, items: [] }),
    addOrganizer: vi.fn(),
    removeOrganizer: vi.fn(),
  }
}
let api = mockApi()
mockNuxtImport('useActivitySuggestions', () => () => api)
const button = (w: VueWrapper, name: string) => w.findAll('button').find((b) => b.text() === name)
beforeEach(() => {
  api = mockApi()
})
describe('activity suggestions (ADR 0033)', () => {
  it('students can fill an editable draft; reviewers only read', async () => {
    const w = await mountSuspended(Suggestion, {
      props: { declarationId: 'd1', mode: 'student', canApply: true },
    })
    await flushPromises()
    expect(w.text()).toContain('Nhóm C: +5')
    expect(w.text()).toContain('CN-AAAAAAAAAAAA')
    await button(w, 'Điền gợi ý')!.trigger('click')
    expect(w.emitted('apply')?.[0]).toEqual([suggestion])
    w.unmount()
    const r = await mountSuspended(Suggestion, { props: { declarationId: 'd1', mode: 'review' } })
    await flushPromises()
    expect(api.forReview).toHaveBeenCalledWith('d1')
    expect(button(r, 'Điền gợi ý')).toBeUndefined()
    r.unmount()
  })
  it('a submitted or locked declaration shows suggestions without the fill button', async () => {
    const w = await mountSuspended(Suggestion, {
      props: { declarationId: 'd1', mode: 'student', canApply: false },
    })
    await flushPromises()
    expect(button(w, 'Điền gợi ý')).toBeUndefined()
    w.unmount()
  })
  it('period managers save settings with the current revision', async () => {
    api.saveSettings.mockResolvedValue({
      settings: { ...settings, school: { ...settings.school, active: 4 } },
      revision: 1,
      isDefault: false,
      criteria,
    })
    const w = await mountSuspended(Settings, { props: { periodId: 'p1' } })
    await flushPromises()
    expect(w.text()).toContain('Đang dùng thiết lập mặc định.')
    await w.get('#as-active').setValue('4')
    await w.get('form').trigger('submit')
    await flushPromises()
    expect(api.saveSettings).toHaveBeenCalledWith(
      'p1',
      0,
      expect.objectContaining({
        school: expect.objectContaining({ active: 4 }),
        window: settings.window,
      }),
    )
    expect(w.text()).toContain('Đã chỉnh cho đợt này.')
    w.unmount()
  })
  it('organisers are added by student code and removed', async () => {
    const member = {
      id: 'o1',
      studentUserId: 'u1',
      studentCode: 'SV001',
      fullName: 'Sinh viên giả',
      addedBy: 'leader',
      addedAt: '2026-11-02T00:00:00.000Z',
    }
    api.addOrganizer.mockResolvedValue({ canEdit: true, items: [member] })
    api.removeOrganizer.mockResolvedValue({ canEdit: true, items: [] })
    const w = await mountSuspended(Organizers, { props: { activityId: 'a1' } })
    await flushPromises()
    await w.get('#organizer-code').setValue('SV001')
    await button(w, 'Thêm vào ban tổ chức')!.trigger('click')
    await flushPromises()
    expect(api.addOrganizer).toHaveBeenCalledWith('a1', 'SV001')
    expect(w.text()).toContain('Sinh viên giả')
    await button(w, 'Gỡ SV001')!.trigger('click')
    await flushPromises()
    expect(api.removeOrganizer).toHaveBeenCalledWith('a1', 'o1')
    expect(w.text()).toContain('Chưa có thành viên.')
    w.unmount()
  })
})
