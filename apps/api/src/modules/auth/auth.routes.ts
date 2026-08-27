import type {FastifyInstance,} from 'fastify'
import {  type Static,Type,} from '@sinclair/typebox'
import {requireAdminSession,} from './admin-auth.guard.js'
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
  async (_request, reply) => {
    reply.clearCookie(
      ADMIN_SESSION_COOKIE_NAME,
      adminSessionCookieOptions,
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

 return reply.code(200).send({user, }) } catch (error: unknown) {
        if (
          error
          instanceof InvalidCredentialsError
        ) {
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