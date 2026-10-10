import { Type } from '@sinclair/typebox'
import type { FastifyInstance } from 'fastify'
import { DrizzleNotificationRepository } from './notification.repository.js'
import {
  configureSubmissionErrors,
  executeSubmission,
  requireSubmissionSession,
  submissionActor,
  submissionOrigin,
} from '../submissions/submission.http.js'
export async function notificationRoutes(
  app: FastifyInstance,
  options: { portal: 'user' | 'admin'; notificationRepository?: DrizzleNotificationRepository },
) {
  const repository = options.notificationRepository ?? new DrizzleNotificationRepository()
  const guards = [requireSubmissionSession(options.portal)]
  configureSubmissionErrors(app)
  app.get<{ Querystring: { cursor?: string; unreadOnly?: boolean } }>(
    '/notifications',
    {
      preHandler: guards,
      schema: {
        querystring: Type.Object(
          {
            cursor: Type.Optional(Type.String({ maxLength: 300 })),
            unreadOnly: Type.Optional(Type.Boolean()),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (request, reply) =>
      executeSubmission(request, reply, () =>
        repository.list(submissionActor(request).userId, options.portal, request.query),
      ),
  )
  app.get('/notifications/unread-count', { preHandler: guards }, async (request, reply) =>
    executeSubmission(request, reply, () =>
      repository.unreadCount(submissionActor(request).userId, options.portal),
    ),
  )
  app.post<{ Params: { id: string } }>(
    '/notifications/:id/read',
    {
      preHandler: [...guards, submissionOrigin],
      schema: {
        params: Type.Object(
          { id: Type.String({ format: 'uuid' }) },
          { additionalProperties: false },
        ),
        body: Type.Object({}, { additionalProperties: false }),
      },
    },
    async (request, reply) =>
      executeSubmission(request, reply, () =>
        repository.read(submissionActor(request).userId, options.portal, request.params.id),
      ),
  )
}
