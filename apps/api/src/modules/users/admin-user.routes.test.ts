import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { FastifyInstance } from 'fastify'

import { buildApp as createApp, type BuildAppOptions } from '../../app.js'

import type { AuditLogUseCase } from '../audit/audit.service.js'
import type { AuditEventInput, ListAuditEventsInput } from '../audit/audit.types.js'

import {
  ADMIN_JWT_AUDIENCE,
  ADMIN_SESSION_COOKIE_NAME,
  ADMIN_SESSION_TTL_SECONDS,
  JWT_ISSUER,
} from '../auth/auth.constants.js'
import type { AuthorizationUseCase, PermissionCheckInput } from '../auth/authorization.service.js'

import { ForbiddenRoleAssignmentError } from './role-assignment-policy.js'

import {
  AcademicClassOutsideScopeError,
  AcademicClassNotFoundError,
  InvitationConflictError,
  InvitationNotResendableError,
  InvitationTargetForbiddenError,
  InvitationUserNotFoundError,
} from './user-invitation.repository.js'

import type {
  CreateUserInvitationInput,
  ResendUserInvitationInput,
  UserInvitationUseCase,
} from './user-invitation.service.js'

const endpoint = '/api/v1/admin/users/invitations'

const actorUserId = '2f230120-c001-4e71-a17d-f18541e64d87'

const invitedUserId = '85ca4291-c7bd-4370-a117-976bf237261c'

const classId = 'bc6573e5-18df-4780-ab06-9e256ba7d83a'

const validPayload = {
  username: 'student001',
  email: 'student001@example.edu.vn',
  fullName: 'Nguyễn Văn A',
  roles: ['STUDENT'],
  studentCode: 'SV001',
  classId,
}

class FakeUserInvitationService implements UserInvitationUseCase {
  receivedInput: CreateUserInvitationInput | undefined

  receivedResendInput: ResendUserInvitationInput | undefined

  constructor(
    private readonly failure?: Error,
    private readonly resendFailure?: Error,
  ) {}

  async createInvitation(input: CreateUserInvitationInput) {
    this.receivedInput = input

    if (this.failure) {
      throw this.failure
    }

    return {
      userId: invitedUserId,
      deliveryStatus: 'SENT' as const,
    }
  }

  async resendInvitation(input: ResendUserInvitationInput) {
    this.receivedResendInput = input

    if (this.resendFailure) {
      throw this.resendFailure
    }

    return {
      userId: invitedUserId,
      deliveryStatus: 'SENT' as const,
    }
  }
}

class NoopAuditLogService implements AuditLogUseCase {
  async record(_event: AuditEventInput) {}

  async listRecent(_input: ListAuditEventsInput) {
    return []
  }
}

const auditLogService = new NoopAuditLogService()

class FakeAuthorizationService implements AuthorizationUseCase {
  receivedChecks: PermissionCheckInput[] = []

  constructor(private readonly allowed: boolean) {}

  async hasPermission(input: PermissionCheckInput) {
    this.receivedChecks.push(input)
    return this.allowed
  }
}

const allowedAuthorizationService = new FakeAuthorizationService(true)

function buildApp(options: BuildAppOptions) {
  return createApp({
    authorizationService: allowedAuthorizationService,
    ...options,
  })
}

interface AdminCookieOptions {
  mustChangePassword?: boolean
  roles?: string[]
}

async function createAdminCookie(
  app: FastifyInstance,
  options: AdminCookieOptions = {},
): Promise<string> {
  await app.ready()

  const token = app.jwt.sign(
    {
      sub: actorUserId,
      username: 'admin001',
      roles: options.roles ?? ['ADMIN'],
      mustChangePassword: options.mustChangePassword ?? false,
      portal: 'admin',
      aud: ADMIN_JWT_AUDIENCE,
      iss: JWT_ISSUER,
    },
    {
      expiresIn: ADMIN_SESSION_TTL_SECONDS,
    },
  )

  return `${ADMIN_SESSION_COOKIE_NAME}` + `=${token}`
}

test('POST invitation trả 401 khi không có admin session', async (context) => {
  const service = new FakeUserInvitationService()

  const app = buildApp({
    auditLogService,
    userInvitationService: service,
  })

  context.after(async () => {
    await app.close()
  })

  const response = await app.inject({
    method: 'POST',
    url: endpoint,
    payload: validPayload,
  })

  assert.equal(response.statusCode, 401)

  assert.deepEqual(response.json(), {
    message: 'Unauthorized',
  })

  assert.equal(service.receivedInput, undefined)
})

test('POST invitation chặn admin chưa đổi mật khẩu bắt buộc', async (context) => {
  const service = new FakeUserInvitationService()

  const app = buildApp({
    auditLogService,
    userInvitationService: service,
  })

  context.after(async () => {
    await app.close()
  })

  const cookie = await createAdminCookie(app, {
    mustChangePassword: true,
  })

  const response = await app.inject({
    method: 'POST',
    url: endpoint,
    headers: {
      cookie,
    },
    payload: validPayload,
  })

  assert.equal(response.statusCode, 403)

  assert.deepEqual(response.json(), {
    message: 'Password change required',
  })

  assert.equal(service.receivedInput, undefined)
})

test('POST invitation trả 400 khi payload không hợp lệ', async (context) => {
  const service = new FakeUserInvitationService()

  const app = buildApp({
    auditLogService,
    userInvitationService: service,
  })

  context.after(async () => {
    await app.close()
  })

  const cookie = await createAdminCookie(app)

  const response = await app.inject({
    method: 'POST',
    url: endpoint,
    headers: {
      cookie,
    },
    payload: {
      ...validPayload,
      roles: [],
    },
  })

  assert.equal(response.statusCode, 400)

  assert.deepEqual(response.json(), {
    message: 'Invalid request',
  })

  assert.equal(service.receivedInput, undefined)
})

test('POST invitation chuyển actor và dữ liệu user vào use case', async (context) => {
  const service = new FakeUserInvitationService()

  const app = buildApp({
    auditLogService,
    userInvitationService: service,
  })

  context.after(async () => {
    await app.close()
  })

  const cookie = await createAdminCookie(app)

  const response = await app.inject({
    method: 'POST',
    url: endpoint,
    headers: {
      cookie,
    },
    payload: validPayload,
  })

  assert.equal(response.statusCode, 201)

  assert.deepEqual(response.json(), {
    user: {
      id: invitedUserId,
      status: 'INVITED',
    },
    invitation: {
      deliveryStatus: 'SENT',
    },
  })

  assert.deepEqual(service.receivedInput, {
    actorUserId,
    actorUsername: 'admin001',
    actorRoles: ['ADMIN'],
    username: 'student001',
    email: 'student001@example.edu.vn',
    fullName: 'Nguyễn Văn A',
    targetRoles: ['STUDENT'],
    studentCode: 'SV001',
    classId,
    auditContext: {
      requestId: 'req-1',
      ipAddress: '127.0.0.1',
      userAgent: 'lightMyRequest',
    },
  })
})

test('POST invitation trả 403 khi actor không được gán role yêu cầu', async (context) => {
  const service = new FakeUserInvitationService(new ForbiddenRoleAssignmentError())

  const app = buildApp({
    auditLogService,
    userInvitationService: service,
  })

  context.after(async () => {
    await app.close()
  })

  const cookie = await createAdminCookie(app)

  const response = await app.inject({
    method: 'POST',
    url: endpoint,
    headers: {
      cookie,
    },
    payload: {
      ...validPayload,
      roles: ['SYSTEM_ADMIN'],
    },
  })

  assert.equal(response.statusCode, 403)

  assert.deepEqual(response.json(), {
    message: 'Forbidden',
  })
})

test('POST invitation yêu cầu student.create trước khi gọi use case', async (context) => {
  const service = new FakeUserInvitationService()
  const authorizationService = new FakeAuthorizationService(false)

  const app = buildApp({
    auditLogService,
    userInvitationService: service,
    authorizationService,
  })
  context.after(() => app.close())

  const response = await app.inject({
    method: 'POST',
    url: endpoint,
    headers: {
      cookie: await createAdminCookie(app),
    },
    payload: validPayload,
  })

  assert.equal(response.statusCode, 403)
  assert.deepEqual(response.json(), {
    message: 'Forbidden',
  })
  assert.equal(service.receivedInput, undefined)
  assert.deepEqual(authorizationService.receivedChecks, [
    {
      userId: actorUserId,
      permission: 'student.create',
    },
  ])
})

test('POST invitation trả 422 và field classId khi lớp không tồn tại', async (context) => {
  const service = new FakeUserInvitationService(new AcademicClassNotFoundError())
  const app = buildApp({
    auditLogService,
    userInvitationService: service,
  })
  context.after(() => app.close())

  const response = await app.inject({
    method: 'POST',
    url: endpoint,
    headers: {
      cookie: await createAdminCookie(app),
    },
    payload: validPayload,
  })

  assert.equal(response.statusCode, 422)
  assert.deepEqual(response.json(), {
    error: {
      code: 'UNPROCESSABLE_ENTITY',
      field: 'classId',
      message: 'Academic class not found or inactive',
    },
    requestId: 'req-1',
  })
})

test('POST invitation che giấu chi tiết khi lớp nằm ngoài scope', async (context) => {
  const service = new FakeUserInvitationService(new AcademicClassOutsideScopeError())
  const app = buildApp({
    auditLogService,
    userInvitationService: service,
  })
  context.after(() => app.close())

  const response = await app.inject({
    method: 'POST',
    url: endpoint,
    headers: {
      cookie: await createAdminCookie(app),
    },
    payload: validPayload,
  })

  assert.equal(response.statusCode, 403)
  assert.deepEqual(response.json(), {
    message: 'Forbidden',
  })
})

test('POST invitation trả 409 và field studentCode khi mã sinh viên trùng', async (context) => {
  const service = new FakeUserInvitationService(new InvitationConflictError('studentCode'))
  const app = buildApp({
    auditLogService,
    userInvitationService: service,
  })
  context.after(() => app.close())

  const response = await app.inject({
    method: 'POST',
    url: endpoint,
    headers: {
      cookie: await createAdminCookie(app),
    },
    payload: validPayload,
  })

  assert.equal(response.statusCode, 409)
  assert.deepEqual(response.json(), {
    error: {
      code: 'CONFLICT',
      field: 'studentCode',
      message: 'studentCode already exists',
    },
    requestId: 'req-1',
  })
})

test('POST resend tạo lại lời mời cho user INVITED', async (context) => {
  const service = new FakeUserInvitationService()
  const app = buildApp({
    auditLogService,
    userInvitationService: service,
  })
  context.after(() => app.close())

  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/users/${invitedUserId}/invitations/resend`,
    headers: {
      cookie: await createAdminCookie(app),
    },
  })

  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json(), {
    user: {
      id: invitedUserId,
      status: 'INVITED',
    },
    invitation: {
      deliveryStatus: 'SENT',
    },
  })
  assert.deepEqual(service.receivedResendInput, {
    actorUserId,
    actorUsername: 'admin001',
    actorRoles: ['ADMIN'],
    userId: invitedUserId,
    auditContext: {
      requestId: 'req-1',
      ipAddress: '127.0.0.1',
      userAgent: 'lightMyRequest',
    },
  })
})

test('POST resend yêu cầu quyền quản lý lời mời', async (context) => {
  const service = new FakeUserInvitationService()
  const authorizationService = new FakeAuthorizationService(false)
  const app = buildApp({
    auditLogService,
    userInvitationService: service,
    authorizationService,
  })
  context.after(() => app.close())

  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/users/${invitedUserId}/invitations/resend`,
    headers: {
      cookie: await createAdminCookie(app),
    },
  })

  assert.equal(response.statusCode, 403)
  assert.deepEqual(response.json(), {
    message: 'Forbidden',
  })
  assert.equal(service.receivedResendInput, undefined)
  assert.deepEqual(authorizationService.receivedChecks, [
    {
      userId: actorUserId,
      permission: 'student.create',
    },
    {
      userId: actorUserId,
      permission: 'user.manage',
    },
  ])
})

test('POST resend trả 403 khi tài khoản đích ngoài phạm vi', async (context) => {
  const service = new FakeUserInvitationService(undefined, new InvitationTargetForbiddenError())
  const app = buildApp({
    auditLogService,
    userInvitationService: service,
  })
  context.after(() => app.close())

  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/users/${invitedUserId}/invitations/resend`,
    headers: {
      cookie: await createAdminCookie(app),
    },
  })

  assert.equal(response.statusCode, 403)
  assert.deepEqual(response.json(), {
    message: 'Forbidden',
  })
})

test('POST resend phân biệt user không tồn tại và lời mời không thể gửi lại', async (context) => {
  const notFoundService = new FakeUserInvitationService(
    undefined,
    new InvitationUserNotFoundError(),
  )
  const activeUserService = new FakeUserInvitationService(
    undefined,
    new InvitationNotResendableError(),
  )
  const notFoundApp = buildApp({
    auditLogService,
    userInvitationService: notFoundService,
  })
  const activeUserApp = buildApp({
    auditLogService,
    userInvitationService: activeUserService,
  })
  context.after(async () => {
    await notFoundApp.close()
    await activeUserApp.close()
  })

  const notFoundResponse = await notFoundApp.inject({
    method: 'POST',
    url: `/api/v1/admin/users/${invitedUserId}/invitations/resend`,
    headers: {
      cookie: await createAdminCookie(notFoundApp),
    },
  })
  const activeUserResponse = await activeUserApp.inject({
    method: 'POST',
    url: `/api/v1/admin/users/${invitedUserId}/invitations/resend`,
    headers: {
      cookie: await createAdminCookie(activeUserApp),
    },
  })

  assert.equal(notFoundResponse.statusCode, 404)
  assert.deepEqual(notFoundResponse.json(), {
    message: 'Invited user not found',
  })
  assert.equal(activeUserResponse.statusCode, 409)
  assert.deepEqual(activeUserResponse.json(), {
    message: 'Invitation cannot be resent',
  })
})
