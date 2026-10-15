import { Type } from '@sinclair/typebox'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  configureSubmissionErrors,
  executeSubmission,
  requireSubmissionSession,
  submissionActor,
  submissionOrigin,
  sendEvidence,
} from '../submissions/submission.http.js'
import { SubmissionError } from '../submissions/submission.types.js'
import type { ReviewInput, ReviewState } from './training-review.types.js'
import { TrainingReviewService } from './training-review.service.js'
const uuid = Type.String({ format: 'uuid' }),
  params = Type.Object({ id: uuid }, { additionalProperties: false }),
  rev = Type.Integer({ minimum: 0, maximum: 2147483646 })
function strict(value: unknown, fields: string[]) {
  if (value && typeof value === 'object' && Object.keys(value).some((k) => !fields.includes(k)))
    throw new SubmissionError(
      400,
      'INVALID_TRAINING_REVIEW',
      'Thông tin chứa trường không được phép.',
    )
}
async function execute(req: FastifyRequest, reply: FastifyReply, fn: () => Promise<unknown>) {
  return executeSubmission(req, reply, async () => {
    try {
      return await fn()
    } catch (e) {
      const x = e as { code?: string; message?: string }
      if (x.code === '23505' || (x.code === '23514' && x.message?.startsWith('TRAINING_')))
        throw new SubmissionError(
          409,
          'TRAINING_REVIEW_CONFLICT',
          'Kết quả đã thay đổi. Hãy tải lại trước khi xử lý.',
        )
      throw e
    }
  })
}
export async function trainingReviewRoutes(
  app: FastifyInstance,
  options: { trainingReviewService: TrainingReviewService },
) {
  configureSubmissionErrors(app)
  app.addHook('onRequest', async (_req, reply) => {
    reply.header('Cache-Control', 'private, no-store')
  })
  const s = options.trainingReviewService,
    r = s.repository,
    auth = [requireSubmissionSession('user')],
    write = [...auth, submissionOrigin]
  app.get('/training-reviews/periods', { preHandler: auth }, (req, reply) =>
    execute(req, reply, () => r.periods(submissionActor(req).userId)),
  )
  app.get<{ Params: { id: string }; Querystring: { cursor?: string; state?: ReviewState } }>(
    '/training-reviews/periods/:id',
    {
      preHandler: auth,
      preValidation: async (req) => strict(req.query, ['cursor', 'state']),
      schema: {
        params,
        querystring: Type.Object(
          {
            cursor: Type.Optional(uuid),
            state: Type.Optional(
              Type.Union(
                ['WAITING_ADVISOR', 'WAITING_FACULTY', 'RETURNED_TO_ADVISOR', 'APPROVED'].map((x) =>
                  Type.Literal(x),
                ),
              ),
            ),
          },
          { additionalProperties: false },
        ),
      },
    },
    (req, reply) =>
      execute(req, reply, () =>
        r.queue(
          submissionActor(req).userId,
          req.params.id.toLowerCase(),
          req.query.cursor?.toLowerCase(),
          req.query.state,
        ),
      ),
  )
  app.get<{ Params: { id: string } }>(
    '/training-reviews/:id',
    { preHandler: auth, schema: { params } },
    (req, reply) =>
      execute(req, reply, () => r.detail(submissionActor(req).userId, req.params.id.toLowerCase())),
  )
  app.get<{ Params: { id: string } }>(
    '/training-declarations/:id/review',
    { preHandler: [requireSubmissionSession('user', true)], schema: { params } },
    (req, reply) =>
      execute(req, reply, () =>
        r.detail(submissionActor(req).userId, req.params.id.toLowerCase(), true),
      ),
  )
  app.get<{ Params: { id: string; fileId: string } }>(
    '/training-reviews/:id/files/:fileId',
    {
      preHandler: auth,
      schema: { params: Type.Object({ id: uuid, fileId: uuid }, { additionalProperties: false }) },
    },
    (req, reply) =>
      execute(req, reply, async () =>
        sendEvidence(
          reply,
          await s.download(
            submissionActor(req).userId,
            req.params.id.toLowerCase(),
            req.params.fileId.toLowerCase(),
          ),
        ),
      ),
  )
  for (const [path, action] of [
    ['advisor-sign', 'ADVISOR_SIGNED'],
    ['faculty-return', 'FACULTY_RETURNED'],
    ['faculty-approve', 'FACULTY_APPROVED'],
  ] as const) {
    const advisor = action === 'ADVISOR_SIGNED',
      fields = [
        'expectedRevision',
        'requestId',
        'confirmed',
        'comment',
        ...(advisor ? ['answers'] : []),
      ]
    app.post<{ Params: { id: string }; Body: ReviewInput }>(
      '/training-reviews/:id/' + path,
      {
        preHandler: write,
        bodyLimit: 65536,
        config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
        preValidation: async (req) => {
          strict(req.body, fields)
          const b = req.body
          if (
            b &&
            (typeof b.expectedRevision !== 'number' ||
              b.confirmed !== true ||
              typeof b.comment !== 'string')
          )
            throw new SubmissionError(
              400,
              'INVALID_TRAINING_REVIEW',
              'Kiểm tra nhận xét và đánh dấu xác nhận.',
            )
          if (advisor && b?.answers) {
            strict(b.answers, ['A', 'B', 'C', 'D', 'E'])
            for (const a of Object.values(b.answers)) {
              strict(a, ['points', 'note'])
              if (!a || typeof a.points !== 'number' || typeof a.note !== 'string')
                throw new SubmissionError(
                  400,
                  'INVALID_TRAINING_REVIEW',
                  'Điểm xét duyệt phải là số nguyên, đủ năm nhóm.',
                )
            }
          }
        },
        schema: {
          params,
          body: Type.Object(
            {
              expectedRevision: rev,
              requestId: uuid,
              confirmed: Type.Literal(true),
              comment: Type.String({ minLength: 1, maxLength: 2000 }),
              ...(advisor
                ? {
                    answers: Type.Record(
                      Type.String({ pattern: '^[A-E]$' }),
                      Type.Object(
                        {
                          points: Type.Integer({ minimum: 0, maximum: 100 }),
                          note: Type.String({ maxLength: 2000 }),
                        },
                        { additionalProperties: false },
                      ),
                    ),
                  }
                : {}),
            },
            { additionalProperties: false },
          ),
        },
      },
      (req, reply) =>
        execute(req, reply, () =>
          s.act(submissionActor(req).userId, req.params.id.toLowerCase(), action, {
            ...req.body,
            requestId: req.body.requestId.toLowerCase(),
          }),
        ),
    )
  }
}
