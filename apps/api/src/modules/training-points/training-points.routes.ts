import { Type } from '@sinclair/typebox'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import {
  configureSubmissionErrors,
  executeSubmission,
  requireSubmissionSession,
  submissionActor,
  submissionOrigin,
  sendEvidence,
} from '../submissions/submission.http.js'
import { SubmissionError } from '../submissions/submission.types.js'
import { TrainingPointService } from './training-points.service.js'
import type { PeriodInput, Answers, Group } from './training-points.types.js'
async function executeTraining(
  request: FastifyRequest,
  reply: FastifyReply,
  action: () => Promise<unknown>,
) {
  return executeSubmission(request, reply, async () => {
    try {
      return await action()
    } catch (error) {
      const e = error as { code?: string; message?: string }
      if (e.code === '23514' && e.message?.startsWith('TRAINING_'))
        throw new SubmissionError(
          409,
          'TRAINING_CONFLICT',
          'Đợt hoặc bản kê khai đã thay đổi. Hãy tải lại trạng thái.',
        )
      throw error
    }
  })
}
const uuid = Type.String({ format: 'uuid' }),
  revision = Type.Integer({ minimum: 1, maximum: 2147483647 }),
  idParams = Type.Object({ id: uuid }, { additionalProperties: false })
const periodFields = [
  'classId',
  'academicYear',
  'semester',
  'name',
  'policyLabel',
  'startsAt',
  'endsAt',
  'criteria',
]
const config = Type.Object(
  {
    classId: uuid,
    academicYear: Type.String({ pattern: '^[0-9]{4}-[0-9]{4}$' }),
    semester: Type.Union([Type.Literal('1'), Type.Literal('2'), Type.Literal('SUMMER')]),
    name: Type.String({ minLength: 1, maxLength: 200 }),
    policyLabel: Type.String({ minLength: 1, maxLength: 200 }),
    startsAt: Type.String({ format: 'date-time' }),
    endsAt: Type.String({ format: 'date-time' }),
    criteria: Type.Array(
      Type.Object(
        {
          code: Type.String({ pattern: '^[A-E]$' }),
          label: Type.String({ minLength: 1, maxLength: 200 }),
          maxPoints: Type.Integer({ minimum: 1, maximum: 100 }),
          evidenceRequired: Type.Boolean(),
        },
        { additionalProperties: false },
      ),
      { minItems: 5, maxItems: 5 },
    ),
  },
  { additionalProperties: false },
)
function keys(value: unknown, allowed: string[]) {
  if (value && typeof value === 'object' && Object.keys(value).some((k) => !allowed.includes(k)))
    throw new SubmissionError(400, 'INVALID_TRAINING_INPUT', 'Thông tin có trường không hợp lệ.')
}
function strict(fields: string[], period = false) {
  return async (req: { body: unknown }) => {
    keys(req.body, fields)
    const b = req.body as {
      config?: unknown
      criteria?: unknown[]
      answers?: Record<string, unknown>
    }
    if (period) {
      const v = (b?.config ?? b) as { criteria?: unknown[] }
      keys(v, periodFields)
      for (const c of Array.isArray(v?.criteria) ? v.criteria : [])
        keys(c, ['code', 'label', 'maxPoints', 'evidenceRequired'])
    }
    if (b?.answers) {
      keys(b.answers, ['A', 'B', 'C', 'D', 'E'])
      for (const a of Object.values(b.answers)) keys(a, ['points', 'note'])
    }
  }
}
const noStore = (reply: { header: (key: string, value: string) => unknown }) =>
  reply.header('Cache-Control', 'private, no-store')
export async function trainingAdminRoutes(
  app: FastifyInstance,
  options: { trainingService: TrainingPointService },
) {
  configureSubmissionErrors(app)
  app.addHook('onRequest', async (_request, reply) => {
    noStore(reply)
  })
  const s = options.trainingService,
    r = s.repository
  const auth = [requireSubmissionSession('admin')],
    write = [...auth, submissionOrigin]
  app.get('/training-periods/catalog', { preHandler: auth }, (req, reply) =>
    executeTraining(req, reply, async () => {
      noStore(reply)
      return r.catalog(submissionActor(req).userId)
    }),
  )
  app.get('/training-periods', { preHandler: auth }, (req, reply) =>
    executeTraining(req, reply, async () => {
      noStore(reply)
      return r.periods(submissionActor(req).userId, true)
    }),
  )
  app.get<{ Params: { id: string } }>(
    '/training-periods/:id',
    { preHandler: auth, schema: { params: idParams } },
    (req, reply) =>
      executeTraining(req, reply, async () => {
        noStore(reply)
        return r.periodDetail(submissionActor(req).userId, req.params.id.toLowerCase())
      }),
  )
  app.post<{ Body: PeriodInput }>(
    '/training-periods',
    {
      preHandler: write,
      preValidation: strict(periodFields, true),
      bodyLimit: 65536,
      schema: { body: config },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    (req, reply) =>
      executeTraining(req, reply, async () => {
        noStore(reply)
        return r.createPeriod(submissionActor(req).userId, {
          ...req.body,
          classId: req.body.classId.toLowerCase(),
        })
      }),
  )
  app.put<{ Params: { id: string }; Body: { expectedRevision: number; config: PeriodInput } }>(
    '/training-periods/:id',
    {
      preHandler: write,
      preValidation: strict(['expectedRevision', 'config'], true),
      bodyLimit: 65536,
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        params: idParams,
        body: Type.Object({ expectedRevision: revision, config }, { additionalProperties: false }),
      },
    },
    (req, reply) =>
      executeTraining(req, reply, async () => {
        noStore(reply)
        return r.changePeriod(
          submissionActor(req).userId,
          req.params.id.toLowerCase(),
          req.body.expectedRevision,
          'SAVE',
          { ...req.body.config, classId: req.body.config.classId.toLowerCase() },
        )
      }),
  )
  for (const action of ['open', 'close'] as const)
    app.post<{ Params: { id: string }; Body: { expectedRevision: number } }>(
      '/training-periods/:id/' + action,
      {
        preHandler: write,
        preValidation: strict(['expectedRevision']),
        bodyLimit: 2048,
        config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
        schema: {
          params: idParams,
          body: Type.Object({ expectedRevision: revision }, { additionalProperties: false }),
        },
      },
      (req, reply) =>
        executeTraining(req, reply, async () => {
          noStore(reply)
          return r.changePeriod(
            submissionActor(req).userId,
            req.params.id.toLowerCase(),
            req.body.expectedRevision,
            action === 'open' ? 'OPEN' : 'CLOSE',
          )
        }),
    )
}
export async function trainingStudentRoutes(
  app: FastifyInstance,
  options: { trainingService: TrainingPointService },
) {
  configureSubmissionErrors(app)
  app.addHook('onRequest', async (_request, reply) => {
    noStore(reply)
  })
  const s = options.trainingService,
    r = s.repository
  const auth = [requireSubmissionSession('user', true)],
    write = [...auth, submissionOrigin]
  app.get('/training-periods', { preHandler: auth }, (req, reply) =>
    executeTraining(req, reply, async () => {
      noStore(reply)
      return r.periods(submissionActor(req).userId)
    }),
  )
  app.post<{ Params: { id: string } }>(
    '/training-periods/:id/declaration',
    {
      preHandler: write,
      preValidation: strict([]),
      schema: {
        params: idParams,
        body: Type.Optional(Type.Object({}, { additionalProperties: false })),
      },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    (req, reply) =>
      executeTraining(req, reply, async () => {
        noStore(reply)
        return r.start(submissionActor(req).userId, req.params.id.toLowerCase())
      }),
  )
  app.get<{ Params: { id: string } }>(
    '/training-declarations/:id',
    { preHandler: auth, schema: { params: idParams } },
    (req, reply) =>
      executeTraining(req, reply, async () => {
        noStore(reply)
        return r.detail(submissionActor(req).userId, req.params.id.toLowerCase())
      }),
  )
  app.put<{ Params: { id: string }; Body: { expectedRevision: number; answers: Answers } }>(
    '/training-declarations/:id',
    {
      preHandler: write,
      preValidation: strict(['expectedRevision', 'answers']),
      bodyLimit: 65536,
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        params: idParams,
        body: Type.Object(
          {
            expectedRevision: revision,
            answers: Type.Record(
              Type.String({ pattern: '^[A-E]$' }),
              Type.Object(
                {
                  points: Type.Union([Type.Integer({ minimum: 0, maximum: 100 }), Type.Null()]),
                  note: Type.String({ maxLength: 2000 }),
                },
                { additionalProperties: false },
              ),
            ),
          },
          { additionalProperties: false },
        ),
      },
    },
    (req, reply) =>
      executeTraining(req, reply, async () => {
        noStore(reply)
        return r.save(
          submissionActor(req).userId,
          req.params.id.toLowerCase(),
          req.body.expectedRevision,
          req.body.answers,
        )
      }),
  )
  app.post<{ Params: { id: string }; Body: { expectedRevision: number; requestId: string } }>(
    '/training-declarations/:id/submit',
    {
      preHandler: write,
      preValidation: strict(['expectedRevision', 'requestId']),
      bodyLimit: 2048,
      schema: {
        params: idParams,
        body: Type.Object(
          { expectedRevision: revision, requestId: uuid },
          { additionalProperties: false },
        ),
      },
      config: { rateLimit: { max: 12, timeWindow: '1 minute' } },
    },
    (req, reply) =>
      executeTraining(req, reply, async () => {
        noStore(reply)
        return s.submit(
          submissionActor(req).userId,
          req.params.id.toLowerCase(),
          req.body.expectedRevision,
          req.body.requestId.toLowerCase(),
        )
      }),
  )
  app.post<{
    Params: { id: string; criterion: Group }
    Querystring: { expectedRevision: number; requestId: string }
  }>(
    '/training-declarations/:id/evidence/:criterion',
    {
      preHandler: write,
      preValidation: async (req) => keys(req.query, ['expectedRevision', 'requestId']),
      bodyLimit: 5 * 1024 * 1024 + 16384,
      schema: {
        params: Type.Object(
          { id: uuid, criterion: Type.String({ pattern: '^[A-E]$' }) },
          { additionalProperties: false },
        ),
        querystring: Type.Object(
          { expectedRevision: revision, requestId: uuid },
          { additionalProperties: false },
        ),
      },
      config: { rateLimit: { max: 12, timeWindow: '1 minute' } },
    },
    (req, reply) =>
      executeTraining(req, reply, async () => {
        const user = submissionActor(req).userId,
          id = req.params.id.toLowerCase()
        await r.detail(user, id)
        const file = await req.file({ limits: { files: 1, parts: 1, fileSize: 5 * 1024 * 1024 } })
        if (!file || file.fieldname !== 'file')
          throw new SubmissionError(400, 'TRAINING_FILE_REQUIRED', 'Chọn một tệp minh chứng.')
        const bytes = await file.toBuffer()
        noStore(reply)
        return s.upload(
          user,
          id,
          req.params.criterion,
          req.query.expectedRevision,
          req.query.requestId.toLowerCase(),
          bytes,
          file.filename,
          file.mimetype,
        )
      }),
  )
  const fp = Type.Object({ id: uuid, fileId: uuid }, { additionalProperties: false })
  app.get<{ Params: { id: string; fileId: string } }>(
    '/training-declarations/:id/files/:fileId',
    { preHandler: auth, schema: { params: fp } },
    (req, reply) =>
      executeTraining(req, reply, async () =>
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
  app.delete<{ Params: { id: string; fileId: string }; Querystring: { expectedRevision: number } }>(
    '/training-declarations/:id/files/:fileId',
    {
      preHandler: write,
      preValidation: async (req) => keys(req.query, ['expectedRevision']),
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        params: fp,
        querystring: Type.Object({ expectedRevision: revision }, { additionalProperties: false }),
      },
    },
    (req, reply) =>
      executeTraining(req, reply, async () => {
        noStore(reply)
        return r.removeFile(
          submissionActor(req).userId,
          req.params.id.toLowerCase(),
          req.params.fileId.toLowerCase(),
          req.query.expectedRevision,
        )
      }),
  )
}
