import {
  type Static,
  Type,
} from '@sinclair/typebox'
import type {
  FastifyInstance,
  FastifyPluginOptions,
  FastifyReply,
} from 'fastify'

import { getAuditRequestContext } from '../audit/audit-request-context.js'
import {
  requireAdminReadySession,
  requireAdminSession,
} from '../auth/admin-auth.guard.js'
import { requireAdminPermission } from '../auth/admin-permission.guard.js'
import type { AuthorizationUseCase } from '../auth/authorization.service.js'
import { ForbiddenRoleAssignmentError } from './role-assignment-policy.js'
import {
  UserAccessConflictError,
  UserAccessForbiddenError,
  UserAccessNotFoundError,
  UserAccessValidationError,
} from './user-access.repository.js'
import type { UserAccessUseCase } from './user-access.service.js'

const systemRoleSchema = Type.Union([
  Type.Literal('SYSTEM_ADMIN'),
  Type.Literal('ADMIN'),
  Type.Literal('STUDENT'),
  Type.Literal('ACADEMIC_ADVISOR'),
  Type.Literal('FACULTY_REVIEWER'),
  Type.Literal('DOCUMENT_SIGNER'),
])

const scopeTypeSchema = Type.Union([
  Type.Literal('GLOBAL'),
  Type.Literal('FACULTY'),
  Type.Literal('CLASS'),
  Type.Literal('ORGANIZATION'),
])

const listQuerySchema = Type.Object({
  search: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
}, { additionalProperties: false })

const userParamsSchema = Type.Object({
  userId: Type.String({ format: 'uuid' }),
})

const replaceAssignmentsBodySchema = Type.Object({
  assignments: Type.Array(
    Type.Object({
      roleCode: systemRoleSchema,
      scopeIds: Type.Array(
        Type.String({ format: 'uuid' }),
        { maxItems: 100, uniqueItems: true },
      ),
    }, { additionalProperties: false }),
    { minItems: 1, maxItems: 6 },
  ),
}, { additionalProperties: false })

const assignmentSchema = Type.Object({
  roleCode: systemRoleSchema,
  roleName: Type.String(),
  scopeIds: Type.Array(Type.String({ format: 'uuid' })),
})

const snapshotSchema = Type.Object({
  users: Type.Array(Type.Object({
    id: Type.String({ format: 'uuid' }),
    username: Type.String(),
    fullName: Type.String(),
    email: Type.Union([Type.String(), Type.Null()]),
    status: Type.String(),
    studentCode: Type.Union([Type.String(), Type.Null()]),
    assignments: Type.Array(assignmentSchema),
    canManage: Type.Boolean(),
  })),
  roles: Type.Array(Type.Object({
    id: Type.Integer(),
    code: systemRoleSchema,
    name: Type.String(),
    description: Type.Union([Type.String(), Type.Null()]),
    allowedScopeTypes: Type.Array(scopeTypeSchema),
    permissions: Type.Array(Type.String()),
  })),
  scopes: Type.Array(Type.Object({
    id: Type.String({ format: 'uuid' }),
    type: scopeTypeSchema,
    label: Type.String(),
    targetId: Type.Union([
      Type.String({ format: 'uuid' }),
      Type.Null(),
    ]),
  })),
})

const errorSchema = Type.Object({ message: Type.String() })
const fieldErrorSchema = Type.Object({
  error: Type.Object({
    code: Type.String(),
    field: Type.String(),
    message: Type.String(),
  }),
  requestId: Type.String(),
})

type ListQuery = Static<typeof listQuerySchema>
type UserParams = Static<typeof userParamsSchema>
type ReplaceAssignmentsBody = Static<typeof replaceAssignmentsBodySchema>

export interface UserAccessRoutesOptions extends FastifyPluginOptions {
  userAccessService: UserAccessUseCase
  authorizationService: AuthorizationUseCase
}

export async function userAccessRoutes(
  app: FastifyInstance,
  options: UserAccessRoutesOptions,
) {
  const guards = [
    requireAdminSession,
    requireAdminReadySession,
    requireAdminPermission(
      options.authorizationService,
      'role.manage',
    ),
  ]

  app.get<{ Querystring: ListQuery }>(
    '/access-control',
    {
      preHandler: guards,
      schema: {
        querystring: listQuerySchema,
        response: {
          200: snapshotSchema,
          400: errorSchema,
          401: errorSchema,
          403: errorSchema,
        },
      },
    },
    async (request, reply) => {
      const session = request.adminSession
      if (!session) {
        return reply.code(401).send({ message: 'Unauthorized' })
      }
      return options.userAccessService.getSnapshot({
        actorUserId: session.sub,
        ...(request.query.search
          ? { search: request.query.search }
          : {}),
      })
    },
  )

  app.put<{
    Params: UserParams
    Body: ReplaceAssignmentsBody
  }>(
    '/access-control/users/:userId/assignments',
    {
      preHandler: guards,
      schema: {
        params: userParamsSchema,
        body: replaceAssignmentsBodySchema,
        response: {
          204: Type.Null(),
          400: Type.Union([errorSchema, fieldErrorSchema]),
          401: errorSchema,
          403: errorSchema,
          404: fieldErrorSchema,
          409: fieldErrorSchema,
          422: fieldErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const session = request.adminSession
      if (!session) {
        return reply.code(401).send({ message: 'Unauthorized' })
      }

      try {
        await options.userAccessService.replaceAssignments({
          actor: {
            userId: session.sub,
            username: session.username,
          },
          audit: getAuditRequestContext(request),
          targetUserId: request.params.userId,
          assignments: request.body.assignments.map(assignment => ({
            roleCode: assignment.roleCode,
            scopeIds: [...assignment.scopeIds],
          })),
        })
        return reply.code(204).send()
      } catch (error: unknown) {
        return sendUserAccessError(error, request.id, reply)
      }
    },
  )
}

function sendUserAccessError(
  error: unknown,
  requestId: string,
  reply: FastifyReply,
) {
  if (
    error instanceof UserAccessForbiddenError
    || error instanceof ForbiddenRoleAssignmentError
  ) return reply.code(403).send({ message: 'Forbidden' })

  if (error instanceof UserAccessNotFoundError) {
    return reply.code(404).send({
      error: {
        code: 'NOT_FOUND',
        field: error.field,
        message: error.message,
      },
      requestId,
    })
  }

  if (error instanceof UserAccessValidationError) {
    return reply.code(422).send({
      error: {
        code: 'VALIDATION_ERROR',
        field: error.field,
        message: error.message,
      },
      requestId,
    })
  }

  if (error instanceof UserAccessConflictError) {
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
