import {
  type Static,
  Type,
} from '@sinclair/typebox'

import type {
  FastifyInstance,
  FastifyPluginOptions,
} from 'fastify'

import {
  getAuditRequestContext,
} from '../audit/audit-request-context.js'
import {
  recordAuditEventSafely,
  type AuditRecorder,
} from '../audit/audit.service.js'

import {
  requireAdminReadySession,
  requireAdminSession,
} from '../auth/admin-auth.guard.js'

import {
  AcademicClassNotFoundError,
  InvitationConflictError,
  InvitationNotResendableError,
  InvitationUserNotFoundError,
} from './user-invitation.repository.js'

import {
  EmptyRoleAssignmentError,
  ForbiddenRoleAssignmentError,
} from './role-assignment-policy.js'

import {
  StudentAcademicDataNotAllowedError,
  StudentAcademicDataRequiredError,
  type UserInvitationUseCase,
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

      studentCode: Type.Optional(
        Type.String({
          minLength: 1,
          maxLength: 50,
        }),
      ),

      classId: Type.Optional(
        Type.String({ format: 'uuid' }),
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
    invitation: Type.Object({
      deliveryStatus: Type.Union([
        Type.Literal('SENT'),
        Type.Literal('FAILED'),
      ]),
    }),
  })

const errorResponseSchema =
  Type.Object({
    message: Type.String(),
  })

const fieldErrorResponseSchema =
  Type.Object({
    error: Type.Object({
      code: Type.String(),
      field: Type.String(),
      message: Type.String(),
    }),
    requestId: Type.String(),
  })

const resendInvitationParamsSchema =
  Type.Object({
    userId: Type.String({ format: 'uuid' }),
  })

type ResendInvitationParams = Static<
  typeof resendInvitationParamsSchema
>

export interface AdminUserRoutesOptions
extends FastifyPluginOptions {
  invitationService:
    UserInvitationUseCase

  auditRecorder: AuditRecorder
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

          400: Type.Union([
            errorResponseSchema,
            fieldErrorResponseSchema,
          ]),
          401: errorResponseSchema,
          403: errorResponseSchema,
          409: Type.Union([
            errorResponseSchema,
            fieldErrorResponseSchema,
          ]),
          422: fieldErrorResponseSchema,
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

              actorUsername:
                session.username,

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

              auditContext:
                getAuditRequestContext(
                  request,
                ),

              ...(request.body.studentCode
                ? {
                    studentCode:
                      request.body.studentCode,
                  }
                : {}),

              ...(request.body.classId
                ? {
                    classId:
                      request.body.classId,
                  }
                : {}),
            })

        await recordAuditEventSafely(
          options.auditRecorder,
          request.log,
          {
            actorType: 'USER',
            actorUserId: session.sub,
            actorUsername:
              session.username,
            action: result.deliveryStatus
              === 'SENT'
              ? 'INVITATION_EMAIL_SENT'
              : 'INVITATION_EMAIL_FAILED',
            resourceType: 'USER',
            resourceId: result.userId,
            outcome: result.deliveryStatus
              === 'SENT'
              ? 'SUCCESS'
              : 'FAILURE',
            ...getAuditRequestContext(
              request,
            ),
            metadata: {
              deliveryStatus:
                result.deliveryStatus,
            },
          },
        )

        return reply.code(201).send({
          user: {
            id: result.userId,
            status: 'INVITED',
          },
          invitation: {
            deliveryStatus:
              result.deliveryStatus,
          },
        })
      } catch (error: unknown) {
        if (
          error instanceof
            StudentAcademicDataRequiredError
          || error instanceof
            StudentAcademicDataNotAllowedError
        ) {
          return reply.code(400).send({
            error: {
              code: 'VALIDATION_ERROR',
              field: error.field,
              message: error.message,
            },
            requestId: request.id,
          })
        }

        if (error instanceof InvitationConflictError) {
          return reply.code(409).send({
            error: {
              code: 'CONFLICT',
              field: error.field,
              message: error.message,
            },
            requestId: request.id,
          })
        }

        if (error instanceof AcademicClassNotFoundError) {
          return reply.code(422).send({
            error: {
              code: 'UNPROCESSABLE_ENTITY',
              field: 'classId',
              message: error.message,
            },
            requestId: request.id,
          })
        }

        if (
          error
            instanceof EmptyRoleAssignmentError
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
                'USER_INVITATION_CREATE',
              resourceType: 'USER',
              resourceId: null,
              outcome: 'FAILURE',
              ...getAuditRequestContext(
                request,
              ),
              metadata: {
                reason: 'EMPTY_ROLES',
                targetUsername:
                  request.body.username,
              },
            },
          )

          return reply.code(400).send({
            message: error.message,
          })
        }

        if (
          error
            instanceof ForbiddenRoleAssignmentError
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
                'USER_INVITATION_CREATE',
              resourceType: 'USER',
              resourceId: null,
              outcome: 'FAILURE',
              ...getAuditRequestContext(
                request,
              ),
              metadata: {
                reason:
                  'FORBIDDEN_ROLE_ASSIGNMENT',
                targetUsername:
                  request.body.username,
                targetRoles:
                  request.body.roles,
              },
            },
          )

          return reply.code(403).send({
            message: 'Forbidden',
          })
        }

        await recordAuditEventSafely(
          options.auditRecorder,
          request.log,
          {
            actorType: 'USER',
            actorUserId: session.sub,
            actorUsername:
              session.username,
            action:
              'USER_INVITATION_CREATE',
            resourceType: 'USER',
            resourceId: null,
            outcome: 'FAILURE',
            ...getAuditRequestContext(
              request,
            ),
            metadata: {
              reason: 'UNEXPECTED_ERROR',
              targetUsername:
                request.body.username,
            },
          },
        )

        throw error
      }
    },
  )

  app.post<{
    Params: ResendInvitationParams
  }>(
    '/users/:userId/invitations/resend',
    {
      preHandler: [
        requireAdminSession,
        requireAdminReadySession,
      ],
      schema: {
        params: resendInvitationParamsSchema,
        response: {
          200: createInvitationResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
          429: errorResponseSchema,
        },
      },
      config: {
        rateLimit: {
          max: 3,
          timeWindow: '15 minutes',
        },
      },
    },
    async (request, reply) => {
      const session = request.adminSession

      if (!session) {
        return reply.code(401).send({
          message: 'Unauthorized',
        })
      }

      try {
        const result = await options
          .invitationService
          .resendInvitation({
            actorUserId: session.sub,
            actorUsername: session.username,
            actorRoles: session.roles,
            userId: request.params.userId,
            auditContext:
              getAuditRequestContext(request),
          })

        await recordAuditEventSafely(
          options.auditRecorder,
          request.log,
          {
            actorType: 'USER',
            actorUserId: session.sub,
            actorUsername: session.username,
            action: result.deliveryStatus === 'SENT'
              ? 'INVITATION_EMAIL_SENT'
              : 'INVITATION_EMAIL_FAILED',
            resourceType: 'USER',
            resourceId: result.userId,
            outcome: result.deliveryStatus === 'SENT'
              ? 'SUCCESS'
              : 'FAILURE',
            ...getAuditRequestContext(request),
            metadata: {
              deliveryStatus: result.deliveryStatus,
              source: 'RESEND',
            },
          },
        )

        return reply.code(200).send({
          user: {
            id: result.userId,
            status: 'INVITED',
          },
          invitation: {
            deliveryStatus: result.deliveryStatus,
          },
        })
      } catch (error: unknown) {
        if (error instanceof InvitationUserNotFoundError) {
          return reply.code(404).send({
            message: 'Invited user not found',
          })
        }

        if (error instanceof InvitationNotResendableError) {
          return reply.code(409).send({
            message: 'Invitation cannot be resent',
          })
        }

        if (error instanceof ForbiddenRoleAssignmentError) {
          return reply.code(403).send({
            message: 'Forbidden',
          })
        }

        throw error
      }
    },
  )
}
