import { Type } from '@sinclair/typebox'
import type { FastifyInstance } from 'fastify'
import type { SubmissionService } from './submission.service.js'
import { SubmissionError, type DraftValues } from './submission.types.js'
import {
  configureSubmissionErrors,
  executeSubmission as execute,
  requireSubmissionSession,
  submissionActor as actor,
  submissionOrigin as origin,
  sendEvidence,
} from './submission.http.js'
import { MAX_FILE_BYTES } from './submission.validation.js'
const uuid = Type.String({ format: 'uuid' })
const params = Type.Object({ id: uuid }, { additionalProperties: false })
const revisionQuery = Type.Object(
  { revision: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false },
)
export async function submissionRoutes(
  app: FastifyInstance,
  options: { submissionService: SubmissionService },
) {
  const service = options.submissionService
  configureSubmissionErrors(app)
  const guards = [requireSubmissionSession('user', true)]
  const writeGuards = [...guards, origin]
  let activeUploads = 0
  app.get('/submissions', { preHandler: guards }, async (request, reply) =>
    execute(request, reply, () => service.list(actor(request).userId)),
  )
  app.post<{ Body: { serviceId: number; versionId: string } }>(
    '/submissions',
    {
      preHandler: writeGuards,
      schema: {
        body: Type.Object(
          { serviceId: Type.Integer({ minimum: 1 }), versionId: uuid },
          { additionalProperties: false },
        ),
      },
    },
    async (request, reply) =>
      execute(request, reply, () =>
        service.create(actor(request), request.body.serviceId, request.body.versionId),
      ),
  )
  app.get<{ Params: { id: string } }>(
    '/submissions/:id',
    { preHandler: guards, schema: { params } },
    async (request, reply) =>
      execute(request, reply, () => service.get(actor(request).userId, request.params.id)),
  )
  app.put<{ Params: { id: string }; Body: { expectedRevision: number; values: DraftValues } }>(
    '/submissions/:id',
    {
      preHandler: writeGuards,
      bodyLimit: 1024 * 1024,
      schema: {
        params,
        body: Type.Object(
          {
            expectedRevision: Type.Integer({ minimum: 1 }),
            values: Type.Record(
              Type.String({ maxLength: 64 }),
              // Preserve JSON primitives; AJV coercion of a union would turn false/0 into strings.
              Type.Unknown(),
              { maxProperties: 50 },
            ),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (request, reply) =>
      execute(request, reply, () =>
        service.save(
          actor(request),
          request.params.id,
          request.body.expectedRevision,
          request.body.values,
        ),
      ),
  )
  app.post<{ Params: { id: string }; Body: { expectedRevision: number } }>(
    '/submissions/:id/submit',
    {
      preHandler: writeGuards,
      schema: {
        params,
        body: Type.Object(
          { expectedRevision: Type.Integer({ minimum: 1 }) },
          { additionalProperties: false },
        ),
      },
    },
    async (request, reply) =>
      execute(request, reply, () =>
        service.submit(actor(request), request.params.id, request.body.expectedRevision),
      ),
  )
  app.post<{ Params: { id: string; key: string }; Querystring: { revision: number } }>(
    '/submissions/:id/attachments/:key',
    {
      preHandler: writeGuards,
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        params: Type.Object(
          { id: uuid, key: Type.String({ pattern: '^[a-z][a-zA-Z0-9_]*$', maxLength: 64 }) },
          { additionalProperties: false },
        ),
        querystring: revisionQuery,
      },
    },
    async (request, reply) =>
      execute(request, reply, async () => {
        await service.get(actor(request).userId, request.params.id)
        if (activeUploads >= 4)
          throw new SubmissionError(
            503,
            'UPLOAD_BUSY',
            'Máy chủ đang nhận nhiều tệp. Vui lòng thử lại sau.',
          )
        activeUploads++
        try {
          let upload: { bytes: Buffer; name: string; mime: string } | null = null
          try {
            for await (const part of request.parts({
              limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 0, parts: 1 },
            })) {
              if (part.type !== 'file' || part.fieldname !== 'file')
                throw new SubmissionError(422, 'FILE_REQUIRED', 'Chọn đúng một tệp minh chứng.')
              upload = { bytes: await part.toBuffer(), name: part.filename, mime: part.mimetype }
            }
          } catch (error) {
            if (error instanceof SubmissionError) throw error
            const code = (error as { code?: string }).code
            if (
              [
                'FST_REQ_FILE_TOO_LARGE',
                'FST_FILES_LIMIT',
                'FST_FIELDS_LIMIT',
                'FST_PARTS_LIMIT',
              ].includes(code ?? '')
            )
              throw new SubmissionError(
                413,
                'MULTIPART_LIMIT',
                'Mỗi lần chỉ nhận một tệp không vượt quá 5 MiB.',
              )
            throw new SubmissionError(422, 'FILE_REQUIRED', 'Không đọc được tệp minh chứng.')
          }
          if (!upload) throw new SubmissionError(422, 'FILE_REQUIRED', 'Chọn một tệp minh chứng.')
          return await service.upload(
            actor(request),
            request.params.id,
            request.query.revision,
            request.params.key,
            upload.bytes,
            upload.name,
            upload.mime,
          )
        } finally {
          activeUploads--
        }
      }),
  )
  app.delete<{ Params: { id: string; fileId: string }; Querystring: { revision: number } }>(
    '/submissions/:id/files/:fileId',
    {
      preHandler: writeGuards,
      schema: {
        params: Type.Object({ id: uuid, fileId: uuid }, { additionalProperties: false }),
        querystring: revisionQuery,
      },
    },
    async (request, reply) =>
      execute(request, reply, () =>
        service.remove(
          actor(request),
          request.params.id,
          request.query.revision,
          request.params.fileId,
        ),
      ),
  )
  app.get<{ Params: { id: string; roundNumber: number; fileId: string } }>(
    '/submissions/:id/rounds/:roundNumber/files/:fileId',
    {
      preHandler: guards,
      schema: {
        params: Type.Object(
          { id: uuid, roundNumber: Type.Integer({ minimum: 1 }), fileId: uuid },
          { additionalProperties: false },
        ),
      },
    },
    async (request, reply) =>
      execute(request, reply, async () =>
        sendEvidence(
          reply,
          await service.roundDownload(
            actor(request).userId,
            request.params.id,
            request.params.roundNumber,
            request.params.fileId,
          ),
        ),
      ),
  )
  app.get<{ Params: { id: string; fileId: string } }>(
    '/submissions/:id/files/:fileId',
    {
      preHandler: guards,
      schema: { params: Type.Object({ id: uuid, fileId: uuid }, { additionalProperties: false }) },
    },
    async (request, reply) =>
      execute(request, reply, async () => {
        const file = await service.download(
          actor(request).userId,
          request.params.id,
          request.params.fileId,
        )
        return sendEvidence(reply, file)
      }),
  )
}
