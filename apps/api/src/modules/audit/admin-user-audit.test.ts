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
import type { AuthorizationUseCase } from '../auth/authorization.service.js'
import type {
  CreateUserInvitationInput,
  UserInvitationUseCase,
} from '../users/user-invitation.service.js'
import type { AuditLogUseCase } from './audit.service.js'
import type { AuditEventInput, ListAuditEventsInput } from './audit.types.js'

const actorUserId = '2f230120-c001-4e71-a17d-f18541e64d87'
const invitedUserId = '85ca4291-c7bd-4370-a117-976bf237261c'

const authorizationService: AuthorizationUseCase = {
  async hasPermission() {
    return true
  },
}

class FakeInvitationService implements UserInvitationUseCase {
  async createInvitation(_input: CreateUserInvitationInput) {
    return {
      userId: invitedUserId,
      deliveryStatus: 'SENT' as const,
    }
  }

  async resendInvitation() {
    return {
      userId: invitedUserId,
      deliveryStatus: 'SENT' as const,
    }
  }
}

class CapturingAuditLogService implements AuditLogUseCase {
  events: AuditEventInput[] = []

  async record(event: AuditEventInput) {
    this.events.push(event)
  }

  async listRecent(_input: ListAuditEventsInput) {
    return []
  }
}

async function createAdminCookie(app: FastifyInstance) {
  await app.ready()
  const token = app.jwt.sign(
    {
      sub: actorUserId,
      username: 'admin001',
      roles: ['ADMIN'],
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

test('mời user thành công tạo audit event không chứa email hay token', async (context) => {
  const auditLogService = new CapturingAuditLogService()
  const app = buildApp({
    userInvitationService: new FakeInvitationService(),
    auditLogService,
    authorizationService,
  })
  context.after(() => app.close())

  const cookie = await createAdminCookie(app)
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/users/invitations',
    headers: {
      cookie,
      'user-agent': 'audit-test',
    },
    payload: {
      username: 'student001',
      email: 'student001@example.edu.vn',
      fullName: 'Nguyễn Văn A',
      roles: ['STUDENT'],
      studentCode: 'SV001',
      classId: 'bc6573e5-18df-4780-ab06-9e256ba7d83a',
    },
  })

  assert.equal(response.statusCode, 201)
  assert.equal(auditLogService.events.length, 1)

  const event = auditLogService.events[0]
  assert.ok(event)
  assert.equal(event.action, 'INVITATION_EMAIL_SENT')
  assert.equal(event.outcome, 'SUCCESS')
  assert.equal(event.resourceId, invitedUserId)
  assert.deepEqual(event.metadata, {
    deliveryStatus: 'SENT',
  })

  const serialized = JSON.stringify(event)
  assert.doesNotMatch(serialized, /student001@example\.edu\.vn/)
  assert.doesNotMatch(serialized, /token|password|cookie/i)
})
