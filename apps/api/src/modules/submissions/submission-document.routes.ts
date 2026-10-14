import { registerMockSigningRoutes } from '../signatures/mock-signing.routes.js'
import { Type } from '@sinclair/typebox'
import type { FastifyInstance } from 'fastify'
import type { SubmissionService } from './submission.service.js'
import type { DocumentRetryInput } from './submission-document-operations.js'
import { SubmissionError } from './submission.types.js'
import type { DocumentFormat } from './submission-document.js'
import {
  executeSubmission,
  requireSubmissionSession,
  sendEvidence,
  submissionActor,
  submissionOrigin,
} from './submission.http.js'
export function registerSubmissionDocumentRoute(
  app: FastifyInstance,
  service: SubmissionService,
  portal: 'user' | 'admin',
  review: boolean,
) {
  registerMockSigningRoutes(app, service, portal, review)
  const base = (review ? '/review-submissions' : '/submissions') + '/:id/rounds/:roundNumber'
  const roundParams = Type.Object(
    {
      id: Type.String({ format: 'uuid' }),
      roundNumber: Type.Integer({ minimum: 1, maximum: 2147483647 }),
    },
    { additionalProperties: false },
  )
  app.get<{ Params: { id: string; roundNumber: number } }>(
    base + '/document-status',
    {
      preHandler: [requireSubmissionSession(portal, !review)],
      schema: { params: roundParams },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (request, reply) =>
      executeSubmission(request, reply, async () => {
        reply.header('Cache-Control', 'no-store')
        return service.documentStatus(
          submissionActor(request).userId,
          request.params.id,
          request.params.roundNumber,
          review,
        )
      }),
  )
  if (review)
    app.post<{
      Params: { id: string; roundNumber: number; format: 'docx' | 'pdf' }
      Body: DocumentRetryInput
    }>(
      base + '/documents/:format/retry',
      {
        preHandler: [requireSubmissionSession(portal), submissionOrigin],
        config: { rateLimit: { max: 3, timeWindow: '1 minute' } },
        preValidation: async (request) => {
          if (
            request.body &&
            typeof request.body === 'object' &&
            Object.keys(request.body).some(
              (key) => !['requestId', 'expectedAttemptId', 'reasonCode'].includes(key),
            )
          )
            throw new SubmissionError(
              400,
              'INVALID_RETRY_INPUT',
              'Thông tin mở lượt có trường không hợp lệ.',
            )
        },
        schema: {
          params: Type.Object(
            {
              id: Type.String({ format: 'uuid' }),
              roundNumber: Type.Integer({ minimum: 1, maximum: 2147483647 }),
              format: Type.Union([Type.Literal('docx'), Type.Literal('pdf')]),
            },
            { additionalProperties: false },
          ),
          body: Type.Object(
            {
              requestId: Type.String({ format: 'uuid' }),
              expectedAttemptId: Type.String({ format: 'uuid' }),
              reasonCode: Type.Union([
                Type.Literal('RENDERER_FIXED'),
                Type.Literal('CONVERTER_FIXED'),
                Type.Literal('STORAGE_FIXED'),
                Type.Literal('WORKER_RESTARTED'),
              ]),
            },
            { additionalProperties: false },
          ),
        },
      },
      async (request, reply) =>
        executeSubmission(request, reply, async () => {
          reply.header('Cache-Control', 'no-store')
          return service.retryDocument(
            submissionActor(request),
            request.params.id,
            request.params.roundNumber,
            request.params.format,
            request.body,
          )
        }),
    )
  app.get<{ Params: { id: string; roundNumber: number; format: DocumentFormat } }>(
    base + '/documents/:format',
    {
      preHandler: [requireSubmissionSession(portal, !review)],
      config: { rateLimit: { max: 12, timeWindow: '1 minute' } },
      schema: {
        params: Type.Object(
          {
            id: Type.String({ format: 'uuid' }),
            roundNumber: Type.Integer({ minimum: 1, maximum: 2147483647 }),
            format: Type.Union([Type.Literal('docx'), Type.Literal('pdf')]),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (request, reply) =>
      executeSubmission(request, reply, async () =>
        sendEvidence(
          reply,
          await service.documentDownload(
            submissionActor(request).userId,
            request.params.id,
            request.params.roundNumber,
            request.params.format,
            review,
          ),
        ),
      ),
  )
  app.get<{ Params: { id: string; roundNumber: number } }>(
    base + '/bundle',
    {
      preHandler: [requireSubmissionSession(portal, !review)],
      config: { rateLimit: { max: 6, timeWindow: '1 minute' } },
      schema: {
        params: Type.Object(
          {
            id: Type.String({ format: 'uuid' }),
            roundNumber: Type.Integer({ minimum: 1, maximum: 2147483647 }),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (request, reply) =>
      executeSubmission(request, reply, async () =>
        sendEvidence(
          reply,
          await service.bundleDownload(
            submissionActor(request).userId,
            request.params.id,
            request.params.roundNumber,
            review,
          ),
        ),
      ),
  )
}
