import { Type } from '@sinclair/typebox'
import type { FastifyInstance } from 'fastify'
import {
  configureSubmissionErrors,
  executeSubmission,
  requireSubmissionSession,
  submissionActor,
  submissionOrigin,
} from '../submissions/submission.http.js'
import { SubmissionError } from '../submissions/submission.types.js'
import type { TrainingExportUseCase } from './training-export.service.js'

export async function trainingExportRoutes(
  app: FastifyInstance,
  options: { trainingExportService: TrainingExportUseCase },
) {
  configureSubmissionErrors(app)
  app.addHook('onRequest', async (_request, reply) => {
    reply.header('Cache-Control', 'private, no-store')
  })
  app.post<{ Params: { id: string } }>(
    '/training-reviews/periods/:id/export.xlsx',
    {
      preHandler: [requireSubmissionSession('user'), submissionOrigin],
      schema: {
        body: Type.Object({}, { additionalProperties: false }),
        params: Type.Object(
          { id: Type.String({ format: 'uuid' }) },
          { additionalProperties: false },
        ),
      },
      preValidation: async (request) => {
        if (
          Object.keys(request.query as object).length ||
          (request.body && typeof request.body === 'object' && Object.keys(request.body).length)
        )
          throw new SubmissionError(
            400,
            'INVALID_TRAINING_EXPORT',
            'Không nhận bộ lọc hoặc định dạng tùy ý khi xuất.',
          )
      },
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    (request, reply) =>
      executeSubmission(request, reply, async () => {
        const file = await options.trainingExportService.downloadXlsx(
          submissionActor(request),
          request.params.id.toLowerCase(),
        )
        reply.header('X-Export-Snapshot-Id', file.snapshotId).header('X-Export-Sha256', file.sha256)
        return reply
          .type(file.mimeType)
          .header(
            'Content-Disposition',
            `attachment; filename="training-points.xlsx"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
          )
          .header('X-Content-Type-Options', 'nosniff')
          .send(file.bytes)
      }),
  )
}
