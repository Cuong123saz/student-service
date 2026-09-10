import { type Static, Type } from '@sinclair/typebox'
import type { FastifyInstance, FastifyPluginOptions, FastifyRequest } from 'fastify'

import { getAuditRequestContext } from '../audit/audit-request-context.js'
import { requireAdminReadySession, requireAdminSession } from '../auth/admin-auth.guard.js'
import { requireAdminPermission } from '../auth/admin-permission.guard.js'
import type { AuthorizationUseCase } from '../auth/authorization.service.js'
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
import type { StudentImportProcessingJobUseCase } from './student-import-processing-job.service.js'
import { createStudentImportTemplateWorkbook, XLSX_CONTENT_TYPE } from './student-export.xlsx.js'

const studentImportErrorCodeSchema = Type.Union([
  Type.Literal('IMPORT_MULTIPART_REQUIRED'),
  Type.Literal('IMPORT_FILE_REQUIRED'),
  Type.Literal('IMPORT_FILENAME_INVALID'),
  Type.Literal('IMPORT_FILE_LIMIT_EXCEEDED'),
  Type.Literal('IMPORT_UPLOAD_BUSY'),
  Type.Literal('IMPORT_FILE_UNSUPPORTED'),
  Type.Literal('IMPORT_FILE_PARSE_FAILED'),
  Type.Literal('IMPORT_MISSING_COLUMNS'),
  Type.Literal('IMPORT_FORBIDDEN'),
  Type.Literal('IMPORT_PREVIEW_NOT_FOUND'),
  Type.Literal('IMPORT_VALIDATION_BLOCKED'),
  Type.Literal('IMPORT_DUPLICATE_BLOCKED'),
  Type.Literal('IMPORT_AMBIGUOUS_DUPLICATE'),
  Type.Literal('IMPORT_COMMIT_CONFLICT'),
])

type StudentImportErrorCode = Static<typeof studentImportErrorCodeSchema>

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
  source: Type.Union([Type.Literal('FILE'), Type.Literal('SYSTEM')]),
  field: Type.Union([Type.Literal('studentCode'), Type.Literal('email')]),
  matchedSourceRow: Type.Optional(Type.Integer()),
  code: Type.String(),
  message: Type.String(),
})
const importErrorCellSchema = Type.Object({
  kind: Type.Union([
    Type.Literal('EMPTY'),
    Type.Literal('TEXT'),
    Type.Literal('NUMBER'),
    Type.Literal('BOOLEAN'),
    Type.Literal('DATE'),
  ]),

  text: Type.Union([Type.String(), Type.Null()]),
})

const importErrorValuesSchema = Type.Object({
  studentCode: importErrorCellSchema,
  fullName: importErrorCellSchema,
  email: importErrorCellSchema,
  classCode: importErrorCellSchema,
})

const previewResponseSchema = Type.Object({
  previewId: Type.String({ format: 'uuid' }),
  expiresAt: Type.String({ format: 'date-time' }),
  file: Type.Object({
    name: Type.String(),
    format: Type.Union([Type.Literal('CSV'), Type.Literal('XLSX')]),
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
      values: importErrorValuesSchema,
      issues: Type.Array(issueSchema),
    }),
  ),
  duplicateRecords: Type.Array(
    Type.Object({
      record: recordSchema,
      duplicates: Type.Array(duplicateReasonSchema),
    }),
  ),
})

const importJobStatusSchema = Type.Object({
  jobId: Type.String({ format: 'uuid' }),
  status: Type.Union([
    Type.Literal('PENDING'),
    Type.Literal('PROCESSING'),
    Type.Literal('SUCCEEDED'),
    Type.Literal('FAILED'),
  ]),
  errorCode: Type.Union([Type.String(), Type.Null()]),
  preview: Type.Union([previewResponseSchema, Type.Null()]),
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

type ConfirmParams = Static<typeof confirmParamsSchema>
type ConfirmBody = Static<typeof confirmBodySchema>

const commitResponseSchema = Type.Object({
  imported: Type.Integer(),
  updated: Type.Integer(),
  skipped: Type.Integer(),
})

const importErrorResponseSchema = Type.Object({
  message: Type.String(),

  // Optional để các guard dùng chung hiện vẫn có thể
  // trả response cũ: { message: 'Forbidden' }.
  error: Type.Optional(
    Type.Object({
      code: studentImportErrorCodeSchema,
      requestId: Type.String(),
    }),
  ),
})

function createImportError(request: FastifyRequest, code: StudentImportErrorCode, message: string) {
  return {
    message,
    error: {
      code,
      requestId: request.id,
    },
  }
}
function isPayloadTooLarge(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'statusCode' in error && error.statusCode === 413
  )
}

export interface StudentImportRoutesOptions extends FastifyPluginOptions {
  studentImportService: StudentImportUseCase
  studentImportProcessingJobService: StudentImportProcessingJobUseCase
  authorizationService: AuthorizationUseCase
}

const MAX_CONCURRENT_IMPORT_UPLOADS = 2
let activeImportUploads = 0

async function readImportUpload(
  stream: NodeJS.ReadableStream & {
    truncated?: boolean
  },
): Promise<Buffer> {
  const chunks: Buffer[] = []
  let total = 0

  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk)
      ? chunk
      : typeof chunk === 'string'
        ? Buffer.from(chunk)
        : Buffer.from(chunk as Uint8Array)
    total += buffer.byteLength
    if (total > STUDENT_IMPORT_MAX_FILE_BYTES) {
      throw Object.assign(new Error('Import file is too large'), {
        statusCode: 413,
      })
    }
    chunks.push(buffer)
  }

  if (stream.truncated) {
    throw Object.assign(new Error('Import file is too large'), {
      statusCode: 413,
    })
  }

  return Buffer.concat(chunks, total)
}

export async function studentImportRoutes(
  app: FastifyInstance,
  options: StudentImportRoutesOptions,
) {
  const guards = [
    requireAdminSession,
    requireAdminReadySession,
    requireAdminPermission(options.authorizationService, 'student.import'),
  ]

  app.get(
    '/students/import-template.xlsx',
    {
      preHandler: guards,
      schema: {
        response: {
          401: Type.Object({ message: Type.String() }),
          403: Type.Object({ message: Type.String() }),
        },
      },
    },
    async (request, reply) => {
      if (!request.adminSession) {
        return reply.code(401).send({ message: 'Unauthorized' })
      }

      return reply
        .type(XLSX_CONTENT_TYPE)
        .header('content-disposition', 'attachment; filename="mau-import-sinh-vien.xlsx"')
        .send(createStudentImportTemplateWorkbook())
    },
  )

  app.post(
    '/students/imports/preview',
    {
      preHandler: guards,
      schema: {
        response: {
          202: Type.Object({
            jobId: Type.String({ format: 'uuid' }),
            status: Type.Literal('PENDING'),
          }),
          400: importErrorResponseSchema,
          401: importErrorResponseSchema,
          403: importErrorResponseSchema,
          413: importErrorResponseSchema,
          429: importErrorResponseSchema,
          503: importErrorResponseSchema,
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
        return reply
          .code(400)
          .send(
            createImportError(
              request,
              'IMPORT_MULTIPART_REQUIRED',
              'A multipart file upload is required',
            ),
          )
      }

      if (activeImportUploads >= MAX_CONCURRENT_IMPORT_UPLOADS) {
        return reply
          .code(503)
          .send(
            createImportError(
              request,
              'IMPORT_UPLOAD_BUSY',
              'Import upload capacity is temporarily full',
            ),
          )
      }

      activeImportUploads += 1

      try {
        const file = await request.file({
          limits: {
            files: 1,
            parts: 1,
            fileSize: STUDENT_IMPORT_MAX_FILE_BYTES,
          },
        })

        if (!file) {
          return reply
            .code(400)
            .send(createImportError(request, 'IMPORT_FILE_REQUIRED', 'Import file is required'))
        }

        if (file.filename.length > 255) {
          return reply
            .code(400)
            .send(createImportError(request, 'IMPORT_FILENAME_INVALID', 'File name is too long'))
        }

        const fileBuffer = await readImportUpload(file.file)
        if (fileBuffer.byteLength === 0) {
          return reply
            .code(400)
            .send(createImportError(request, 'IMPORT_FILE_REQUIRED', 'Import file is empty'))
        }
        const { jobId } = await options.studentImportProcessingJobService.enqueue({
          actorUserId: session.sub,
          fileName: file.filename,
          mediaType: file.mimetype,
          content: fileBuffer,
        })

        return reply.code(202).send({
          jobId,
          status: 'PENDING' as const,
        })
      } catch (error) {
        if (error instanceof StudentImportRowLimitError || isPayloadTooLarge(error)) {
          return reply
            .code(413)
            .send(
              createImportError(
                request,
                'IMPORT_FILE_LIMIT_EXCEEDED',
                error instanceof StudentImportRowLimitError
                  ? error.message
                  : 'Import file is too large',
              ),
            )
        }

        if (error instanceof UnsupportedStudentImportFileError) {
          return reply
            .code(400)
            .send(createImportError(request, 'IMPORT_FILE_UNSUPPORTED', error.message))
        }

        if (error instanceof StudentImportFileParseError) {
          return reply
            .code(400)
            .send(createImportError(request, 'IMPORT_FILE_PARSE_FAILED', error.message))
        }

        if (error instanceof StudentImportMissingColumnsError) {
          return reply
            .code(400)
            .send(createImportError(request, 'IMPORT_MISSING_COLUMNS', error.message))
        }

        if (error instanceof StudentImportForbiddenError) {
          return reply.code(403).send(createImportError(request, 'IMPORT_FORBIDDEN', 'Forbidden'))
        }

        throw error
      } finally {
        activeImportUploads -= 1
      }
    },
  )

  app.get<{
    Params: { jobId: string }
  }>(
    '/students/imports/jobs/:jobId',
    {
      preHandler: guards,
      schema: {
        params: Type.Object({
          jobId: Type.String({ format: 'uuid' }),
        }),
        response: {
          200: importJobStatusSchema,
          401: importErrorResponseSchema,
          403: importErrorResponseSchema,
          404: importErrorResponseSchema,
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

      const job = await options.studentImportProcessingJobService.getStatus(
        request.params.jobId,
        session.sub,
      )

      if (!job) {
        return reply
          .code(404)
          .send(
            createImportError(
              request,
              'IMPORT_PREVIEW_NOT_FOUND',
              'Import job was not found or has expired',
            ),
          )
      }

      return reply.code(200).send({
        jobId: job.id,
        status: job.status,
        errorCode: job.errorCode,
        preview: job.preview,
      })
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
          400: importErrorResponseSchema,
          401: importErrorResponseSchema,
          403: importErrorResponseSchema,
          404: importErrorResponseSchema,
          409: importErrorResponseSchema,
          422: importErrorResponseSchema,
          429: importErrorResponseSchema,
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
        const result = await options.studentImportService.confirmImport({
          actorUserId: session.sub,
          actorUsername: session.username,
          previewId: request.params.previewId,
          duplicateStrategy: request.body.duplicateStrategy,
          audit: getAuditRequestContext(request),
        })

        return reply.code(200).send(result)
      } catch (error) {
        if (error instanceof StudentImportPreviewNotFoundError) {
          return reply
            .code(404)
            .send(createImportError(request, 'IMPORT_PREVIEW_NOT_FOUND', error.message))
        }

        if (error instanceof StudentImportValidationBlockedError) {
          return reply
            .code(422)
            .send(createImportError(request, 'IMPORT_VALIDATION_BLOCKED', error.message))
        }

        if (error instanceof StudentImportDuplicateBlockedError) {
          return reply
            .code(409)
            .send(createImportError(request, 'IMPORT_DUPLICATE_BLOCKED', error.message))
        }

        if (error instanceof StudentImportAmbiguousDuplicateError) {
          return reply
            .code(409)
            .send(createImportError(request, 'IMPORT_AMBIGUOUS_DUPLICATE', error.message))
        }

        if (error instanceof StudentImportCommitConflictError) {
          return reply
            .code(409)
            .send(createImportError(request, 'IMPORT_COMMIT_CONFLICT', error.message))
        }

        if (error instanceof StudentImportForbiddenError) {
          return reply.code(403).send(createImportError(request, 'IMPORT_FORBIDDEN', 'Forbidden'))
        }

        if (error instanceof StudentImportConfigurationError) {
          throw error
        }

        throw error
      }
    },
  )
}
