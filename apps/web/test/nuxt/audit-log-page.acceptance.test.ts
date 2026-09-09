import {
  mountSuspended,
  mockNuxtImport,
} from '@nuxt/test-utils/runtime'
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { nextTick, ref } from 'vue'

import type { AuditLogItem } from '../../app/types/audit-log'
import AuditLogPage from '../../app/pages/admin/audit-logs/index.vue'

function createAuditMock() {
  return {
    auditLogs: ref<AuditLogItem[]>([]),
    isLoading: ref(false),
    hasLoaded: ref(false),
    errorMessage: ref(''),
    nextCursorBefore: ref<string | null>(null),
    pageNumber: ref(1),
    load: vi.fn(),
    nextPage: vi.fn(),
    previousPage: vi.fn(),
  }
}

let auditMock = createAuditMock()

mockNuxtImport('useAuditLogs', () => (
  () => auditMock
))

const importAuditLog: AuditLogItem = {
  id: 'audit-1',
  occurredAt: '2026-09-09T08:00:00.000Z',
  actorType: 'USER',
  actorUserId: 'admin-1',
  actorUsername: 'system.admin',
  action: 'STUDENT_IMPORT_COMMIT',
  resourceType: 'STUDENT_IMPORT',
  resourceId: 'preview-1',
  outcome: 'SUCCESS',
  requestId: 'req-import-1',
  ipAddress: '127.0.0.1',
  userAgent: 'acceptance-test',
  metadata: {
    imported: 1,
    strategy: 'FAIL',
  },
  before: null,
  after: {
    imported: 1,
  },
}

beforeEach(() => {
  auditMock = createAuditMock()
  auditMock.load.mockImplementation(async () => {
    auditMock.hasLoaded.value = true
    return true
  })
})

describe('trang audit log', () => {
  it('lọc import, xem metadata và chuyển trang', async () => {
    auditMock.load.mockImplementation(async (action?: string) => {
      auditMock.hasLoaded.value = true
      auditMock.auditLogs.value = action
        ? [importAuditLog]
        : []
      auditMock.nextCursorBefore.value = action
        ? '2026-09-09T08:00:00.000Z'
        : null
      return true
    })
    auditMock.nextPage.mockImplementation(async () => {
      auditMock.pageNumber.value = 2
      auditMock.nextCursorBefore.value = null
      return true
    })

    const wrapper = await mountSuspended(AuditLogPage)
    await nextTick()

    await wrapper.get('select')
      .setValue('STUDENT_IMPORT_COMMIT')
    await wrapper.get('form.filters').trigger('submit')
    await nextTick()

    expect(auditMock.load)
      .toHaveBeenLastCalledWith('STUDENT_IMPORT_COMMIT')
    expect(wrapper.text()).toContain('Nhập sinh viên')
    expect(wrapper.text()).toContain('system.admin')
    expect(wrapper.text()).toContain('req-import-1')
    expect(wrapper.text()).toContain('strategy')
    expect(wrapper.text()).toContain('FAIL')

    const nextButton = wrapper.findAll('button')
      .find(button => button.text() === 'Trang sau')
    expect(nextButton).toBeDefined()
    await nextButton!.trigger('click')
    await nextTick()

    expect(auditMock.nextPage).toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain('Trang 2')
  })

  it('hiển thị trạng thái thiếu quyền audit.read', async () => {
    auditMock.load.mockImplementation(async () => {
      auditMock.hasLoaded.value = true
      auditMock.errorMessage.value =
        'Tài khoản chưa được cấp quyền audit.read.'
      return false
    })

    const wrapper = await mountSuspended(AuditLogPage)
    await nextTick()

    expect(wrapper.text())
      .toContain('Tài khoản chưa được cấp quyền audit.read.')
    expect(wrapper.text()).toContain('Thử lại')
  })
})
