import assert from 'node:assert/strict'
import { test } from 'node:test'

import type {
  AuditLogRepository,
} from './audit.repository.js'
import {
  AuditLogService,
} from './audit.service.js'
import type {
  AuditEventInput,
  ListAuditEventsInput,
  StoredAuditEvent,
} from './audit.types.js'

const occurredAt =
  new Date('2026-09-05T00:00:00.000Z')

const event: AuditEventInput = {
  actorType: 'USER',
  actorUserId:
    '2f230120-c001-4e71-a17d-f18541e64d87',
  actorUsername: 'system.admin',
  action: 'USER_INVITATION_CREATE',
  resourceType: 'USER',
  resourceId:
    '85ca4291-c7bd-4370-a117-976bf237261c',
  outcome: 'SUCCESS',
  requestId: 'req-1',
  ipAddress: '127.0.0.1',
  userAgent: 'test-agent',
  metadata: {
    targetUsername: 'student001',
    targetRoles: ['STUDENT'],
  },
}

class FakeAuditLogRepository
implements AuditLogRepository {
  appended:
    (AuditEventInput & {
      occurredAt: Date
    }) | undefined

  receivedListInput:
    ListAuditEventsInput | undefined

  async append(
    storedEvent: AuditEventInput & {
      occurredAt: Date
    },
  ) {
    this.appended = storedEvent
  }

  async listRecent(
    input: ListAuditEventsInput,
  ): Promise<StoredAuditEvent[]> {
    this.receivedListInput = input
    return []
  }
}

test(
  'record gắn thời điểm tin cậy trước khi lưu audit event',
  async () => {
    const repository =
      new FakeAuditLogRepository()
    const service = new AuditLogService(
      repository,
      () => occurredAt,
    )

    await service.record(event)

    assert.deepEqual(
      repository.appended,
      {
        ...event,
        occurredAt,
      },
    )
  },
)

test(
  'listRecent chuyển nguyên bộ lọc xuống repository',
  async () => {
    const repository =
      new FakeAuditLogRepository()
    const service = new AuditLogService(
      repository,
    )
    const input = {
      limit: 25,
      before: occurredAt,
      action: 'ADMIN_LOGIN',
    }

    assert.deepEqual(
      await service.listRecent(input),
      [],
    )
    assert.deepEqual(
      repository.receivedListInput,
      input,
    )
  },
)
