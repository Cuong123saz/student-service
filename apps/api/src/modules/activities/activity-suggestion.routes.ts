import { Type } from '@sinclair/typebox'
import type { FastifyInstance } from 'fastify'
import {
  configureSubmissionErrors,
  requireSubmissionSession,
  submissionActor,
  submissionOrigin,
} from '../submissions/submission.http.js'
import { portalExecute, portalInput } from '../shared/portal-input.js'
import type { ActivitySuggestionRepository } from './activity-suggestion.repository.js'

const uuid = Type.String({ format: 'uuid' }),
  params = Type.Object({ id: uuid }, { additionalProperties: false }),
  rev = Type.Integer({ minimum: 0, maximum: 2147483646 })
const { strict, text } = portalInput('INVALID_ACTIVITY')
const execute = portalExecute(
  'ACTIVITY_',
  'ACTIVITY_ATTENDANCE_CONFLICT',
  'Dữ liệu đã thay đổi hoặc thao tác không còn phù hợp. Hãy tải lại.',
)
const noStore = async (_req: unknown, reply: { header: (k: string, v: string) => unknown }) => {
  reply.header('Cache-Control', 'private, no-store')
}

/** ADR 0033 (user portal): suggestions for students and reviewers; organising committee. */
export async function activitySuggestionRoutes(
  app: FastifyInstance,
  options: { suggestionRepository: ActivitySuggestionRepository },
) {
  configureSubmissionErrors(app)
  app.addHook('onRequest', noStore)
  const r = options.suggestionRepository,
    auth = [requireSubmissionSession('user')],
    student = [requireSubmissionSession('user', true)],
    write = [...auth, submissionOrigin],
    limited = { rateLimit: { max: 30, timeWindow: '1 minute' } }
  app.get<{ Params: { id: string } }>(
    '/training-declarations/:id/activity-suggestions',
    { preHandler: student, schema: { params } },
    (req, reply) =>
      execute(req, reply, () =>
        r.forStudent(submissionActor(req).userId, req.params.id.toLowerCase()),
      ),
  )
  app.get<{ Params: { id: string } }>(
    '/training-reviews/:id/activity-suggestions',
    { preHandler: auth, schema: { params } },
    (req, reply) =>
      execute(req, reply, () =>
        r.forReview(submissionActor(req).userId, req.params.id.toLowerCase()),
      ),
  )
  app.get<{ Params: { id: string } }>(
    '/activities/manage/:id/organizers',
    { preHandler: auth, schema: { params } },
    (req, reply) =>
      execute(req, reply, () =>
        r.organizers(submissionActor(req).userId, req.params.id.toLowerCase()),
      ),
  )
  app.post<{ Params: { id: string }; Body: { studentCode: string } }>(
    '/activities/manage/:id/organizers',
    {
      preHandler: write,
      config: limited,
      preValidation: async (req) => strict(req.body, ['studentCode']),
      schema: {
        params,
        body: Type.Object(
          { studentCode: Type.String({ minLength: 1, maxLength: 50 }) },
          { additionalProperties: false },
        ),
      },
    },
    (req, reply) =>
      execute(req, reply, () =>
        r.addOrganizer(
          submissionActor(req),
          req.params.id.toLowerCase(),
          text(req.body.studentCode, 'Mã sinh viên'),
        ),
      ),
  )
  app.post<{ Params: { id: string; organizerId: string } }>(
    '/activities/manage/:id/organizers/:organizerId/remove',
    {
      preHandler: write,
      config: limited,
      preValidation: async (req) => strict(req.body, []),
      schema: {
        params: Type.Object({ id: uuid, organizerId: uuid }, { additionalProperties: false }),
      },
    },
    (req, reply) =>
      execute(req, reply, () =>
        r.removeOrganizer(
          submissionActor(req),
          req.params.id.toLowerCase(),
          req.params.organizerId.toLowerCase(),
        ),
      ),
  )
}

/** ADR 0033 (admin portal): per-period settings, edited by the period managers. */
export async function activitySettingsAdminRoutes(
  app: FastifyInstance,
  options: { suggestionRepository: ActivitySuggestionRepository },
) {
  configureSubmissionErrors(app)
  app.addHook('onRequest', noStore)
  const r = options.suggestionRepository,
    auth = [requireSubmissionSession('admin')]
  app.get<{ Params: { id: string } }>(
    '/training-periods/:id/activity-settings',
    { preHandler: auth, schema: { params } },
    (req, reply) =>
      execute(req, reply, () =>
        r.getSettings(submissionActor(req).userId, req.params.id.toLowerCase()),
      ),
  )
  app.put<{ Params: { id: string }; Body: { expectedRevision: number; settings: unknown } }>(
    '/training-periods/:id/activity-settings',
    {
      preHandler: [...auth, submissionOrigin],
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      preValidation: async (req) => strict(req.body, ['expectedRevision', 'settings']),
      schema: {
        params,
        body: Type.Object(
          { expectedRevision: rev, settings: Type.Object({}, { additionalProperties: true }) },
          { additionalProperties: false },
        ),
      },
    },
    (req, reply) =>
      execute(req, reply, () => {
        const actor = submissionActor(req)
        return r.saveSettings(
          actor.userId,
          req.params.id.toLowerCase(),
          req.body.expectedRevision,
          req.body.settings,
          actor.requestId,
        )
      }),
  )
}
