import { Type, type Static } from '@sinclair/typebox'
import type { FastifyInstance } from 'fastify'
import {
  configureSubmissionErrors,
  requireSubmissionSession,
  submissionActor,
  submissionOrigin,
} from '../submissions/submission.http.js'
import { portalExecute, portalInput } from '../shared/portal-input.js'
import { ActivityRepository } from './activity.repository.js'
import {
  activityCategories,
  activityKinds,
  activityLimits,
  mandatoryOwners,
  type ActivityInput,
} from './activity.types.js'

const uuid = Type.String({ format: 'uuid' }),
  params = Type.Object({ id: uuid }, { additionalProperties: false }),
  rev = Type.Integer({ minimum: 0, maximum: 2147483646 }),
  time = Type.String({ minLength: 10, maxLength: 40 }),
  reason = Type.String({ minLength: 1, maxLength: 500 }),
  /** Keeps the literal union in the static type (Type.Union over map() widens to string). */
  literals = <T extends readonly string[]>(values: T) =>
    Type.Unsafe<T[number]>(Type.Union(values.map((v) => Type.Literal(v)))),
  eligibility = Type.Object(
    {
      facultyIds: Type.Array(uuid, { maxItems: activityLimits.maxListItems }),
      classIds: Type.Array(uuid, { maxItems: activityLimits.maxListItems }),
      cohortYears: Type.Array(
        Type.Integer({ minimum: activityLimits.minCohort, maximum: activityLimits.maxCohort }),
        { maxItems: activityLimits.maxListItems },
      ),
    },
    { additionalProperties: false },
  ),
  editable = {
    category: literals(activityCategories),
    title: Type.String({ minLength: 1, maxLength: 255 }),
    description: Type.String({ maxLength: 4000 }),
    location: Type.String({ minLength: 1, maxLength: 255 }),
    startsAt: time,
    endsAt: time,
    capacity: Type.Union([
      Type.Integer({ minimum: 1, maximum: activityLimits.maxCapacity }),
      Type.Null(),
    ]),
    eligibility,
  },
  createBody = Type.Object(
    {
      kind: literals(activityKinds),
      ownerType: Type.Optional(literals(mandatoryOwners)),
      clubId: Type.Optional(uuid),
      ...editable,
    },
    { additionalProperties: false },
  ),
  updateBody = Type.Object({ expectedRevision: rev, ...editable }, { additionalProperties: false })
type Editable = Static<typeof updateBody>
const { strict, text } = portalInput('INVALID_ACTIVITY')
const execute = portalExecute(
  'ACTIVITY_',
  'ACTIVITY_CONFLICT',
  'Hoạt động đã thay đổi hoặc thao tác không còn phù hợp. Hãy tải lại.',
)
const editableFields = Object.keys(editable)
function strictEligibility(body: unknown) {
  const e = (body as { eligibility?: unknown } | null)?.eligibility
  strict(e, ['facultyIds', 'classIds', 'cohortYears'])
}
function clean<T extends Omit<Editable, 'expectedRevision'>>(b: T): T {
  return {
    ...b,
    title: text(b.title, 'Tên hoạt động'),
    description: text(b.description, 'Mô tả', false),
    location: text(b.location, 'Địa điểm'),
    eligibility: {
      facultyIds: b.eligibility.facultyIds.map((x) => x.toLowerCase()),
      classIds: b.eligibility.classIds.map((x) => x.toLowerCase()),
      cohortYears: b.eligibility.cohortYears,
    },
  }
}

/** ADR 0030: activity management (CTSV, Phòng Đào tạo, club leaders) and the student view. */
export async function activityRoutes(
  app: FastifyInstance,
  options: { activityRepository: ActivityRepository },
) {
  configureSubmissionErrors(app)
  app.addHook('onRequest', async (_req, reply) => {
    reply.header('Cache-Control', 'private, no-store')
  })
  const r = options.activityRepository,
    auth = [requireSubmissionSession('user')],
    student = [requireSubmissionSession('user', true)],
    write = [...auth, submissionOrigin],
    limited = { rateLimit: { max: 30, timeWindow: '1 minute' } }
  app.get('/activities/available', { preHandler: student }, (req, reply) =>
    execute(req, reply, () => r.available(submissionActor(req).userId)),
  )
  app.get('/activities/manage', { preHandler: auth }, (req, reply) =>
    execute(req, reply, () => r.list(submissionActor(req).userId)),
  )
  app.get('/activities/manage/options', { preHandler: auth }, (req, reply) =>
    execute(req, reply, () => r.options(submissionActor(req).userId)),
  )
  app.get<{ Params: { id: string } }>(
    '/activities/manage/:id',
    { preHandler: auth, schema: { params } },
    (req, reply) =>
      execute(req, reply, () => r.detail(submissionActor(req).userId, req.params.id.toLowerCase())),
  )
  app.post<{ Body: Static<typeof createBody> }>(
    '/activities',
    {
      preHandler: write,
      config: limited,
      preValidation: async (req) => {
        strict(req.body, ['kind', 'ownerType', 'clubId', ...editableFields])
        strictEligibility(req.body)
      },
      schema: { body: createBody },
    },
    (req, reply) =>
      execute(req, reply, async () => {
        const b = clean(req.body)
        const input: ActivityInput = {
          ...b,
          ...(b.clubId ? { clubId: b.clubId.toLowerCase() } : {}),
        }
        reply.code(201)
        return r.create(submissionActor(req), input)
      }),
  )
  app.patch<{ Params: { id: string }; Body: Editable }>(
    '/activities/:id',
    {
      preHandler: write,
      config: limited,
      preValidation: async (req) => {
        strict(req.body, ['expectedRevision', ...editableFields])
        strictEligibility(req.body)
      },
      schema: { params, body: updateBody },
    },
    (req, reply) =>
      execute(req, reply, () =>
        r.update(submissionActor(req), req.params.id.toLowerCase(), clean(req.body)),
      ),
  )
  const transitions = {
    publish: 'PUBLISHED',
    cancel: 'CANCELLED',
    suspend: 'SUSPENDED',
    resume: 'RESUMED',
  } as const
  for (const [path, action] of Object.entries(transitions)) {
    const needsReason = action !== 'PUBLISHED'
    const body = Type.Object(
      { expectedRevision: rev, ...(needsReason ? { reason } : {}) },
      { additionalProperties: false },
    )
    app.post<{ Params: { id: string }; Body: { expectedRevision: number; reason?: string } }>(
      '/activities/:id/' + path,
      {
        preHandler: write,
        config: limited,
        preValidation: async (req) =>
          strict(req.body, needsReason ? ['expectedRevision', 'reason'] : ['expectedRevision']),
        schema: { params, body },
      },
      (req, reply) =>
        execute(req, reply, () =>
          r.transition(
            submissionActor(req),
            req.params.id.toLowerCase(),
            action,
            req.body.expectedRevision,
            needsReason ? text(req.body.reason ?? '', 'Lý do') : null,
          ),
        ),
    )
  }
  app.post<{
    Params: { id: string }
    Body: { expectedRevision: number; clubId: string | null; reason?: string }
  }>(
    '/activities/:id/delegation',
    {
      preHandler: write,
      config: limited,
      preValidation: async (req) => strict(req.body, ['expectedRevision', 'clubId', 'reason']),
      schema: {
        params,
        body: Type.Object(
          {
            expectedRevision: rev,
            clubId: Type.Union([uuid, Type.Null()]),
            reason: Type.Optional(Type.String({ maxLength: 500 })),
          },
          { additionalProperties: false },
        ),
      },
    },
    (req, reply) =>
      execute(req, reply, () =>
        r.delegate(
          submissionActor(req),
          req.params.id.toLowerCase(),
          req.body.expectedRevision,
          req.body.clubId?.toLowerCase() ?? null,
          text(req.body.reason ?? '', 'Lý do', false) || null,
        ),
      ),
  )
}
