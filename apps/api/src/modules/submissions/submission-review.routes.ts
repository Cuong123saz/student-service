import { Type } from '@sinclair/typebox'
import type { FastifyInstance } from 'fastify'
import type { ReviewQueueQuery, ResolutionAction } from './submission.types.js'
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
  app.get<{ Querystring: ReviewQueueQuery }>(
    '/review-submissions',
    {
      preHandler: guards,
      preValidation: async (request, reply) => {
        if (
          Object.keys(request.query).some(
            (key) => !['status', 'assignment', 'q', 'cursor'].includes(key),
          )
        )
          return reply.code(400).send({
            code: 'INVALID_FILTER',
            message: 'Tham số bộ lọc không hợp lệ.',
            issues: [],
            requestId: request.id,
          })
      },
      schema: {
        querystring: Type.Object(
          {
            assignment: Type.Optional(
              Type.Union([Type.Literal('ALL'), Type.Literal('MINE'), Type.Literal('UNASSIGNED')]),
            ),
            q: Type.Optional(Type.String({ maxLength: 300 })),
            cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 300 })),
            status: Type.Optional(
              Type.Union([
                Type.Literal('SUBMITTED'),
                Type.Literal('IN_REVIEW'),
                Type.Literal('NEEDS_SUPPLEMENT'),
                Type.Literal('APPROVED'),
                Type.Literal('REJECTED'),
              ]),
            ),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (request, reply) =>
      executeSubmission(request, reply, () =>
        service.reviewList(submissionActor(request).userId, request.query),
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
  app.get<{ Params: { id: string } }>(
    '/review-submissions/:id/assignees',
    { preHandler: guards, schema: { params } },
    async (request, reply) =>
      executeSubmission(request, reply, () =>
        service.assignees(submissionActor(request).userId, request.params.id),
      ),
  )
  app.post<{
    Params: { id: string }
    Body: { expectedRevision: number; reviewerUserId: string; note: unknown }
  }>(
    '/review-submissions/:id/reassign',
    {
      preHandler: [...guards, submissionOrigin],
      schema: {
        params,
        body: Type.Object(
          {
            expectedRevision: Type.Integer({ minimum: 1 }),
            reviewerUserId: Type.String({ format: 'uuid' }),
            note: Type.Unknown(),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (request, reply) =>
      executeSubmission(request, reply, () =>
        service.reassign(
          submissionActor(request),
          request.params.id,
          request.body.expectedRevision,
          request.body.reviewerUserId,
          request.body.note,
        ),
      ),
  )
  app.post<{
    Params: { id: string }
    Body: { expectedRevision: number; action: ResolutionAction; note: string }
  }>(
    '/review-submissions/:id/resolve',
    {
      preHandler: [...guards, submissionOrigin],
      schema: {
        params,
        body: Type.Object(
          {
            expectedRevision: Type.Integer({ minimum: 1 }),
            action: Type.Union([
              Type.Literal('REQUEST_SUPPLEMENT'),
              Type.Literal('APPROVE'),
              Type.Literal('REJECT'),
            ]),
            // Preserve the JSON value; business validation rejects non-text instead of AJV coercion.
            note: Type.Unknown(),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (request, reply) =>
      executeSubmission(request, reply, () =>
        service.resolve(
          submissionActor(request),
          request.params.id,
          request.body.expectedRevision,
          request.body.action,
          request.body.note,
        ),
      ),
  )
  app.get<{ Params: { id: string; roundNumber: number; fileId: string } }>(
    '/review-submissions/:id/rounds/:roundNumber/files/:fileId',
    {
      preHandler: guards,
      schema: {
        params: Type.Object(
          {
            id: Type.String({ format: 'uuid' }),
            roundNumber: Type.Integer({ minimum: 1 }),
            fileId: Type.String({ format: 'uuid' }),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (request, reply) =>
      executeSubmission(request, reply, async () =>
        sendEvidence(
          reply,
          await service.reviewRoundDownload(
            submissionActor(request).userId,
            request.params.id,
            request.params.roundNumber,
            request.params.fileId,
          ),
        ),
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
