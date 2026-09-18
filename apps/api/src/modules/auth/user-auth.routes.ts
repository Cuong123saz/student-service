import { type Static, Type } from '@sinclair/typebox'

import type { FastifyInstance, FastifyPluginOptions } from 'fastify'
import { requireUserSession } from './user-auth.guard.js'
import { env } from '../../config/env.js'

import { DrizzleAuthUserRepository } from './auth.repository.js'

import {
  JWT_ISSUER,
  USER_API_PREFIX,
  USER_JWT_AUDIENCE,
  USER_SESSION_COOKIE_NAME,
  USER_SESSION_TTL_SECONDS,
} from './auth.constants.js'

import { AuthService, InvalidCredentialsError, type AuthenticationUseCase } from './auth.service.js'

import { Argon2PasswordHasher } from './password-hasher.js'

const loginBodySchema = Type.Object(
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

type LoginBody = Static<typeof loginBodySchema>

const authenticatedUserSchema = Type.Object({
  id: Type.String(),
  username: Type.String(),
  mustChangePassword: Type.Boolean(),
  roles: Type.Array(Type.String()),
})

const loginResponseSchema = Type.Object({
  user: authenticatedUserSchema,
})

const errorResponseSchema = Type.Object({
  message: Type.String(),
})

const USER_PORTAL_ROLES = new Set([
  'STUDENT',
  'ACADEMIC_ADVISOR',
  'FACULTY_REVIEWER',
  'DOCUMENT_SIGNER',
])

const userSessionCookieOptions = {
  httpOnly: true,
  secure: env.isProduction,
  sameSite: 'strict',
  path: USER_API_PREFIX,
} as const

export interface UserAuthRoutesOptions extends FastifyPluginOptions {
  authenticationService?: AuthenticationUseCase
}

async function createDefaultAuthenticationService(): Promise<AuthenticationUseCase> {
  const passwordHasher = new Argon2PasswordHasher()

  const dummyPasswordHash = await passwordHasher.hash('dummy-password-used-for-timing-only')

  return new AuthService(new DrizzleAuthUserRepository(), passwordHasher, dummyPasswordHash)
}

export async function userAuthRoutes(app: FastifyInstance, options: UserAuthRoutesOptions) {
  const authenticationService =
    options.authenticationService ?? (await createDefaultAuthenticationService())

  app.post<{
    Body: LoginBody
  }>(
    '/auth/login',
    {
      schema: {
        body: loginBodySchema,

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
        const user = await authenticationService.authenticate(request.body)

        const canAccessUserPortal = user.roles.some((role) => USER_PORTAL_ROLES.has(role))

        if (!canAccessUserPortal) {
          return reply.code(403).send({
            message: 'Forbidden',
          })
        }

        const token = await reply.jwtSign(
          {
            sub: user.id,
            username: user.username,
            roles: user.roles,
            mustChangePassword: user.mustChangePassword,
            portal: 'user',
            aud: USER_JWT_AUDIENCE,
            iss: JWT_ISSUER,
          },
          {
            expiresIn: USER_SESSION_TTL_SECONDS,
          },
        )

        reply.setCookie(USER_SESSION_COOKIE_NAME, token, {
          ...userSessionCookieOptions,

          maxAge: USER_SESSION_TTL_SECONDS,
        })

        return reply.code(200).send({
          user,
        })
      } catch (error: unknown) {
        if (error instanceof InvalidCredentialsError) {
          return reply.code(401).send({
            message: 'Invalid username or password',
          })
        }

        throw error
      }
    },
  )
  app.get(
    '/auth/me',
    {
      preHandler: requireUserSession,

      schema: {
        response: {
          200: loginResponseSchema,

          401: errorResponseSchema,

          403: errorResponseSchema,
        },
      },
    },

    async (request, reply) => {
      const session = request.userSession

      if (!session) {
        return reply.code(401).send({
          message: 'Unauthorized',
        })
      }

      return reply.code(200).send({
        user: {
          id: session.sub,

          username: session.username,

          mustChangePassword: session.mustChangePassword,

          roles: session.roles,
        },
      })
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
      reply.clearCookie(USER_SESSION_COOKIE_NAME, userSessionCookieOptions)

      return reply.code(204).send()
    },
  )
}
