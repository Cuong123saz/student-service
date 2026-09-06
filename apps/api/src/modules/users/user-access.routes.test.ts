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
import type {
  AuthorizationUseCase,
  PermissionCheckInput,
} from '../auth/authorization.service.js'
import type {
  ListUserAccessInput,
  ReplaceUserAccessInput,
  UserAccessSnapshot,
  UserAccessUseCase,
} from './user-access.service.js'

const actorUserId = '2f230120-c001-4e71-a17d-f18541e64d87'
const targetUserId = '85ca4291-c7bd-4370-a117-976bf237261c'
const scopeId = '46f9323a-1c5c-4c8a-b596-cac83f5eaf96'

const snapshot: UserAccessSnapshot = {
  users: [{
    id: targetUserId,
    username: 'advisor.one',
    fullName: 'Cố vấn Một',
    email: 'advisor.one@example.edu.vn',
    status: 'ACTIVE',
    studentCode: null,
    assignments: [{
      roleCode: 'ACADEMIC_ADVISOR',
      roleName: 'Giảng viên cố vấn',
      scopeIds: [scopeId],
    }],
    canManage: true,
  }],
  roles: [],
  scopes: [],
}

class FakeAuthorizationService implements AuthorizationUseCase {
  constructor(private readonly allowed: boolean) {}
  receivedChecks: PermissionCheckInput[] = []

  async hasPermission(input: PermissionCheckInput) {
    this.receivedChecks.push(input)
    return this.allowed
  }
}

class FakeUserAccessService implements UserAccessUseCase {
  listInput: ListUserAccessInput | undefined
  replaceInput: Omit<ReplaceUserAccessInput, 'changedAt'> | undefined

  async getSnapshot(input: ListUserAccessInput) {
    this.listInput = input
    return snapshot
  }

  async replaceAssignments(
    input: Omit<ReplaceUserAccessInput, 'changedAt'>,
  ) {
    this.replaceInput = input
  }
}

async function createAdminCookie(app: FastifyInstance) {
  await app.ready()
  const token = app.jwt.sign({
    sub: actorUserId,
    username: 'system.admin',
    roles: ['SYSTEM_ADMIN'],
    mustChangePassword: false,
    portal: 'admin',
    aud: ADMIN_JWT_AUDIENCE,
    iss: JWT_ISSUER,
  }, { expiresIn: ADMIN_SESSION_TTL_SECONDS })
  return `${ADMIN_SESSION_COOKIE_NAME}=${token}`
}

test('access control yêu cầu session và role.manage', async context => {
  const authorizationService = new FakeAuthorizationService(false)
  const app = buildApp({
    userAccessService: new FakeUserAccessService(),
    authorizationService,
  })
  context.after(() => app.close())

  const unauthorized = await app.inject({
    method: 'GET',
    url: '/api/v1/admin/access-control',
  })
  assert.equal(unauthorized.statusCode, 401)

  const forbidden = await app.inject({
    method: 'GET',
    url: '/api/v1/admin/access-control',
    headers: { cookie: await createAdminCookie(app) },
  })
  assert.equal(forbidden.statusCode, 403)
  assert.deepEqual(authorizationService.receivedChecks, [{
    userId: actorUserId,
    permission: 'role.manage',
  }])
})

test('GET access control chuyển actor và search vào use case', async context => {
  const service = new FakeUserAccessService()
  const app = buildApp({
    userAccessService: service,
    authorizationService: new FakeAuthorizationService(true),
  })
  context.after(() => app.close())

  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/admin/access-control?search=advisor',
    headers: { cookie: await createAdminCookie(app) },
  })

  assert.equal(response.statusCode, 200)
  assert.deepEqual(service.listInput, {
    actorUserId,
    search: 'advisor',
  })
  assert.deepEqual(response.json(), snapshot)
})

test('PUT assignments chuyển actor, scope và audit context', async context => {
  const service = new FakeUserAccessService()
  const app = buildApp({
    userAccessService: service,
    authorizationService: new FakeAuthorizationService(true),
  })
  context.after(() => app.close())

  const response = await app.inject({
    method: 'PUT',
    url: `/api/v1/admin/access-control/users/${targetUserId}/assignments`,
    headers: {
      cookie: await createAdminCookie(app),
      'user-agent': 'access-route-test',
    },
    payload: {
      assignments: [{
        roleCode: 'ACADEMIC_ADVISOR',
        scopeIds: [scopeId],
      }],
    },
  })

  assert.equal(response.statusCode, 204)
  assert.equal(service.replaceInput?.actor.userId, actorUserId)
  assert.equal(service.replaceInput?.actor.username, 'system.admin')
  assert.equal(service.replaceInput?.targetUserId, targetUserId)
  assert.equal(service.replaceInput?.audit.userAgent, 'access-route-test')
  assert.deepEqual(service.replaceInput?.assignments, [{
    roleCode: 'ACADEMIC_ADVISOR',
    scopeIds: [scopeId],
  }])
})
