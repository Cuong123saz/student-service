import { type Static, Type } from '@sinclair/typebox'
import type { FastifyInstance, FastifyPluginOptions, FastifyReply } from 'fastify'

import { getAuditRequestContext } from '../audit/audit-request-context.js'
import { requireAdminReadySession, requireAdminSession } from '../auth/admin-auth.guard.js'
import { requireAdminPermission } from '../auth/admin-permission.guard.js'
import type { AuthorizationUseCase } from '../auth/authorization.service.js'
import {
  OrganizationConflictError,
  OrganizationForbiddenError,
  OrganizationInactiveError,
  OrganizationNotFoundError,
} from './organization-management.repository.js'
import type { OrganizationManagementUseCase } from './organization-management.service.js'

const statusSchema = Type.Union([Type.Literal('ACTIVE'), Type.Literal('INACTIVE')])

const codeSchema = Type.String({
  minLength: 1,
  maxLength: 50,
  pattern: '^[A-Za-z0-9._-]+$',
})

const nameSchema = Type.String({
  minLength: 2,
  maxLength: 255,
})

const idParamsSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
})

const createFacultyBodySchema = Type.Object(
  { code: codeSchema, name: nameSchema },
  { additionalProperties: false },
)

const createOrganizationalUnitBodySchema = createFacultyBodySchema

const updateFacultyBodySchema = Type.Object(
  {
    code: Type.Optional(codeSchema),
    name: Type.Optional(nameSchema),
    status: Type.Optional(statusSchema),
  },
  {
    additionalProperties: false,
    minProperties: 1,
  },
)

const updateOrganizationalUnitBodySchema = updateFacultyBodySchema

const createClassBodySchema = Type.Object(
  {
    facultyId: Type.String({ format: 'uuid' }),
    code: codeSchema,
    name: nameSchema,
  },
  { additionalProperties: false },
)

const updateClassBodySchema = Type.Object(
  {
    facultyId: Type.Optional(Type.String({ format: 'uuid' })),
    code: Type.Optional(codeSchema),
    name: Type.Optional(nameSchema),
    status: Type.Optional(statusSchema),
  },
  {
    additionalProperties: false,
    minProperties: 1,
  },
)

const setAdvisorBodySchema = Type.Object(
  {
    advisorUserId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    effectiveAt: Type.Optional(Type.String({ format: 'date-time' })),
  },
  { additionalProperties: false },
)

const identitySchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  code: Type.String(),
  name: Type.String(),
  status: statusSchema,
})

const advisorSchema = Type.Object({
  userId: Type.String({ format: 'uuid' }),
  username: Type.String(),
  fullName: Type.String(),
  email: Type.Union([Type.String(), Type.Null()]),
})

const snapshotResponseSchema = Type.Object({
  faculties: Type.Array(
    Type.Composite([
      identitySchema,
      Type.Object({
        canManage: Type.Boolean(),
        canCreateClass: Type.Boolean(),
        classes: Type.Array(
          Type.Composite([
            identitySchema,
            Type.Object({
              canManage: Type.Boolean(),
              currentAdvisor: Type.Union([
                Type.Composite([
                  advisorSchema,
                  Type.Object({
                    assignmentId: Type.String({ format: 'uuid' }),
                    validFrom: Type.String({ format: 'date-time' }),
                  }),
                ]),
                Type.Null(),
              ]),
            }),
          ]),
        ),
      }),
    ]),
  ),
  organizationalUnits: Type.Array(
    Type.Composite([identitySchema, Type.Object({ canManage: Type.Boolean() })]),
  ),
  advisors: Type.Array(advisorSchema),
  capabilities: Type.Object({
    canCreateFaculty: Type.Boolean(),
    canCreateOrganizationalUnit: Type.Boolean(),
  }),
})

const createdResponseSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
})

const errorResponseSchema = Type.Object({
  message: Type.String(),
})

const fieldErrorResponseSchema = Type.Object({
  error: Type.Object({
    code: Type.String(),
    field: Type.String(),
    message: Type.String(),
  }),
  requestId: Type.String(),
})

type IdParams = Static<typeof idParamsSchema>
type CreateFacultyBody = Static<typeof createFacultyBodySchema>
type UpdateFacultyBody = Static<typeof updateFacultyBodySchema>
type CreateOrganizationalUnitBody = Static<typeof createOrganizationalUnitBodySchema>
type UpdateOrganizationalUnitBody = Static<typeof updateOrganizationalUnitBodySchema>
type CreateClassBody = Static<typeof createClassBodySchema>
type UpdateClassBody = Static<typeof updateClassBodySchema>
type SetAdvisorBody = Static<typeof setAdvisorBodySchema>

export interface OrganizationManagementRoutesOptions extends FastifyPluginOptions {
  organizationManagementService: OrganizationManagementUseCase
  authorizationService: AuthorizationUseCase
}

export async function organizationManagementRoutes(
  app: FastifyInstance,
  options: OrganizationManagementRoutesOptions,
) {
  const guards = [
    requireAdminSession,
    requireAdminReadySession,
    requireAdminPermission(options.authorizationService, 'organization.manage'),
  ]

  app.get(
    '/organization-management',
    {
      preHandler: guards,
      schema: {
        response: {
          200: snapshotResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const session = request.adminSession
      if (!session) {
        return reply.code(401).send({ message: 'Unauthorized' })
      }

      return options.organizationManagementService.getSnapshot(session.sub)
    },
  )

  app.post<{ Body: CreateFacultyBody }>(
    '/faculties',
    {
      preHandler: guards,
      schema: {
        body: createFacultyBodySchema,
        response: {
          201: createdResponseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          409: fieldErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const session = request.adminSession
      if (!session) {
        return reply.code(401).send({ message: 'Unauthorized' })
      }

      try {
        const result = await options.organizationManagementService.createFaculty({
          actor: {
            userId: session.sub,
            username: session.username,
          },
          audit: getAuditRequestContext(request),
          code: request.body.code,
          name: request.body.name,
        })
        return reply.code(201).send(result)
      } catch (error: unknown) {
        return sendOrganizationError(error, request.id, reply)
      }
    },
  )

  app.patch<{ Params: IdParams; Body: UpdateFacultyBody }>(
    '/faculties/:id',
    {
      preHandler: guards,
      schema: {
        params: idParamsSchema,
        body: updateFacultyBodySchema,
        response: {
          204: Type.Null(),
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: fieldErrorResponseSchema,
          409: fieldErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const session = request.adminSession
      if (!session) {
        return reply.code(401).send({ message: 'Unauthorized' })
      }

      try {
        await options.organizationManagementService.updateFaculty({
          actor: {
            userId: session.sub,
            username: session.username,
          },
          audit: getAuditRequestContext(request),
          facultyId: request.params.id,
          ...request.body,
        })
        return reply.code(204).send()
      } catch (error: unknown) {
        return sendOrganizationError(error, request.id, reply)
      }
    },
  )

  app.post<{ Body: CreateOrganizationalUnitBody }>(
    '/organizational-units',
    {
      preHandler: guards,
      schema: {
        body: createOrganizationalUnitBodySchema,
        response: {
          201: createdResponseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          409: fieldErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const session = request.adminSession
      if (!session) {
        return reply.code(401).send({ message: 'Unauthorized' })
      }

      try {
        const result = await options.organizationManagementService.createOrganizationalUnit({
          actor: {
            userId: session.sub,
            username: session.username,
          },
          audit: getAuditRequestContext(request),
          code: request.body.code,
          name: request.body.name,
        })
        return reply.code(201).send(result)
      } catch (error: unknown) {
        return sendOrganizationError(error, request.id, reply)
      }
    },
  )

  app.patch<{
    Params: IdParams
    Body: UpdateOrganizationalUnitBody
  }>(
    '/organizational-units/:id',
    {
      preHandler: guards,
      schema: {
        params: idParamsSchema,
        body: updateOrganizationalUnitBodySchema,
        response: {
          204: Type.Null(),
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: fieldErrorResponseSchema,
          409: fieldErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const session = request.adminSession
      if (!session) {
        return reply.code(401).send({ message: 'Unauthorized' })
      }

      try {
        await options.organizationManagementService.updateOrganizationalUnit({
          actor: {
            userId: session.sub,
            username: session.username,
          },
          audit: getAuditRequestContext(request),
          organizationalUnitId: request.params.id,
          ...request.body,
        })
        return reply.code(204).send()
      } catch (error: unknown) {
        return sendOrganizationError(error, request.id, reply)
      }
    },
  )

  app.post<{ Body: CreateClassBody }>(
    '/academic-classes',
    {
      preHandler: guards,
      schema: {
        body: createClassBodySchema,
        response: {
          201: createdResponseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: fieldErrorResponseSchema,
          409: fieldErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const session = request.adminSession
      if (!session) {
        return reply.code(401).send({ message: 'Unauthorized' })
      }

      try {
        const result = await options.organizationManagementService.createAcademicClass({
          actor: {
            userId: session.sub,
            username: session.username,
          },
          audit: getAuditRequestContext(request),
          ...request.body,
        })
        return reply.code(201).send(result)
      } catch (error: unknown) {
        return sendOrganizationError(error, request.id, reply)
      }
    },
  )

  app.patch<{ Params: IdParams; Body: UpdateClassBody }>(
    '/academic-classes/:id',
    {
      preHandler: guards,
      schema: {
        params: idParamsSchema,
        body: updateClassBodySchema,
        response: {
          204: Type.Null(),
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: fieldErrorResponseSchema,
          409: fieldErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const session = request.adminSession
      if (!session) {
        return reply.code(401).send({ message: 'Unauthorized' })
      }

      try {
        await options.organizationManagementService.updateAcademicClass({
          actor: {
            userId: session.sub,
            username: session.username,
          },
          audit: getAuditRequestContext(request),
          classId: request.params.id,
          ...request.body,
        })
        return reply.code(204).send()
      } catch (error: unknown) {
        return sendOrganizationError(error, request.id, reply)
      }
    },
  )

  app.put<{ Params: IdParams; Body: SetAdvisorBody }>(
    '/academic-classes/:id/advisor',
    {
      preHandler: guards,
      schema: {
        params: idParamsSchema,
        body: setAdvisorBodySchema,
        response: {
          204: Type.Null(),
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: fieldErrorResponseSchema,
          409: fieldErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const session = request.adminSession
      if (!session) {
        return reply.code(401).send({ message: 'Unauthorized' })
      }

      try {
        await options.organizationManagementService.setAcademicAdvisor({
          actor: {
            userId: session.sub,
            username: session.username,
          },
          audit: getAuditRequestContext(request),
          classId: request.params.id,
          advisorUserId: request.body.advisorUserId,
          effectiveAt: request.body.effectiveAt ? new Date(request.body.effectiveAt) : new Date(),
        })
        return reply.code(204).send()
      } catch (error: unknown) {
        return sendOrganizationError(error, request.id, reply)
      }
    },
  )
}

function sendOrganizationError(error: unknown, requestId: string, reply: FastifyReply) {
  if (error instanceof OrganizationForbiddenError) {
    return reply.code(403).send({ message: 'Forbidden' })
  }

  if (error instanceof OrganizationNotFoundError) {
    return reply.code(404).send({
      error: {
        code: 'NOT_FOUND',
        field: error.field,
        message: error.message,
      },
      requestId,
    })
  }

  if (error instanceof OrganizationConflictError || error instanceof OrganizationInactiveError) {
    return reply.code(409).send({
      error: {
        code: 'CONFLICT',
        field: error.field,
        message: error.message,
      },
      requestId,
    })
  }

  throw error
}
