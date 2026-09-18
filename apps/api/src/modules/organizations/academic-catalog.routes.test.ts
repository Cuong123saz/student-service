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
import type { AcademicCatalogFaculty, AcademicCatalogUseCase } from './academic-catalog.service.js'

const actorUserId = '2f230120-c001-4e71-a17d-f18541e64d87'

const catalog: AcademicCatalogFaculty[] = [
  {
    id: '46f9323a-1c5c-4c8a-b596-cac83f5eaf96',
    code: 'QLGD',
    name: 'Khoa Quản lý giáo dục',
    classes: [
      {
        id: 'bb3ba725-c20f-43b2-832d-28caab69ad80',
        code: 'K15A',
        name: 'Quản lý giáo dục K15A',
      },
    ],
  },
]

class FakeAcademicCatalogService implements AcademicCatalogUseCase {
  receivedActorUserId: string | undefined

  async listVisibleCatalog(actorUserId: string) {
    this.receivedActorUserId = actorUserId
    return catalog
  }
}

class FakeAuthorizationService implements AuthorizationUseCase {
  constructor(private readonly allowed: boolean) {}

  receivedChecks: PermissionCheckInput[] = []

  async hasPermission(input: PermissionCheckInput) {
    this.receivedChecks.push(input)
    return this.allowed
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
    {
      expiresIn: ADMIN_SESSION_TTL_SECONDS,
    },
  )

  return `${ADMIN_SESSION_COOKIE_NAME}=${token}`
}

test('GET academic catalog yêu cầu session và student.read', async (context) => {
  const catalogService = new FakeAcademicCatalogService()
  const authorizationService = new FakeAuthorizationService(false)
  const app = buildApp({
    academicCatalogService: catalogService,
    authorizationService,
  })
  context.after(() => app.close())

  const unauthorized = await app.inject({
    method: 'GET',
    url: '/api/v1/admin/academic-catalog',
  })
  assert.equal(unauthorized.statusCode, 401)

  const forbidden = await app.inject({
    method: 'GET',
    url: '/api/v1/admin/academic-catalog',
    headers: {
      cookie: await createAdminCookie(app),
    },
  })
  assert.equal(forbidden.statusCode, 403)
  assert.equal(catalogService.receivedActorUserId, undefined)
  assert.deepEqual(authorizationService.receivedChecks, [
    {
      userId: actorUserId,
      permission: 'student.read',
    },
  ])
})

test('GET academic catalog trả dữ liệu scope-limited từ use case', async (context) => {
  const catalogService = new FakeAcademicCatalogService()
  const authorizationService = new FakeAuthorizationService(true)
  const app = buildApp({
    academicCatalogService: catalogService,
    authorizationService,
  })
  context.after(() => app.close())

  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/admin/academic-catalog',
    headers: {
      cookie: await createAdminCookie(app),
    },
  })

  assert.equal(response.statusCode, 200)
  assert.equal(catalogService.receivedActorUserId, actorUserId)
  assert.deepEqual(response.json(), {
    faculties: catalog,
  })
})
