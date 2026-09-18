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
import type {
  CreateAcademicClassInput,
  CreateFacultyInput,
  CreateOrganizationalUnitInput,
  OrganizationManagementSnapshot,
  OrganizationManagementUseCase,
  SetAcademicAdvisorInput,
  UpdateAcademicClassInput,
  UpdateFacultyInput,
  UpdateOrganizationalUnitInput,
} from './organization-management.service.js'

const actorUserId = '2f230120-c001-4e71-a17d-f18541e64d87'
const facultyId = '46f9323a-1c5c-4c8a-b596-cac83f5eaf96'
const classId = 'bb3ba725-c20f-43b2-832d-28caab69ad80'
const organizationalUnitId = 'd415be3f-88e7-49dc-a40e-929ed2461718'

const snapshot: OrganizationManagementSnapshot = {
  faculties: [
    {
      id: facultyId,
      code: 'QLGD',
      name: 'Khoa Quản lý giáo dục',
      status: 'ACTIVE',
      canManage: true,
      canCreateClass: true,
      classes: [
        {
          id: classId,
          code: 'QLGD-K17A',
          name: 'Quản lý giáo dục K17A',
          status: 'ACTIVE',
          canManage: true,
          currentAdvisor: null,
        },
      ],
    },
  ],
  organizationalUnits: [
    {
      id: organizationalUnitId,
      code: 'PCTSV',
      name: 'Phòng Công tác sinh viên',
      status: 'ACTIVE',
      canManage: true,
    },
  ],
  advisors: [],
  capabilities: {
    canCreateFaculty: true,
    canCreateOrganizationalUnit: true,
  },
}

class FakeAuthorizationService implements AuthorizationUseCase {
  constructor(private readonly allowed: boolean) {}
  receivedChecks: PermissionCheckInput[] = []

  async hasPermission(input: PermissionCheckInput) {
    this.receivedChecks.push(input)
    return this.allowed
  }
}

class FakeOrganizationManagementService implements OrganizationManagementUseCase {
  receivedActorUserId: string | undefined
  receivedFaculty: Omit<CreateFacultyInput, 'changedAt'> | undefined
  receivedOrganizationalUnit: Omit<CreateOrganizationalUnitInput, 'changedAt'> | undefined
  receivedAdvisor: Omit<SetAcademicAdvisorInput, 'changedAt'> | undefined

  async getSnapshot(actorId: string) {
    this.receivedActorUserId = actorId
    return snapshot
  }

  async createFaculty(input: Omit<CreateFacultyInput, 'changedAt'>) {
    this.receivedFaculty = input
    return { id: facultyId }
  }

  async updateFaculty(_input: Omit<UpdateFacultyInput, 'changedAt'>) {}

  async createOrganizationalUnit(input: Omit<CreateOrganizationalUnitInput, 'changedAt'>) {
    this.receivedOrganizationalUnit = input
    return { id: organizationalUnitId }
  }

  async updateOrganizationalUnit(_input: Omit<UpdateOrganizationalUnitInput, 'changedAt'>) {}

  async createAcademicClass(_input: Omit<CreateAcademicClassInput, 'changedAt'>) {
    return { id: classId }
  }

  async updateAcademicClass(_input: Omit<UpdateAcademicClassInput, 'changedAt'>) {}

  async setAcademicAdvisor(input: Omit<SetAcademicAdvisorInput, 'changedAt'>) {
    this.receivedAdvisor = input
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

test('organization management yêu cầu organization.manage', async (context) => {
  const service = new FakeOrganizationManagementService()
  const authorizationService = new FakeAuthorizationService(false)
  const app = buildApp({
    organizationManagementService: service,
    authorizationService,
  })
  context.after(() => app.close())

  const unauthorized = await app.inject({
    method: 'GET',
    url: '/api/v1/admin/organization-management',
  })
  assert.equal(unauthorized.statusCode, 401)

  const forbidden = await app.inject({
    method: 'GET',
    url: '/api/v1/admin/organization-management',
    headers: { cookie: await createAdminCookie(app) },
  })
  assert.equal(forbidden.statusCode, 403)
  assert.deepEqual(authorizationService.receivedChecks, [
    {
      userId: actorUserId,
      permission: 'organization.manage',
    },
  ])
})

test('GET organization management chuyển actor vào use case', async (context) => {
  const service = new FakeOrganizationManagementService()
  const app = buildApp({
    organizationManagementService: service,
    authorizationService: new FakeAuthorizationService(true),
  })
  context.after(() => app.close())

  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/admin/organization-management',
    headers: { cookie: await createAdminCookie(app) },
  })

  assert.equal(response.statusCode, 200)
  assert.equal(service.receivedActorUserId, actorUserId)
  assert.deepEqual(response.json(), snapshot)
})

test('POST faculty chuyển actor và audit context vào use case', async (context) => {
  const service = new FakeOrganizationManagementService()
  const app = buildApp({
    organizationManagementService: service,
    authorizationService: new FakeAuthorizationService(true),
  })
  context.after(() => app.close())

  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/faculties',
    headers: {
      cookie: await createAdminCookie(app),
      'user-agent': 'organization-route-test',
    },
    payload: { code: 'QLGD', name: 'Khoa Quản lý giáo dục' },
  })

  assert.equal(response.statusCode, 201)
  assert.equal(service.receivedFaculty?.actor.userId, actorUserId)
  assert.equal(service.receivedFaculty?.actor.username, 'system.admin')
  assert.equal(service.receivedFaculty?.audit.userAgent, 'organization-route-test')
})

test('PUT advisor parse thời điểm hiệu lực trước khi gọi use case', async (context) => {
  const service = new FakeOrganizationManagementService()
  const app = buildApp({
    organizationManagementService: service,
    authorizationService: new FakeAuthorizationService(true),
  })
  context.after(() => app.close())
  const effectiveAt = '2026-09-06T03:00:00.000Z'

  const response = await app.inject({
    method: 'PUT',
    url: `/api/v1/admin/academic-classes/${classId}/advisor`,
    headers: { cookie: await createAdminCookie(app) },
    payload: { advisorUserId: null, effectiveAt },
  })

  assert.equal(response.statusCode, 204)
  assert.equal(service.receivedAdvisor?.classId, classId)
  assert.equal(service.receivedAdvisor?.advisorUserId, null)
  assert.equal(service.receivedAdvisor?.effectiveAt.toISOString(), effectiveAt)
})

test('POST organizational unit chuyển actor và dữ liệu vào use case', async (context) => {
  const service = new FakeOrganizationManagementService()
  const app = buildApp({
    organizationManagementService: service,
    authorizationService: new FakeAuthorizationService(true),
  })
  context.after(() => app.close())

  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/organizational-units',
    headers: { cookie: await createAdminCookie(app) },
    payload: {
      code: 'pdt',
      name: 'Phòng Đào tạo',
    },
  })

  assert.equal(response.statusCode, 201)
  assert.deepEqual(response.json(), { id: organizationalUnitId })
  assert.equal(service.receivedOrganizationalUnit?.actor.userId, actorUserId)
  assert.equal(service.receivedOrganizationalUnit?.code, 'pdt')
})
