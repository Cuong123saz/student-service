import { Type } from '@sinclair/typebox'
import type { FastifyInstance } from 'fastify'
import {
  configureSubmissionErrors,
  requireSubmissionSession,
  sendEvidence,
  submissionActor,
  submissionOrigin,
} from '../submissions/submission.http.js'
import { SubmissionError } from '../submissions/submission.types.js'
import { portalExecute, portalInput } from '../shared/portal-input.js'
import { activityPhotoMaxBytes } from './activity-photo.js'
import type { ActivityAttendanceRepository } from './activity-attendance.repository.js'

const uuid = Type.String({ format: 'uuid' }),
  params = Type.Object({ id: uuid }, { additionalProperties: false }),
  rev = Type.Integer({ minimum: 0, maximum: 2147483646 }),
  reason = Type.String({ minLength: 1, maxLength: 500 })
const { strict, text } = portalInput('INVALID_ACTIVITY')
const execute = portalExecute(
  'ACTIVITY_',
  'ACTIVITY_ATTENDANCE_CONFLICT',
  'Lượt điểm danh đã thay đổi hoặc không còn phù hợp. Hãy tải lại.',
)

/** ADR 0032: QR check-in, photo upload, review queue and certificates. */
export async function activityAttendanceRoutes(
  app: FastifyInstance,
  options: { attendanceRepository: ActivityAttendanceRepository },
) {
  configureSubmissionErrors(app)
  app.addHook('onRequest', async (_req, reply) => {
    reply.header('Cache-Control', 'private, no-store')
  })
  const r = options.attendanceRepository,
    auth = [requireSubmissionSession('user')],
    student = [requireSubmissionSession('user', true)],
    write = [...auth, submissionOrigin],
    studentWrite = [...student, submissionOrigin],
    limited = { rateLimit: { max: 30, timeWindow: '1 minute' } }

  app.get('/activities/certificates', { preHandler: student }, (req, reply) =>
    execute(req, reply, () => r.certificates(submissionActor(req).userId)),
  )
  app.get<{ Params: { id: string } }>(
    '/activities/:id/attendance',
    { preHandler: student, schema: { params } },
    (req, reply) =>
      execute(req, reply, () => r.mine(submissionActor(req).userId, req.params.id.toLowerCase())),
  )
  app.post<{ Params: { id: string }; Body: { code: string } }>(
    '/activities/:id/attendance/scan',
    {
      preHandler: studentWrite,
      config: limited,
      preValidation: async (req) => strict(req.body, ['code']),
      schema: {
        params,
        body: Type.Object(
          { code: Type.String({ minLength: 1, maxLength: 64 }) },
          { additionalProperties: false },
        ),
      },
    },
    (req, reply) =>
      execute(req, reply, () =>
        r.scan(submissionActor(req), req.params.id.toLowerCase(), req.body.code),
      ),
  )
  app.post<{ Params: { id: string } }>(
    '/activities/:id/attendance/photo',
    {
      preHandler: studentWrite,
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: { params },
    },
    (req, reply) =>
      execute(req, reply, async () => {
        const file = await req.file({
          limits: { files: 1, parts: 1, fileSize: activityPhotoMaxBytes },
        })
        if (!file || file.fieldname !== 'photo' || file.mimetype !== 'image/jpeg')
          throw new SubmissionError(
            400,
            'INVALID_ACTIVITY_PHOTO',
            'Gửi một ảnh JPEG chụp từ camera.',
          )
        return r.submitPhoto(
          submissionActor(req),
          req.params.id.toLowerCase(),
          await file.toBuffer(),
        )
      }),
  )

  app.get<{ Params: { id: string } }>(
    '/activities/manage/:id/attendance',
    { preHandler: auth, schema: { params } },
    (req, reply) =>
      execute(req, reply, () => r.queue(submissionActor(req).userId, req.params.id.toLowerCase())),
  )
  app.get<{ Params: { id: string; attendanceId: string } }>(
    '/activities/manage/:id/attendance/:attendanceId/photo',
    {
      preHandler: auth,
      schema: {
        params: Type.Object({ id: uuid, attendanceId: uuid }, { additionalProperties: false }),
      },
    },
    (req, reply) =>
      execute(req, reply, async () =>
        sendEvidence(
          reply,
          await r.photo(
            submissionActor(req),
            req.params.id.toLowerCase(),
            req.params.attendanceId.toLowerCase(),
          ),
        ),
      ),
  )
  app.post<{
    Params: { id: string }
    Body: { entries: { id: string; revision: number }[]; approve: boolean; note?: string }
  }>(
    '/activities/manage/:id/attendance/review',
    {
      preHandler: write,
      config: limited,
      preValidation: async (req) => {
        strict(req.body, ['entries', 'approve', 'note'])
        const entries = (req.body as { entries?: unknown } | null)?.entries
        if (Array.isArray(entries)) for (const e of entries) strict(e, ['id', 'revision'])
      },
      schema: {
        params,
        body: Type.Object(
          {
            entries: Type.Array(
              Type.Object({ id: uuid, revision: rev }, { additionalProperties: false }),
              { minItems: 1, maxItems: 100 },
            ),
            approve: Type.Boolean(),
            note: Type.Optional(Type.String({ maxLength: 500 })),
          },
          { additionalProperties: false },
        ),
      },
    },
    (req, reply) =>
      execute(req, reply, () =>
        r.review(
          submissionActor(req),
          req.params.id.toLowerCase(),
          req.body.entries.map((e) => ({ id: e.id.toLowerCase(), revision: e.revision })),
          req.body.approve,
          text(req.body.note ?? '', 'Ghi chú', false) || null,
        ),
      ),
  )
  app.post<{ Params: { id: string }; Body: { reason: string } }>(
    '/activities/certificates/:id/revoke',
    {
      preHandler: write,
      config: limited,
      preValidation: async (req) => strict(req.body, ['reason']),
      schema: { params, body: Type.Object({ reason }, { additionalProperties: false }) },
    },
    (req, reply) =>
      execute(req, reply, () =>
        r.revoke(submissionActor(req), req.params.id.toLowerCase(), text(req.body.reason, 'Lý do')),
      ),
  )
  app.get<{ Params: { id: string } }>(
    '/activities/manage/:id/checkin-qr.svg',
    { preHandler: auth, schema: { params } },
    (req, reply) =>
      execute(req, reply, async () => {
        const { svg } = await r.qr(submissionActor(req).userId, req.params.id.toLowerCase())
        return reply
          .header('Content-Type', 'image/svg+xml; charset=utf-8')
          .header('X-Content-Type-Options', 'nosniff')
          .header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'")
          .send(svg)
      }),
  )
  app.post<{
    Params: { id: string }
    Body: { expectedRevision: number; reset?: true; rotating?: boolean }
  }>(
    '/activities/manage/:id/checkin',
    {
      preHandler: write,
      config: limited,
      preValidation: async (req) => strict(req.body, ['expectedRevision', 'reset', 'rotating']),
      schema: {
        params,
        body: Type.Object(
          {
            expectedRevision: rev,
            reset: Type.Optional(Type.Literal(true)),
            rotating: Type.Optional(Type.Boolean()),
          },
          { additionalProperties: false },
        ),
      },
    },
    (req, reply) =>
      execute(req, reply, () => {
        const b = req.body
        if ((b.reset === true) === (b.rotating !== undefined))
          throw new SubmissionError(400, 'INVALID_ACTIVITY', 'Chọn đặt lại mã hoặc đổi chế độ QR.')
        return r.configureCheckin(
          submissionActor(req),
          req.params.id.toLowerCase(),
          b.expectedRevision,
          b.reset ? { reset: true } : { rotating: b.rotating! },
        )
      }),
  )
}
