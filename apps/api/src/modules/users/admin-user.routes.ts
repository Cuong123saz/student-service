import {
  type Static,
  Type,
} from '@sinclair/typebox'

import type {
  FastifyInstance,
  FastifyPluginOptions,
} from 'fastify'

import {
  requireAdminReadySession,
  requireAdminSession,
} from '../auth/admin-auth.guard.js'

import {
  EmptyRoleAssignmentError,
  ForbiddenRoleAssignmentError,
} from './role-assignment-policy.js'

import type {
  UserInvitationUseCase,
} from './user-invitation.service.js'

const systemRoleSchema =
  Type.Union([
    Type.Literal('SYSTEM_ADMIN'),
    Type.Literal('ADMIN'),
    Type.Literal('STUDENT'),
    Type.Literal(
      'ACADEMIC_ADVISOR',
    ),
    Type.Literal(
      'FACULTY_REVIEWER',
    ),
    Type.Literal(
      'DOCUMENT_SIGNER',
    ),
  ])

const createInvitationBodySchema =
  Type.Object(
    {
      username: Type.String({
        minLength: 1,
        maxLength: 100,
      }),

      email: Type.String({
        minLength: 3,
        maxLength: 255,
        format: 'email',
      }),

      fullName: Type.String({
        minLength: 2,
        maxLength: 255,
      }),

      roles: Type.Array(
        systemRoleSchema,
        {
          minItems: 1,
          maxItems: 6,
          uniqueItems: true,
        },
      ),
    },
    {
      additionalProperties: false,
    },
  )

type CreateInvitationBody =
  Static<
    typeof createInvitationBodySchema
  >

const createInvitationResponseSchema =
  Type.Object({
    user: Type.Object({
      id: Type.String({
        format: 'uuid',
      }),

      status:
        Type.Literal('INVITED'),
    }),
  })

const errorResponseSchema =
  Type.Object({
    message: Type.String(),
  })

export interface AdminUserRoutesOptions
extends FastifyPluginOptions {
  invitationService:
    UserInvitationUseCase
}

export async function adminUserRoutes(
  app: FastifyInstance,
  options: AdminUserRoutesOptions,
) {
  app.post<{
    Body: CreateInvitationBody
  }>(
    '/users/invitations',
    {
      preHandler: [
        requireAdminSession,
        requireAdminReadySession,
      ],

      schema: {
        body:
          createInvitationBodySchema,

        response: {
          201:
            createInvitationResponseSchema,

          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          429: errorResponseSchema,
        },
      },

      config: {
        rateLimit: {
          max: 20,
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
        const result =
          await options
            .invitationService
            .createInvitation({
              actorUserId:
                session.sub,

              actorRoles:
                session.roles,

              username:
                request.body.username,

              email:
                request.body.email,

              fullName:
                request.body.fullName,

              targetRoles:
                request.body.roles,
            })

        return reply.code(201).send({
          user: {
            id: result.userId,
            status: 'INVITED',
          },
        })
      } catch (error: unknown) {
        if (
          error
            instanceof EmptyRoleAssignmentError
        ) {
          return reply.code(400).send({
            message: error.message,
          })
        }

        if (
          error
            instanceof ForbiddenRoleAssignmentError
        ) {
          return reply.code(403).send({
            message: 'Forbidden',
          })
        }

        throw error
      }
    },
  )
}