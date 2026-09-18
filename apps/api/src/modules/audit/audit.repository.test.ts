import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import { eq, sql } from 'drizzle-orm'

import { databaseClient, db } from '../../db/client.js'
import { DrizzleAuditLogRepository } from './audit.repository.js'
import { auditLogs } from './audit.schema.js'

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl || new URL(databaseUrl).pathname !== '/student_service_test') {
  throw new Error('Integration tests must use the student_service_test database')
}

beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE ${auditLogs}`)
})

after(async () => {
  await databaseClient.end()
})

test('repository lưu, lọc và sắp audit log mới nhất trước', async () => {
  const repository = new DrizzleAuditLogRepository()
  const base = {
    actorType: 'USER' as const,
    actorUserId: '2f230120-c001-4e71-a17d-f18541e64d87',
    actorUsername: 'system.admin',
    resourceType: 'USER',
    resourceId: '85ca4291-c7bd-4370-a117-976bf237261c',
    outcome: 'SUCCESS' as const,
    requestId: 'req-1',
    ipAddress: '127.0.0.1',
    userAgent: 'integration-test',
    metadata: {},
  }

  await repository.append({
    ...base,
    action: 'ADMIN_LOGIN',
    occurredAt: new Date('2026-09-05T00:00:00.000Z'),
  })
  await repository.append({
    ...base,
    action: 'USER_INVITATION_CREATE',
    occurredAt: new Date('2026-09-05T00:01:00.000Z'),
  })

  const recent = await repository.listRecent({
    limit: 10,
  })
  const filtered = await repository.listRecent({
    limit: 10,
    action: 'ADMIN_LOGIN',
    before: new Date('2026-09-05T00:00:30.000Z'),
  })

  assert.deepEqual(
    recent.map((item) => item.action),
    ['USER_INVITATION_CREATE', 'ADMIN_LOGIN'],
  )
  assert.equal(filtered.length, 1)
  assert.equal(filtered[0]?.action, 'ADMIN_LOGIN')
})

test('database từ chối actor USER không có actorUserId', async () => {
  await assert.rejects(
    db.insert(auditLogs).values({
      actorType: 'USER',
      actorUserId: null,
      actorUsername: 'broken.actor',
      action: 'ADMIN_LOGIN',
      resourceType: 'ADMIN_SESSION',
      outcome: 'FAILURE',
      metadata: {},
    }),
    (error: unknown) => {
      let candidate = error

      while (
        typeof candidate === 'object' &&
        candidate !== null &&
        !('code' in candidate && typeof candidate.code === 'string')
      ) {
        candidate = 'cause' in candidate ? candidate.cause : null
      }

      assert.ok(typeof candidate === 'object' && candidate !== null && 'code' in candidate)
      assert.equal(candidate.code, '23514')
      return true
    },
  )
})

test('database chặn sửa lịch sử audit', async () => {
  const repository = new DrizzleAuditLogRepository()

  await repository.append({
    actorType: 'SYSTEM',
    actorUserId: null,
    actorUsername: null,
    action: 'AUDIT_TEST',
    resourceType: 'TEST',
    resourceId: null,
    outcome: 'SUCCESS',
    requestId: null,
    ipAddress: null,
    userAgent: null,
    metadata: {},
    occurredAt: new Date('2026-09-05T00:00:00.000Z'),
  })

  const [stored] = await db.select({ id: auditLogs.id }).from(auditLogs).limit(1)
  assert.ok(stored)

  await assert.rejects(
    db.update(auditLogs).set({ outcome: 'FAILURE' }).where(eq(auditLogs.id, stored.id)),
    (error: unknown) => {
      let candidate = error

      while (
        typeof candidate === 'object' &&
        candidate !== null &&
        !('code' in candidate && typeof candidate.code === 'string')
      ) {
        candidate = 'cause' in candidate ? candidate.cause : null
      }

      assert.ok(typeof candidate === 'object' && candidate !== null && 'code' in candidate)
      assert.equal(candidate.code, '55000')
      return true
    },
  )
})
