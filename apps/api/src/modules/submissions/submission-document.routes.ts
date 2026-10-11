import { Type } from '@sinclair/typebox'
import type { FastifyInstance } from 'fastify'
import type { SubmissionService } from './submission.service.js'
import type { DocumentFormat } from './submission-document.js'
import {
  executeSubmission,
  requireSubmissionSession,
  sendEvidence,
  submissionActor,
} from './submission.http.js'
export function registerSubmissionDocumentRoute(
  app: FastifyInstance,
  service: SubmissionService,
  portal: 'user' | 'admin',
  review: boolean,
) {
  const base = (review ? '/review-submissions' : '/submissions') + '/:id/rounds/:roundNumber'
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
