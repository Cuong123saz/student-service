import {
  type Static,
  Type,
} from '@sinclair/typebox'

import type {
  FastifyInstance,
  FastifyPluginOptions,
} from 'fastify'

import {
  InvalidPasswordError,
  MAX_PASSWORD_LENGTH,
} from '../auth/password-policy.js'
import {
  InvalidActivationTokenError,
  type AccountActivationUseCase,
} from './account-activation.service.js'

const activateAccountBodySchema =
  Type.Object(
    {
      token: Type.String({
        minLength: 43,
        maxLength: 43,
        pattern:
          '^[A-Za-z0-9_-]+$',
      }),

      newPassword: Type.String({
        minLength: 1,
        maxLength:
          MAX_PASSWORD_LENGTH,
      }),
    },
    {
      additionalProperties: false,
    },
  )
const errorResponseSchema =
  Type.Object({
    message: Type.String(),
  })
type ActivateAccountBody =
  Static<
    typeof activateAccountBodySchema
  >

export interface AccountActivationRoutesOptions
extends FastifyPluginOptions {
  activationService:
    AccountActivationUseCase
}

export async function accountActivationRoutes(
  app: FastifyInstance,
  options:
    AccountActivationRoutesOptions,
) {
  app.post<{
    Body: ActivateAccountBody
  }>(
    '/auth/activate',
   {
  schema: {
    body:
      activateAccountBodySchema,

    response: {
      400: errorResponseSchema,
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
    await options
      .activationService
      .activateAccount({
        rawToken:
          request.body.token,

        newPassword:
          request.body.newPassword,
      })

    return reply
      .code(204)
      .send()
  } catch (error: unknown) {
   if (
  error
    instanceof InvalidActivationTokenError
  || error
    instanceof InvalidPasswordError
) {
  return reply
    .code(400)
    .send({
      message: error.message,
    })
}

throw error
  }
},
  )}