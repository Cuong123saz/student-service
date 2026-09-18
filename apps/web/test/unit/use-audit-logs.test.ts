import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AuditLogItem, AuditLogListResponse } from '../../app/types/audit-log'
import { type AuditLogFetcher, useAuditLogs } from '../../app/composables/useAuditLogs'

const fetchMock = vi.fn()

const fetcher: AuditLogFetcher = async <Response>(url, options) =>
  (await fetchMock(url, options)) as Response

function auditLog(id: string, occurredAt: string): AuditLogItem {
  return {
    id,
    occurredAt,
    actorType: 'USER',
    actorUserId: 'user-1',
    actorUsername: 'admin',
    action: 'STUDENT_IMPORT_COMMIT',
    resourceType: 'STUDENT_IMPORT',
    resourceId: id,
    outcome: 'SUCCESS',
    requestId: `request-${id}`,
    ipAddress: '127.0.0.1',
    userAgent: 'vitest',
    metadata: {},
    before: null,
    after: { imported: 1 },
  }
}

function response(auditLogs: AuditLogItem[]): AuditLogListResponse {
  return { auditLogs }
}

function createAuditLogs() {
  return useAuditLogs({
    apiBase: 'http://api.test',
    fetcher,
    pageSize: 2,
  })
}

beforeEach(() => {
  fetchMock.mockReset()
})

describe('useAuditLogs', () => {
  it('gửi action filter và tải trang đầu không có cursor', async () => {
    const first = auditLog('1', '2026-09-09T03:00:00.000Z')
    fetchMock.mockResolvedValueOnce(response([first]))
    const auditLogs = createAuditLogs()

    await expect(auditLogs.load('STUDENT_IMPORT_COMMIT')).resolves.toBe(true)

    expect(fetchMock).toHaveBeenCalledWith('http://api.test/api/v1/admin/audit-logs', {
      credentials: 'include',
      query: {
        limit: 2,
        action: 'STUDENT_IMPORT_COMMIT',
      },
    })
    expect(auditLogs.auditLogs.value).toEqual([first])
    expect(auditLogs.pageNumber.value).toBe(1)
  })

  it('phân trang bằng occurredAt cuối trang và quay lại đúng cursor', async () => {
    const firstPage = [
      auditLog('1', '2026-09-09T03:00:00.000Z'),
      auditLog('2', '2026-09-09T02:00:00.000Z'),
    ]
    const secondPage = [auditLog('3', '2026-09-09T01:00:00.000Z')]
    fetchMock
      .mockResolvedValueOnce(response(firstPage))
      .mockResolvedValueOnce(response(secondPage))
      .mockResolvedValueOnce(response(firstPage))
    const auditLogs = createAuditLogs()

    await auditLogs.load()
    expect(auditLogs.nextCursorBefore.value).toBe('2026-09-09T02:00:00.000Z')

    await expect(auditLogs.nextPage()).resolves.toBe(true)
    expect(fetchMock.mock.calls[1]?.[1]).toEqual({
      credentials: 'include',
      query: {
        limit: 2,
        before: '2026-09-09T02:00:00.000Z',
      },
    })
    expect(auditLogs.pageNumber.value).toBe(2)

    await expect(auditLogs.previousPage()).resolves.toBe(true)
    expect(fetchMock.mock.calls[2]?.[1]).toEqual({
      credentials: 'include',
      query: { limit: 2 },
    })
    expect(auditLogs.pageNumber.value).toBe(1)
  })

  it('hiển thị thông báo rõ ràng khi thiếu quyền audit.read', async () => {
    fetchMock.mockRejectedValueOnce({ statusCode: 403 })
    const auditLogs = createAuditLogs()

    await expect(auditLogs.load()).resolves.toBe(false)

    expect(auditLogs.errorMessage.value).toContain('chưa được cấp quyền')
    expect(auditLogs.auditLogs.value).toEqual([])
  })
})
