import { Type } from '@sinclair/typebox'
import type { FastifyInstance } from 'fastify'
import {
  configureSubmissionErrors,
  requireSubmissionSession,
  submissionActor,
  submissionOrigin,
} from '../submissions/submission.http.js'
import { portalExecute, portalInput } from '../shared/portal-input.js'
import { ClubRepository } from './club.repository.js'
import { clubCodePattern, clubStatuses, type ClubStatus } from './club.types.js'

const uuid = Type.String({ format: 'uuid' }),
  params = Type.Object({ id: uuid }, { additionalProperties: false }),
  rev = Type.Integer({ minimum: 0, maximum: 2147483646 }),
  name = Type.String({ minLength: 1, maxLength: 255 }),
  description = Type.String({ maxLength: 2000 }),
  reason = Type.String({ minLength: 1, maxLength: 500 })
const { invalid, strict, text } = portalInput('INVALID_CLUB')
const execute = portalExecute(
  'CLUB_',
  'CLUB_CONFLICT',
  'CLB đã thay đổi hoặc thao tác không còn phù hợp. Hãy tải lại.',
)

/** ADR 0029: club management in the user portal (CTSV), read access for Phòng ĐT and leaders. */
export async function clubRoutes(
  app: FastifyInstance,
  options: { clubRepository: ClubRepository },
) {
  configureSubmissionErrors(app)
  app.addHook('onRequest', async (_req, reply) => {
    reply.header('Cache-Control', 'private, no-store')
  })
  const r = options.clubRepository,
    auth = [requireSubmissionSession('user')],
    write = [...auth, submissionOrigin],
    limited = { rateLimit: { max: 30, timeWindow: '1 minute' } }
  app.get('/clubs', { preHandler: auth }, (req, reply) =>
    execute(req, reply, () => r.list(submissionActor(req).userId)),
  )
  app.get<{ Params: { id: string } }>(
    '/clubs/:id',
    { preHandler: auth, schema: { params } },
    (req, reply) =>
      execute(req, reply, () => r.detail(submissionActor(req).userId, req.params.id.toLowerCase())),
  )
  app.post<{ Body: { code: string; name: string; description?: string } }>(
    '/clubs',
    {
      preHandler: write,
      config: limited,
      preValidation: async (req) => strict(req.body, ['code', 'name', 'description']),
      schema: {
        body: Type.Object(
          {
            code: Type.String({ minLength: 2, maxLength: 50 }),
            name,
            description: Type.Optional(description),
          },
          { additionalProperties: false },
        ),
      },
    },
    (req, reply) =>
      execute(req, reply, async () => {
        const code = req.body.code.trim().toUpperCase()
        if (!clubCodePattern.test(code))
          throw invalid('Mã CLB gồm 2–50 ký tự chữ in hoa, số, “-” hoặc “_”.')
        reply.code(201)
        return r.create(submissionActor(req), {
          code,
          name: text(req.body.name, 'Tên CLB'),
          description: text(req.body.description ?? '', 'Mô tả', false),
        })
      }),
  )
  app.patch<{
    Params: { id: string }
    Body: { expectedRevision: number; name: string; description: string }
  }>(
    '/clubs/:id',
    {
      preHandler: write,
      config: limited,
      preValidation: async (req) => strict(req.body, ['expectedRevision', 'name', 'description']),
      schema: {
        params,
        body: Type.Object(
          { expectedRevision: rev, name, description },
          { additionalProperties: false },
        ),
      },
    },
    (req, reply) =>
      execute(req, reply, () =>
        r.update(submissionActor(req), req.params.id.toLowerCase(), {
          expectedRevision: req.body.expectedRevision,
          name: text(req.body.name, 'Tên CLB'),
          description: text(req.body.description, 'Mô tả', false),
        }),
      ),
  )
  app.post<{
    Params: { id: string }
    Body: { expectedRevision: number; status: ClubStatus; reason: string }
  }>(
    '/clubs/:id/status',
    {
      preHandler: write,
      config: limited,
      preValidation: async (req) => strict(req.body, ['expectedRevision', 'status', 'reason']),
      schema: {
        params,
        body: Type.Object(
          {
            expectedRevision: rev,
            status: Type.Union(clubStatuses.map((s) => Type.Literal(s))),
            reason,
          },
          { additionalProperties: false },
        ),
      },
    },
    (req, reply) =>
      execute(req, reply, () =>
        r.changeStatus(submissionActor(req), req.params.id.toLowerCase(), {
          expectedRevision: req.body.expectedRevision,
          status: req.body.status,
          reason: text(req.body.reason, 'Lý do'),
        }),
      ),
  )
  app.post<{ Params: { id: string }; Body: { username: string } }>(
    '/clubs/:id/leaders',
    {
      preHandler: write,
      config: limited,
      preValidation: async (req) => strict(req.body, ['username']),
      schema: {
        params,
        body: Type.Object(
          { username: Type.String({ minLength: 1, maxLength: 100 }) },
          { additionalProperties: false },
        ),
      },
    },
    (req, reply) =>
      execute(req, reply, () =>
        r.assignLeader(
          submissionActor(req),
          req.params.id.toLowerCase(),
          text(req.body.username, 'Tên đăng nhập'),
        ),
      ),
  )
  app.post<{ Params: { id: string; assignmentId: string }; Body: { reason: string } }>(
    '/clubs/:id/leaders/:assignmentId/end',
    {
      preHandler: write,
      config: limited,
      preValidation: async (req) => strict(req.body, ['reason']),
      schema: {
        params: Type.Object({ id: uuid, assignmentId: uuid }, { additionalProperties: false }),
        body: Type.Object({ reason }, { additionalProperties: false }),
      },
    },
    (req, reply) =>
      execute(req, reply, () =>
        r.endLeader(
          submissionActor(req),
          req.params.id.toLowerCase(),
          req.params.assignmentId.toLowerCase(),
          text(req.body.reason, 'Lý do'),
        ),
      ),
  )
}
