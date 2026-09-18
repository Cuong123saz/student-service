import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { FastifyInstance } from 'fastify'

import { buildApp } from '../../app.js'
import {
  ADMIN_JWT_AUDIENCE,
  ADMIN_SESSION_COOKIE_NAME,
  ADMIN_SESSION_TTL_SECONDS,
  JWT_ISSUER,
} from './auth.constants.js'
import type { AuthorizationUseCase, PermissionCheckInput } from './authorization.service.js'
import type {
  ReplaceRolePermissionsInput,
  RolePermissionSnapshot,
  RolePermissionUseCase,
} from './role-permission.service.js'

const actorUserId = '2f230120-c001-4e71-a17d-f18541e64d87'
const snapshot: RolePermissionSnapshot = {
  roles: [
    {
      id: 2,
      code: 'ADMIN',
      name: 'Quản trị nghiệp vụ',
      description: null,
      permissionCodes: ['student.read'],
      canManage: true,
    },
  ],
  permissions: [
    {
      id: 1,
      code: 'student.read',
      name: 'Xem sinh viên',
      description: null,
    },
  ],
}

class FakeAuthorizationService implements AuthorizationUseCase {
  constructor(private readonly allowed: boolean) {}
  receivedChecks: PermissionCheckInput[] = []

  async hasPermission(input: PermissionCheckInput) {
    this.receivedChecks.push(input)
    return this.allowed
  }
}

class FakeRolePermissionService implements RolePermissionUseCase {
  receivedActorUserId: string | undefined
  receivedReplacement: Omit<ReplaceRolePermissionsInput, 'changedAt'> | undefined

  async getSnapshot(actorUserId: string) {
    this.receivedActorUserId = actorUserId
    return snapshot
  }

  async replacePermissions(input: Omit<ReplaceRolePermissionsInput, 'changedAt'>) {
    this.receivedReplacement = input
  }
}

async function createAdminCookie(app: FastifyInstance) {
  await app.ready()
  const token = app.jwt.sign(
    {
      sub: actorUserId,
      username: 'system.admin',
      roles: ['SYSTEM_ADMIN'],
      mustChangePassword: false,
      portal: 'admin',
      aud: ADMIN_JWT_AUDIENCE,
      iss: JWT_ISSUER,
    },
    { expiresIn: ADMIN_SESSION_TTL_SECONDS },
  )
  return `${ADMIN_SESSION_COOKIE_NAME}=${token}`
}

test('role-permission routes yêu cầu role.manage', async (context) => {
  const service = new FakeRolePermissionService()
  const authorizationService = new FakeAuthorizationService(false)
  const app = buildApp({
    rolePermissionService: service,
    authorizationService,
  })
  context.after(() => app.close())

  const unauthorized = await app.inject({
    method: 'GET',
    url: '/api/v1/admin/role-permissions',
  })
  assert.equal(unauthorized.statusCode, 401)

  const forbidden = await app.inject({
    method: 'GET',
    url: '/api/v1/admin/role-permissions',
    headers: { cookie: await createAdminCookie(app) },
  })
  assert.equal(forbidden.statusCode, 403)
  assert.deepEqual(authorizationService.receivedChecks, [
    {
      userId: actorUserId,
      permission: 'role.manage',
    },
  ])
})

test('GET role-permissions chuyển actor vào use case', async (context) => {
  const service = new FakeRolePermissionService()
  const app = buildApp({
    rolePermissionService: service,
    authorizationService: new FakeAuthorizationService(true),
  })
  context.after(() => app.close())

  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/admin/role-permissions',
    headers: { cookie: await createAdminCookie(app) },
  })
  assert.equal(response.statusCode, 200)
  assert.equal(service.receivedActorUserId, actorUserId)
  assert.deepEqual(response.json(), snapshot)
})

test('PUT role permissions chuyển actor và danh sách quyền', async (context) => {
  const service = new FakeRolePermissionService()
  const app = buildApp({
    rolePermissionService: service,
    authorizationService: new FakeAuthorizationService(true),
  })
  context.after(() => app.close())

  const response = await app.inject({
    method: 'PUT',
    url: '/api/v1/admin/roles/2/permissions',
    headers: {
      cookie: await createAdminCookie(app),
      'user-agent': 'role-permission-route-test',
    },
    payload: { permissionCodes: ['student.read', 'audit.read'] },
  })
  assert.equal(response.statusCode, 204)
  assert.equal(service.receivedReplacement?.roleId, 2)
  assert.deepEqual(service.receivedReplacement?.permissionCodes, ['student.read', 'audit.read'])
  assert.equal(service.receivedReplacement?.audit.userAgent, 'role-permission-route-test')
})
