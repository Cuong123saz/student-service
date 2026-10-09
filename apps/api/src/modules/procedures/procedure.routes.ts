import { Type, type Static } from '@sinclair/typebox'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { requireAdminSession, requireAdminReadySession } from '../auth/admin-auth.guard.js'
import { requireAdminPermission } from '../auth/admin-permission.guard.js'
import type { AuthorizationUseCase } from '../auth/authorization.service.js'
import { getAuditRequestContext } from '../audit/audit-request-context.js'
import { procedureConfigSchema, type ProcedureActor } from './procedure.contract.js'
import type { ProcedureUseCase } from './procedure.service.js'
import { ProcedureError } from './procedure.errors.js'

const uuid = Type.String({ format: 'uuid' })
const issueSchema = Type.Object({ path: Type.String(), message: Type.String() })
const errorSchema = Type.Object({
  message: Type.String(),
  code: Type.Optional(Type.String()),
  requestId: Type.Optional(Type.String()),
  issues: Type.Optional(Type.Array(issueSchema)),
})
const versionSchema = Type.Object({
  id: uuid,
  serviceId: Type.Integer(),
  ownerUnitId: uuid,
  versionNumber: Type.Integer(),
  revision: Type.Integer(),
  status: Type.Union([Type.Literal('DRAFT'), Type.Literal('PUBLISHED'), Type.Literal('RETIRED')]),
  config: procedureConfigSchema,
  publishedAt: Type.Union([Type.String(), Type.Null()]),
})
const errors = {
  400: errorSchema,
  401: errorSchema,
  403: errorSchema,
  404: errorSchema,
  409: errorSchema,
  422: errorSchema,
}
const serviceParams = Type.Object({
  serviceId: Type.String({ pattern: '^[1-9][0-9]*$', maxLength: 9 }),
})
const versionParams = Type.Object({ versionId: uuid })
const createSchema = Type.Object(
  { ownerUnitId: uuid, cloneVersionId: Type.Union([uuid, Type.Null()]) },
  { additionalProperties: false },
)
const updateSchema = Type.Object(
  { expectedRevision: Type.Integer({ minimum: 1 }), config: procedureConfigSchema },
  { additionalProperties: false },
)
const publishSchema = Type.Object(
  { expectedRevision: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false },
)
type ServiceParams = Static<typeof serviceParams>
type VersionParams = Static<typeof versionParams>
function actor(request: FastifyRequest): ProcedureActor {
  if (!request.adminSession) throw new ProcedureError(401, 'UNAUTHORIZED', 'Vui lòng đăng nhập.')
  return {
    userId: request.adminSession.sub,
    username: request.adminSession.username,
    ...getAuditRequestContext(request),
  }
}
async function execute(
  request: FastifyRequest,
  reply: FastifyReply,
  operation: () => Promise<unknown>,
  status = 200,
) {
  try {
    return reply.code(status).send(await operation())
  } catch (error) {
    if (error instanceof ProcedureError)
      return reply.code(error.statusCode).send({
        message: error.message,
        code: error.code,
        requestId: request.id,
        issues: error.issues,
      })
    throw error
  }
}
export async function procedureAdminRoutes(
  app: FastifyInstance,
  options: { procedureService: ProcedureUseCase; authorizationService: AuthorizationUseCase },
) {
  const guards = [
    requireAdminSession,
    requireAdminReadySession,
    requireAdminPermission(options.authorizationService, 'service.configure'),
  ]
  const service = options.procedureService
  app.get(
    '/procedure-catalog',
    {
      preHandler: guards,
      schema: {
        response: {
          200: Type.Object({
            services: Type.Array(
              Type.Object({
                id: Type.Integer(),
                code: Type.String(),
                name: Type.String(),
                status: Type.String(),
              }),
            ),
            units: Type.Array(Type.Object({ id: uuid, code: Type.String(), name: Type.String() })),
            reviewers: Type.Array(
              Type.Object({
                id: uuid,
                name: Type.String(),
                unitId: Type.Union([uuid, Type.Null()]),
              }),
            ),
            canCreate: Type.Boolean(),
          }),
          ...errors,
        },
      },
    },
    (request, reply) => execute(request, reply, () => service.catalog(actor(request).userId)),
  )

  app.get<{ Params: ServiceParams }>(
    '/services/:serviceId/procedure-versions',
    {
      preHandler: guards,
      schema: { params: serviceParams, response: { 200: Type.Array(versionSchema), ...errors } },
    },
    (request, reply) =>
      execute(request, reply, () =>
        service.list(actor(request).userId, Number(request.params.serviceId)),
      ),
  )

  app.post<{ Params: ServiceParams; Body: Static<typeof createSchema> }>(
    '/services/:serviceId/procedure-versions',
    {
      preHandler: guards,
      schema: {
        params: serviceParams,
        body: createSchema,
        response: { 201: versionSchema, ...errors },
      },
    },
    (request, reply) =>
      execute(
        request,
        reply,
        () =>
          service.create(actor(request), {
            serviceId: Number(request.params.serviceId),
            ...request.body,
          }),
        201,
      ),
  )

  app.put<{ Params: VersionParams; Body: Static<typeof updateSchema> }>(
    '/procedure-versions/:versionId',
    {
      preHandler: guards,
      schema: {
        params: versionParams,
        body: updateSchema,
        response: { 200: versionSchema, ...errors },
      },
    },
    (request, reply) =>
      execute(request, reply, () =>
        service.update(actor(request), request.params.versionId, request.body),
      ),
  )

  app.post<{ Params: VersionParams }>(
    '/procedure-versions/:versionId/validate',
    {
      preHandler: guards,
      schema: {
        params: versionParams,
        response: {
          200: Type.Object({ valid: Type.Boolean(), issues: Type.Array(issueSchema) }),
          ...errors,
        },
      },
    },
    (request, reply) =>
      execute(request, reply, async () => {
        const issues = await service.validate(actor(request).userId, request.params.versionId)
        return { valid: !issues.length, issues }
      }),
  )

  app.post<{ Params: VersionParams; Body: Static<typeof publishSchema> }>(
    '/procedure-versions/:versionId/publish',
    {
      preHandler: guards,
      schema: {
        params: versionParams,
        body: publishSchema,
        response: { 200: versionSchema, ...errors },
      },
    },
    (request, reply) =>
      execute(request, reply, () =>
        service.publish(actor(request), request.params.versionId, request.body.expectedRevision),
      ),
  )
}
export async function procedurePublicRoutes(
  app: FastifyInstance,
  options: { procedureService: ProcedureUseCase },
) {
  const publicSchema = Type.Object({
    versionId: uuid,
    versionNumber: Type.Integer(),
    processingMode: procedureConfigSchema.properties.processingMode,
    processingUnitName: Type.String(),
    contactInstructions: Type.String(),
    fields: procedureConfigSchema.properties.fields,
    attachments: procedureConfigSchema.properties.attachments,
    maxTotalAttachmentBytes: Type.Integer(),
  })
  app.get<{ Params: ServiceParams }>(
    '/services/:serviceId/procedure',
    {
      schema: {
        params: serviceParams,
        response: {
          200: Type.Object({ procedure: Type.Union([publicSchema, Type.Null()]) }),
          400: errorSchema,
        },
      },
    },
    async (request) => ({
      procedure: await options.procedureService.published(Number(request.params.serviceId)),
    }),
  )
}
