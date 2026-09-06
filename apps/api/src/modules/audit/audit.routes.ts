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
  requireAdminPermission,
} from '../auth/admin-permission.guard.js'
import type {
  AuthorizationUseCase,
} from '../auth/authorization.service.js'
import type {
  AuditLogUseCase,
} from './audit.service.js'

const listAuditLogsQuerySchema =
  Type.Object(
    {
      limit: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: 100,
          default: 50,
        }),
      ),
      before: Type.Optional(
        Type.String({
          format: 'date-time',
        }),
      ),
      action: Type.Optional(
        Type.String({
          minLength: 1,
          maxLength: 100,
          pattern: '^[A-Z][A-Z0-9_]*$',
        }),
      ),
    },
    { additionalProperties: false },
  )

type ListAuditLogsQuery = Static<
  typeof listAuditLogsQuerySchema
>

const metadataValueSchema = Type.Union([
  Type.String(),
  Type.Number(),
  Type.Boolean(),
  Type.Null(),
  Type.Array(Type.String()),
])

const errorResponseSchema = Type.Object({
  message: Type.String(),
})

const listAuditLogsResponseSchema =
  Type.Object({
    auditLogs: Type.Array(
      Type.Object({
        id: Type.String({ format: 'uuid' }),
        occurredAt: Type.String({
          format: 'date-time',
        }),
        actorType: Type.Union([
          Type.Literal('USER'),
          Type.Literal('ANONYMOUS'),
          Type.Literal('SYSTEM'),
        ]),
        actorUserId: Type.Union([
          Type.String({ format: 'uuid' }),
          Type.Null(),
        ]),
        actorUsername: Type.Union([
          Type.String(),
          Type.Null(),
        ]),
        action: Type.String(),
        resourceType: Type.String(),
        resourceId: Type.Union([
          Type.String(),
          Type.Null(),
        ]),
        outcome: Type.Union([
          Type.Literal('SUCCESS'),
          Type.Literal('FAILURE'),
        ]),
        requestId: Type.Union([
          Type.String(),
          Type.Null(),
        ]),
        ipAddress: Type.Union([
          Type.String(),
          Type.Null(),
        ]),
        userAgent: Type.Union([
          Type.String(),
          Type.Null(),
        ]),
        metadata: Type.Record(
          Type.String(),
          metadataValueSchema,
        ),
        before: Type.Union([
          Type.Record(
            Type.String(),
            metadataValueSchema,
          ),
          Type.Null(),
        ]),
        after: Type.Union([
          Type.Record(
            Type.String(),
            metadataValueSchema,
          ),
          Type.Null(),
        ]),
      }),
    ),
  })

export interface AuditRoutesOptions
extends FastifyPluginOptions {
  auditLogService: AuditLogUseCase
  authorizationService:
    AuthorizationUseCase
}

export async function auditRoutes(
  app: FastifyInstance,
  options: AuditRoutesOptions,
) {
  app.get<{
    Querystring: ListAuditLogsQuery
  }>(
    '/audit-logs',
    {
      preHandler: [
        requireAdminSession,
        requireAdminReadySession,
        requireAdminPermission(
          options.authorizationService,
          'audit.read',
        ),
      ],
      schema: {
        querystring:
          listAuditLogsQuerySchema,
        response: {
          200:
            listAuditLogsResponseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const auditLogs = await options
        .auditLogService
        .listRecent({
          limit: request.query.limit ?? 50,
          ...(
            request.query.before
              ? {
                  before:
                    new Date(
                      request.query.before,
                    ),
                }
              : {}
          ),
          ...(
            request.query.action
              ? {
                  action:
                    request.query.action,
                }
              : {}
          ),
        })

      return {
        auditLogs: auditLogs.map(
          (event) => ({
            ...event,
            occurredAt:
              event.occurredAt
                .toISOString(),
          }),
        ),
      }
    },
  )
}
