import type {FastifyInstance,FastifyPluginOptions,} from 'fastify'
import {  type Static,Type,} from '@sinclair/typebox'
import {requireAdminSession,} from './admin-auth.guard.js'
import {isAdminSession,} from './auth-session.js'
import {getAuditRequestContext,} from '../audit/audit-request-context.js'
import {recordAuditEventSafely,type AuditRecorder,} from '../audit/audit.service.js'
import { env } from '../../config/env.js'
import {DrizzleAuthUserRepository,} from './auth.repository.js'
import { AuthService, InvalidCredentialsError,} from './auth.service.js'
import { Argon2PasswordHasher,} from './password-hasher.js'
import { ADMIN_API_PREFIX, ADMIN_JWT_AUDIENCE, ADMIN_SESSION_COOKIE_NAME, ADMIN_SESSION_TTL_SECONDS, JWT_ISSUER, } from './auth.constants.js'
import {AccountUnavailableError, CurrentPasswordMismatchError, PasswordChangeService, PasswordReuseError,} from './password-change.service.js'
import { InvalidPasswordError,} from './password-policy.js'
const adminLoginBodySchema = Type.Object(
  {
    username: Type.String({
      minLength: 1,
      maxLength: 100,
    }),

    password: Type.String({
      minLength: 1,
      maxLength: 128,
    }),
  },
  {
    additionalProperties: false,
  },
)
const adminChangePasswordBodySchema =
  Type.Object(
    {
      currentPassword: Type.String({
        minLength: 1,
        maxLength: 128,
      }),

      newPassword: Type.String({
        minLength: 1,
        maxLength: 128,
      }),
    },
    {
      additionalProperties: false,
    },
  )

type AdminChangePasswordBody =
  Static<
    typeof adminChangePasswordBodySchema
  >
const currentAdminResponseSchema =
  Type.Object({
    user: Type.Object({
      id: Type.String(),
      username: Type.String(),
      mustChangePassword: Type.Boolean(),
      roles: Type.Array(
        Type.String(),
      ),
    }),
  })
const authenticatedUserSchema =
  Type.Object({
    id: Type.String(),
    username: Type.String(),
    mustChangePassword:
      Type.Boolean(),
    roles: Type.Array(
      Type.String(),
    ),
  })

const loginResponseSchema =
  Type.Object({
    user: authenticatedUserSchema,
  })

const errorResponseSchema =
  Type.Object({
    message: Type.String(),
  })
const adminSessionCookieOptions = {
  httpOnly: true,
  secure: env.isProduction,
  sameSite: 'strict',
  path: ADMIN_API_PREFIX,
} as const
type AdminLoginBody =
  Static<typeof adminLoginBodySchema>

const passwordHasher =
  new Argon2PasswordHasher()

const dummyPasswordHashPromise =
  passwordHasher.hash(
    'dummy-password-used-for-timing-only',
  )

export async function adminAuthRoutes(
  app: FastifyInstance,
  options: AdminAuthRoutesOptions,
) {
  const dummyPasswordHash =
    await dummyPasswordHashPromise

const authRepository =
  new DrizzleAuthUserRepository()

const authService = new AuthService(
  authRepository,
  passwordHasher,
  dummyPasswordHash,
)

const passwordChangeService =
  new PasswordChangeService(
    authRepository,
    passwordHasher,
  )
  app.post<{
  Body: AdminChangePasswordBody
}>(
  '/auth/change-password',
  {
    preHandler:
      requireAdminSession,

    schema: {
      body:
        adminChangePasswordBodySchema,

      response: {
        204: Type.Null(),
        400: errorResponseSchema,
        401: errorResponseSchema,
        403: errorResponseSchema,
        429: errorResponseSchema,
      },
    },

    config: {
      rateLimit: {
        max: 5,
        timeWindow: '1 minute',
      },
    },
  },
  async (request, reply) => {
    const session =
      request.adminSession

    if (!session) {
      return reply.code(401).send({
        message: 'Unauthorized',
      })
    }

    try {
      await passwordChangeService
        .changePassword({
          userId: session.sub,
          currentPassword:
            request.body
              .currentPassword,
          newPassword:
            request.body.newPassword,
        })

      await recordAuditEventSafely(
        options.auditRecorder,
        request.log,
        {
          actorType: 'USER',
          actorUserId: session.sub,
          actorUsername:
            session.username,
          action:
            'ADMIN_PASSWORD_CHANGE',
          resourceType: 'USER',
          resourceId: session.sub,
          outcome: 'SUCCESS',
          ...getAuditRequestContext(
            request,
          ),
          metadata: {},
        },
      )

      reply.clearCookie(
        ADMIN_SESSION_COOKIE_NAME,
        adminSessionCookieOptions,
      )

      return reply.code(204).send()
    } catch (error: unknown) {
      if (
        error
        instanceof AccountUnavailableError
      ) {
        await recordAuditEventSafely(
          options.auditRecorder,
          request.log,
          {
            actorType: 'USER',
            actorUserId: session.sub,
            actorUsername:
              session.username,
            action:
              'ADMIN_PASSWORD_CHANGE',
            resourceType: 'USER',
            resourceId: session.sub,
            outcome: 'FAILURE',
            ...getAuditRequestContext(
              request,
            ),
            metadata: {
              reason:
                'ACCOUNT_UNAVAILABLE',
            },
          },
        )

        reply.clearCookie(
          ADMIN_SESSION_COOKIE_NAME,
          adminSessionCookieOptions,
        )

        return reply.code(401).send({
          message: 'Unauthorized',
        })
      }

      if (
        error
          instanceof CurrentPasswordMismatchError
        || error
          instanceof PasswordReuseError
        || error
          instanceof InvalidPasswordError
      ) {
        await recordAuditEventSafely(
          options.auditRecorder,
          request.log,
          {
            actorType: 'USER',
            actorUserId: session.sub,
            actorUsername:
              session.username,
            action:
              'ADMIN_PASSWORD_CHANGE',
            resourceType: 'USER',
            resourceId: session.sub,
            outcome: 'FAILURE',
            ...getAuditRequestContext(
              request,
            ),
            metadata: {
              reason:
                error.name,
            },
          },
        )

        return reply.code(400).send({
          message: error.message,
        })
      }

      throw error
    }
  },
)
  app.post(
  '/auth/logout',
  {
    schema: {
      response: {
        204: Type.Null(),
      },
    },
  },
  async (request, reply) => {
    const serializedSession =
      request.cookies[
        ADMIN_SESSION_COOKIE_NAME
      ]
    let actorUserId: string | null = null
    let actorUsername: string | null = null

    if (serializedSession) {
      try {
        const decoded: unknown =
          request.server.jwt.verify(
            serializedSession,
            {
              allowedAud:
                ADMIN_JWT_AUDIENCE,
              allowedIss: JWT_ISSUER,
            },
          )

        if (isAdminSession(decoded)) {
          actorUserId = decoded.sub
          actorUsername =
            decoded.username
        }
      } catch {
        // Logout stays idempotent even if the cookie is invalid or expired.
      }
    }

    reply.clearCookie(
      ADMIN_SESSION_COOKIE_NAME,
      adminSessionCookieOptions,
    )

    await recordAuditEventSafely(
      options.auditRecorder,
      request.log,
      {
        actorType:
          actorUserId
            ? 'USER'
            : 'ANONYMOUS',
        actorUserId,
        actorUsername,
        action: 'ADMIN_LOGOUT',
        resourceType: 'ADMIN_SESSION',
        resourceId: null,
        outcome: 'SUCCESS',
        ...getAuditRequestContext(request),
        metadata: {},
      },
    )

    return reply.code(204).send()
  },
)
app.get(
  '/auth/me',
  {
    preHandler:
      requireAdminSession,

    schema: {
      response: {
        200:
          currentAdminResponseSchema,
        401: errorResponseSchema,
        403: errorResponseSchema,
      },
    },
  },
 async (request, reply) => {
  const session =
    request.adminSession

  if (!session) {
    return reply.code(401).send({
      message: 'Unauthorized',
    })
  }

  return {
    user: {
      id: session.sub,
      username:
        session.username,
     mustChangePassword:
      session.mustChangePassword,
      roles:
        session.roles,
    },
  }
},
)
app.post<{
    Body: AdminLoginBody
  }>(
     '/auth/login',
    {
      schema: {
        body: adminLoginBodySchema,

        response: {
          200: loginResponseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          429: errorResponseSchema,
        },
      },

      config: {
        rateLimit: {
          max: 5,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
      try {
        const user =
          await authService.authenticate(
            request.body,
          )

        const canAccessAdminPortal =
          user.roles.some(
            (role) =>
              role === 'ADMIN'
              || role
                === 'SYSTEM_ADMIN',
          )

        if (!canAccessAdminPortal) {
          await recordAuditEventSafely(
            options.auditRecorder,
            request.log,
            {
              actorType: 'USER',
              actorUserId: user.id,
              actorUsername:
                user.username,
              action: 'ADMIN_LOGIN',
              resourceType:
                'ADMIN_SESSION',
              resourceId: null,
              outcome: 'FAILURE',
              ...getAuditRequestContext(
                request,
              ),
              metadata: {
                reason:
                  'PORTAL_ACCESS_DENIED',
              },
            },
          )

          return reply
            .code(403)
            .send({
              message: 'Forbidden',
            })
        }
const token = await reply.jwtSign(
    {
      sub: user.id,
      username: user.username,
      roles: user.roles,
      mustChangePassword:
  user.mustChangePassword,
      portal: 'admin',
      aud: ADMIN_JWT_AUDIENCE,
      iss: JWT_ISSUER,
    },
    {
      expiresIn:
        ADMIN_SESSION_TTL_SECONDS,
    },
  )

reply.setCookie(
  ADMIN_SESSION_COOKIE_NAME,
  token,
  {
    ...adminSessionCookieOptions,
    maxAge:
      ADMIN_SESSION_TTL_SECONDS,
  },
)

await recordAuditEventSafely(
  options.auditRecorder,
  request.log,
  {
    actorType: 'USER',
    actorUserId: user.id,
    actorUsername: user.username,
    action: 'ADMIN_LOGIN',
    resourceType: 'ADMIN_SESSION',
    resourceId: null,
    outcome: 'SUCCESS',
    ...getAuditRequestContext(request),
    metadata: {},
  },
)

 return reply.code(200).send({user, }) } catch (error: unknown) {
        if (
          error
          instanceof InvalidCredentialsError
        ) {
          await recordAuditEventSafely(
            options.auditRecorder,
            request.log,
            {
              actorType: 'ANONYMOUS',
              actorUserId: null,
              actorUsername:
                request.body.username
                  .trim()
                  .toLowerCase(),
              action: 'ADMIN_LOGIN',
              resourceType:
                'ADMIN_SESSION',
              resourceId: null,
              outcome: 'FAILURE',
              ...getAuditRequestContext(
                request,
              ),
              metadata: {
                reason:
                  'INVALID_CREDENTIALS',
              },
            },
          )

          return reply
            .code(401)
            .send({
              message:
                'Invalid username or password',
            })
        }

        throw error
      }
    },
  )
}

export interface AdminAuthRoutesOptions
extends FastifyPluginOptions {
  auditRecorder: AuditRecorder
}
