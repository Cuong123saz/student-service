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
  app.get<{ Params: { id: string; roundNumber: number; format: DocumentFormat } }>(
    (review ? '/review-submissions' : '/submissions') +
      '/:id/rounds/:roundNumber/documents/:format',
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
}
