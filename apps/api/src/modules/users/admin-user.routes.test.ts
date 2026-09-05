import assert from 'node:assert/strict'
import { test } from 'node:test'

import type {
  FastifyInstance,
} from 'fastify'

import {
  buildApp,
} from '../../app.js'

import {
  ADMIN_JWT_AUDIENCE,
  ADMIN_SESSION_COOKIE_NAME,
  ADMIN_SESSION_TTL_SECONDS,
  JWT_ISSUER,
} from '../auth/auth.constants.js'

import {
  ForbiddenRoleAssignmentError,
} from './role-assignment-policy.js'

import type {
  CreateUserInvitationInput,
  UserInvitationUseCase,
} from './user-invitation.service.js'

const endpoint =
  '/api/v1/admin/users/invitations'

const actorUserId =
  '2f230120-c001-4e71-a17d-f18541e64d87'

const invitedUserId =
  '85ca4291-c7bd-4370-a117-976bf237261c'

const validPayload = {
  username: 'student001',
  email:
    'student001@example.edu.vn',
  fullName: 'Nguyễn Văn A',
  roles: ['STUDENT'],
}

class FakeUserInvitationService
implements UserInvitationUseCase {
  receivedInput:
    CreateUserInvitationInput
    | undefined

  constructor(
    private readonly failure?: Error,
  ) {}

  async createInvitation(
    input: CreateUserInvitationInput,
  ) {
    this.receivedInput = input

    if (this.failure) {
      throw this.failure
    }

    return {
      userId: invitedUserId,
    }
  }
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

  const token =
    app.jwt.sign(
      {
        sub: actorUserId,
        username: 'admin001',
        roles:
          options.roles
          ?? ['ADMIN'],
        mustChangePassword:
          options.mustChangePassword
          ?? false,
        portal: 'admin',
        aud:
          ADMIN_JWT_AUDIENCE,
        iss: JWT_ISSUER,
      },
      {
        expiresIn:
          ADMIN_SESSION_TTL_SECONDS,
      },
    )

  return (
    `${ADMIN_SESSION_COOKIE_NAME}`
    + `=${token}`
  )
}

test(
  'POST invitation trả 401 khi không có admin session',
  async (context) => {
    const service =
      new FakeUserInvitationService()

    const app = buildApp({
      userInvitationService:
        service,
    })

    context.after(async () => {
      await app.close()
    })

    const response =
      await app.inject({
        method: 'POST',
        url: endpoint,
        payload: validPayload,
      })

    assert.equal(
      response.statusCode,
      401,
    )

    assert.deepEqual(
      response.json(),
      {
        message: 'Unauthorized',
      },
    )

    assert.equal(
      service.receivedInput,
      undefined,
    )
  },
)

test(
  'POST invitation chặn admin chưa đổi mật khẩu bắt buộc',
  async (context) => {
    const service =
      new FakeUserInvitationService()

    const app = buildApp({
      userInvitationService:
        service,
    })

    context.after(async () => {
      await app.close()
    })

    const cookie =
      await createAdminCookie(
        app,
        {
          mustChangePassword: true,
        },
      )

    const response =
      await app.inject({
        method: 'POST',
        url: endpoint,
        headers: {
          cookie,
        },
        payload: validPayload,
      })

    assert.equal(
      response.statusCode,
      403,
    )

    assert.deepEqual(
      response.json(),
      {
        message:
          'Password change required',
      },
    )

    assert.equal(
      service.receivedInput,
      undefined,
    )
  },
)

test(
  'POST invitation trả 400 khi payload không hợp lệ',
  async (context) => {
    const service =
      new FakeUserInvitationService()

    const app = buildApp({
      userInvitationService:
        service,
    })

    context.after(async () => {
      await app.close()
    })

    const cookie =
      await createAdminCookie(app)

    const response =
      await app.inject({
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

    assert.equal(
      response.statusCode,
      400,
    )

    assert.deepEqual(
      response.json(),
      {
        message: 'Invalid request',
      },
    )

    assert.equal(
      service.receivedInput,
      undefined,
    )
  },
)

test(
  'POST invitation chuyển actor và dữ liệu user vào use case',
  async (context) => {
    const service =
      new FakeUserInvitationService()

    const app = buildApp({
      userInvitationService:
        service,
    })

    context.after(async () => {
      await app.close()
    })

    const cookie =
      await createAdminCookie(app)

    const response =
      await app.inject({
        method: 'POST',
        url: endpoint,
        headers: {
          cookie,
        },
        payload: validPayload,
      })

    assert.equal(
      response.statusCode,
      201,
    )

    assert.deepEqual(
      response.json(),
      {
        user: {
          id: invitedUserId,
          status: 'INVITED',
        },
      },
    )

    assert.deepEqual(
      service.receivedInput,
      {
        actorUserId,
        actorRoles: ['ADMIN'],
        username: 'student001',
        email:
          'student001@example.edu.vn',
        fullName: 'Nguyễn Văn A',
        targetRoles: ['STUDENT'],
      },
    )
  },
)

test(
  'POST invitation trả 403 khi actor không được gán role yêu cầu',
  async (context) => {
    const service =
      new FakeUserInvitationService(
        new ForbiddenRoleAssignmentError(),
      )

    const app = buildApp({
      userInvitationService:
        service,
    })

    context.after(async () => {
      await app.close()
    })

    const cookie =
      await createAdminCookie(app)

    const response =
      await app.inject({
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

    assert.equal(
      response.statusCode,
      403,
    )

    assert.deepEqual(
      response.json(),
      {
        message: 'Forbidden',
      },
    )
  },
)