import { Type } from '@sinclair/typebox'
import type { FastifyInstance } from 'fastify'
import type { SubmissionService } from './submission.service.js'
import {
  configureSubmissionErrors,
  executeSubmission,
  requireSubmissionSession,
  sendEvidence,
  submissionActor,
  submissionOrigin,
} from './submission.http.js'
export async function submissionReviewRoutes(
  app: FastifyInstance,
  options: { submissionService: SubmissionService; portal: 'user' | 'admin' },
) {
  const service = options.submissionService
  const guards = [requireSubmissionSession(options.portal)]
  const params = Type.Object(
    { id: Type.String({ format: 'uuid' }) },
    { additionalProperties: false },
  )
  configureSubmissionErrors(app)
  app.get<{ Querystring: { status?: 'SUBMITTED' | 'IN_REVIEW' } }>(
    '/review-submissions',
    {
      preHandler: guards,
      schema: {
        querystring: Type.Object(
          {
            status: Type.Optional(
              Type.Union([Type.Literal('SUBMITTED'), Type.Literal('IN_REVIEW')]),
            ),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (request, reply) =>
      executeSubmission(request, reply, () =>
        service.reviewList(submissionActor(request).userId, request.query.status),
      ),
  )
  app.get<{ Params: { id: string } }>(
    '/review-submissions/:id',
    { preHandler: guards, schema: { params } },
    async (request, reply) =>
      executeSubmission(request, reply, () =>
        service.reviewGet(submissionActor(request).userId, request.params.id),
      ),
  )
  app.post<{ Params: { id: string }; Body: { expectedRevision: number } }>(
    '/review-submissions/:id/claim',
    {
      preHandler: [...guards, submissionOrigin],
      schema: {
        params,
        body: Type.Object(
          { expectedRevision: Type.Integer({ minimum: 1 }) },
          { additionalProperties: false },
        ),
      },
    },
    async (request, reply) =>
      executeSubmission(request, reply, () =>
        service.claim(submissionActor(request), request.params.id, request.body.expectedRevision),
      ),
  )
  app.get<{ Params: { id: string; fileId: string } }>(
    '/review-submissions/:id/files/:fileId',
    {
      preHandler: guards,
      schema: {
        params: Type.Object(
          { id: Type.String({ format: 'uuid' }), fileId: Type.String({ format: 'uuid' }) },
          { additionalProperties: false },
        ),
      },
    },
    async (request, reply) =>
      executeSubmission(request, reply, async () =>
        sendEvidence(
          reply,
          await service.reviewDownload(
            submissionActor(request).userId,
            request.params.id,
            request.params.fileId,
          ),
        ),
      ),
  )
}
