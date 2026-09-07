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
  STUDENT_IMPORT_MAX_FILE_BYTES,
  StudentImportFileParseError,
  StudentImportMissingColumnsError,
  StudentImportRowLimitError,
  UnsupportedStudentImportFileError,
} from './student-import.parser.js'
import {
  StudentImportAmbiguousDuplicateError,
  StudentImportDuplicateBlockedError,
  StudentImportPreviewNotFoundError,
  StudentImportValidationBlockedError,
  type StudentImportUseCase,
} from './student-import.service.js'
import {
  StudentImportCommitConflictError,
  StudentImportConfigurationError,
  StudentImportForbiddenError,
} from './student-import.repository.js'

const issueSchema = Type.Object({
  field: Type.String(),
  code: Type.String(),
  message: Type.String(),
})

const recordSchema = Type.Object({
  sourceRow: Type.Integer(),
  studentCode: Type.String(),
  username: Type.String(),
  fullName: Type.String(),
  email: Type.String(),
  classCode: Type.String(),
})

const duplicateReasonSchema = Type.Object({
  source: Type.Union([
    Type.Literal('FILE'),
    Type.Literal('SYSTEM'),
  ]),
  field: Type.Union([
    Type.Literal('studentCode'),
    Type.Literal('email'),
  ]),
  matchedSourceRow:
    Type.Optional(Type.Integer()),
  code: Type.String(),
  message: Type.String(),
})

const previewResponseSchema = Type.Object({
  previewId: Type.String({ format: 'uuid' }),
  expiresAt: Type.String({ format: 'date-time' }),
  file: Type.Object({
    name: Type.String(),
    format: Type.Union([
      Type.Literal('CSV'),
      Type.Literal('XLSX'),
    ]),
  }),
  summary: Type.Object({
    total: Type.Integer(),
    valid: Type.Integer(),
    errors: Type.Integer(),
    duplicates: Type.Integer(),
  }),
  validRecords: Type.Array(recordSchema),
  errorRecords: Type.Array(
    Type.Object({
      sourceRow: Type.Integer(),
      issues: Type.Array(issueSchema),
    }),
  ),
  duplicateRecords: Type.Array(
    Type.Object({
      record: recordSchema,
      duplicates:
        Type.Array(duplicateReasonSchema),
    }),
  ),
})

const confirmParamsSchema = Type.Object({
  previewId: Type.String({ format: 'uuid' }),
})

const confirmBodySchema = Type.Object(
  {
    duplicateStrategy: Type.Union([
      Type.Literal('SKIP'),
      Type.Literal('OVERWRITE'),
      Type.Literal('FAIL'),
    ]),
  },
  { additionalProperties: false },
)

type ConfirmParams = Static<
  typeof confirmParamsSchema
>
type ConfirmBody = Static<
  typeof confirmBodySchema
>

const commitResponseSchema = Type.Object({
  imported: Type.Integer(),
  updated: Type.Integer(),
  skipped: Type.Integer(),
})

const errorResponseSchema = Type.Object({
  message: Type.String(),
})

function isPayloadTooLarge(error: unknown): boolean {
  return (
    typeof error === 'object'
    && error !== null
    && 'statusCode' in error
    && error.statusCode === 413
  )
}

export interface StudentImportRoutesOptions
extends FastifyPluginOptions {
  studentImportService: StudentImportUseCase
  authorizationService: AuthorizationUseCase
}

export async function studentImportRoutes(
  app: FastifyInstance,
  options: StudentImportRoutesOptions,
) {
  const guards = [
    requireAdminSession,
    requireAdminReadySession,
    requireAdminPermission(
      options.authorizationService,
      'student.import',
    ),
  ]

  app.post(
    '/students/imports/preview',
    {
      preHandler: guards,
      schema: {
        response: {
          200: previewResponseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          413: errorResponseSchema,
          429: errorResponseSchema,
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

      if (!request.isMultipart()) {
        return reply.code(400).send({
          message: 'A multipart file upload is required',
        })
      }

      try {
        const file = await request.file({
          limits: {
            files: 1,
            parts: 1,
            fileSize:
              STUDENT_IMPORT_MAX_FILE_BYTES,
          },
        })

        if (!file) {
          return reply.code(400).send({
            message: 'Import file is required',
          })
        }

        if (file.filename.length > 255) {
          return reply.code(400).send({
            message: 'File name is too long',
          })
        }

        const fileBuffer = await file.toBuffer()
        const preview = await options
          .studentImportService
          .previewImport({
            actorUserId: session.sub,
            fileName: file.filename,
            fileBuffer,
          })

        return reply.code(200).send(preview)
      } catch (error) {
        if (
          error instanceof StudentImportRowLimitError
          || isPayloadTooLarge(error)
        ) {
          return reply.code(413).send({
            message:
              error instanceof Error
                ? error.message
                : 'Import file is too large',
          })
        }

        if (
          error instanceof UnsupportedStudentImportFileError
          || error instanceof StudentImportFileParseError
          || error instanceof StudentImportMissingColumnsError
        ) {
          return reply.code(400).send({
            message: error.message,
          })
        }

        if (error instanceof StudentImportForbiddenError) {
          return reply.code(403).send({
            message: 'Forbidden',
          })
        }

        throw error
      }
    },
  )

  app.post<{
    Params: ConfirmParams
    Body: ConfirmBody
  }>(
    '/students/imports/:previewId/confirm',
    {
      preHandler: guards,
      schema: {
        params: confirmParamsSchema,
        body: confirmBodySchema,
        response: {
          200: commitResponseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
          422: errorResponseSchema,
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
      const session = request.adminSession

      if (!session) {
        return reply.code(401).send({
          message: 'Unauthorized',
        })
      }

      try {
        const result = await options
          .studentImportService
          .confirmImport({
            actorUserId: session.sub,
            actorUsername: session.username,
            previewId:
              request.params.previewId,
            duplicateStrategy:
              request.body.duplicateStrategy,
            audit:
              getAuditRequestContext(request),
          })

        return reply.code(200).send(result)
      } catch (error) {
        if (
          error
            instanceof StudentImportPreviewNotFoundError
        ) {
          return reply.code(404).send({
            message: error.message,
          })
        }

        if (
          error
            instanceof StudentImportValidationBlockedError
        ) {
          return reply.code(422).send({
            message: error.message,
          })
        }

        if (
          error
            instanceof StudentImportDuplicateBlockedError
          || error
            instanceof StudentImportAmbiguousDuplicateError
          || error
            instanceof StudentImportCommitConflictError
        ) {
          return reply.code(409).send({
            message: error.message,
          })
        }

        if (error instanceof StudentImportForbiddenError) {
          return reply.code(403).send({
            message: 'Forbidden',
          })
        }

        if (
          error
            instanceof StudentImportConfigurationError
        ) {
          throw error
        }

        throw error
      }
    },
  )
}
