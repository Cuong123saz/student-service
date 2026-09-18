import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { FastifyInstance } from 'fastify'

import { buildApp } from '../../app.js'
import {
  ADMIN_JWT_AUDIENCE,
  ADMIN_SESSION_COOKIE_NAME,
  ADMIN_SESSION_TTL_SECONDS,
  JWT_ISSUER,
} from '../auth/auth.constants.js'
import type { AuthorizationUseCase, PermissionCheckInput } from '../auth/authorization.service.js'
import type { AuditLogUseCase } from './audit.service.js'
import type { AuditEventInput, ListAuditEventsInput, StoredAuditEvent } from './audit.types.js'

const actorUserId = '2f230120-c001-4e71-a17d-f18541e64d87'

const storedEvent: StoredAuditEvent = {
  id: '85ca4291-c7bd-4370-a117-976bf237261c',
  occurredAt: new Date('2026-09-05T00:00:00.000Z'),
  actorType: 'USER',
  actorUserId,
  actorUsername: 'system.admin',
  action: 'ADMIN_LOGIN',
  resourceType: 'ADMIN_SESSION',
  resourceId: null,
  outcome: 'SUCCESS',
  requestId: 'req-1',
  ipAddress: '127.0.0.1',
  userAgent: 'test-agent',
  metadata: {},
  before: null,
  after: null,
}

class FakeAuditLogService implements AuditLogUseCase {
  receivedListInput: ListAuditEventsInput | undefined

  async record(_event: AuditEventInput) {}

  async listRecent(input: ListAuditEventsInput) {
    this.receivedListInput = input
    return [storedEvent]
  }
}

class FakeAuthorizationService implements AuthorizationUseCase {
  constructor(private readonly allowedUserIds: ReadonlySet<string>) {}

  receivedChecks: PermissionCheckInput[] = []

  async hasPermission(input: PermissionCheckInput) {
    this.receivedChecks.push(input)

    return this.allowedUserIds.has(input.userId)
  }
}

async function createAdminCookie(app: FastifyInstance, roles: string[], userId = actorUserId) {
  await app.ready()
  const token = app.jwt.sign(
    {
      sub: userId,
      username: 'system.admin',
      roles,
      mustChangePassword: false,
      portal: 'admin',
      aud: ADMIN_JWT_AUDIENCE,
      iss: JWT_ISSUER,
    },
    {
      expiresIn: ADMIN_SESSION_TTL_SECONDS,
    },
  )

  return `${ADMIN_SESSION_COOKIE_NAME}=${token}`
}

test('GET audit logs yêu cầu audit.read và chuyển bộ lọc', async (context) => {
  const service = new FakeAuditLogService()
  const allowedUserId = '4dfbd34b-179d-4edc-a94c-94bf428a5a29'
  const authorizationService = new FakeAuthorizationService(new Set([allowedUserId]))
  const app = buildApp({
    auditLogService: service,
    authorizationService,
  })
  context.after(() => app.close())

  const unauthorized = await app.inject({
    method: 'GET',
    url: '/api/v1/admin/audit-logs',
  })

  assert.equal(unauthorized.statusCode, 401)

  const adminCookie = await createAdminCookie(app, ['ADMIN'])
  const forbidden = await app.inject({
    method: 'GET',
    url: '/api/v1/admin/audit-logs',
    headers: { cookie: adminCookie },
  })

  assert.equal(forbidden.statusCode, 403)

  const systemAdminCookie = await createAdminCookie(app, ['SYSTEM_ADMIN'], allowedUserId)
  const response = await app.inject({
    method: 'GET',
    url:
      '/api/v1/admin/audit-logs' +
      '?limit=25' +
      '&action=ADMIN_LOGIN' +
      '&before=2026-09-06T00%3A00%3A00.000Z',
    headers: {
      cookie: systemAdminCookie,
    },
  })

  assert.equal(response.statusCode, 200)
  assert.deepEqual(authorizationService.receivedChecks, [
    {
      userId: actorUserId,
      permission: 'audit.read',
    },
    {
      userId: allowedUserId,
      permission: 'audit.read',
    },
  ])
  assert.deepEqual(service.receivedListInput, {
    limit: 25,
    action: 'ADMIN_LOGIN',
    before: new Date('2026-09-06T00:00:00.000Z'),
  })
  assert.deepEqual(response.json(), {
    auditLogs: [
      {
        ...storedEvent,
        occurredAt: storedEvent.occurredAt.toISOString(),
      },
    ],
  })
})
