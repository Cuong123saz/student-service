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
  requireAdminReadySession,
  requireAdminSession,
} from '../auth/admin-auth.guard.js'
import {
  requireAdminPermission,
} from '../auth/admin-permission.guard.js'
import type {
  AuthorizationUseCase,
} from '../auth/authorization.service.js'
import {
  StudentExportForbiddenError,
  StudentExportRowLimitExceededError,
} from './student-export.repository.js'
import type {
  StudentExportUseCase,
} from './student-export.service.js'

const exportQuerySchema = Type.Object(
  {
    status: Type.Optional(
      Type.Union([
        Type.Literal('INVITED'),
        Type.Literal('ACTIVE'),
        Type.Literal('INACTIVE'),
        Type.Literal('SUSPENDED'),
      ]),
    ),
    facultyId: Type.Optional(
      Type.String({ format: 'uuid' }),
    ),
    classId: Type.Optional(
      Type.String({ format: 'uuid' }),
    ),
    search: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 100,
      }),
    ),
  },
  { additionalProperties: false },
)

type ExportQuery = Static<
  typeof exportQuerySchema
>

const errorResponseSchema = Type.Object({
  message: Type.String(),
})

export interface StudentExportRoutesOptions
extends FastifyPluginOptions {
  studentExportService: StudentExportUseCase
  authorizationService: AuthorizationUseCase
}

export async function studentExportRoutes(
  app: FastifyInstance,
  options: StudentExportRoutesOptions,
) {
  app.get<{
    Querystring: ExportQuery
  }>(
    '/students/export.xlsx',
    {
      preHandler: [
        requireAdminSession,
        requireAdminReadySession,
        requireAdminPermission(
          options.authorizationService,
          'student.export',
        ),
      ],
      schema: {
        querystring: exportQuerySchema,
        response: {
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          413: errorResponseSchema,
        },
      },
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
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
        const file = await options
          .studentExportService
          .exportStudents({
            actorUserId: session.sub,
            actorUsername: session.username,
            audit:
              getAuditRequestContext(request),
            ...(request.query.status
              ? { status: request.query.status }
              : {}),
            ...(request.query.facultyId
              ? {
                  facultyId:
                    request.query.facultyId,
                }
              : {}),
            ...(request.query.classId
              ? {
                  classId:
                    request.query.classId,
                }
              : {}),
            ...(request.query.search
              ? { search: request.query.search }
              : {}),
          })

        return reply
          .type(file.contentType)
          .header(
            'content-disposition',
            `attachment; filename="${file.fileName}"`,
          )
          .header(
            'x-export-row-count',
            String(file.rowCount),
          )
          .send(file.buffer)
      } catch (error) {
        if (
          error instanceof StudentExportForbiddenError
        ) {
          return reply.code(403).send({
            message: 'Forbidden',
          })
        }

        if (
          error
            instanceof StudentExportRowLimitExceededError
        ) {
          return reply.code(413).send({
            message: error.message,
          })
        }

        throw error
      }
    },
  )
}
