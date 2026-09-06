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
} from './admin-auth.guard.js'
import { requireAdminPermission } from './admin-permission.guard.js'
import type { AuthorizationUseCase } from './authorization.service.js'
import {
  RolePermissionConflictError,
  RolePermissionForbiddenError,
  RolePermissionNotFoundError,
} from './role-permission.repository.js'
import type { RolePermissionUseCase } from './role-permission.service.js'

const roleParamsSchema = Type.Object({
  id: Type.Integer({ minimum: 1 }),
})

const replacePermissionsBodySchema = Type.Object(
  {
    permissionCodes: Type.Array(
      Type.String({ minLength: 1, maxLength: 100 }),
      { maxItems: 100, uniqueItems: true },
    ),
  },
  { additionalProperties: false },
)

const snapshotResponseSchema = Type.Object({
  roles: Type.Array(Type.Object({
    id: Type.Integer(),
    code: Type.String(),
    name: Type.String(),
    description: Type.Union([Type.String(), Type.Null()]),
    permissionCodes: Type.Array(Type.String()),
    canManage: Type.Boolean(),
  })),
  permissions: Type.Array(Type.Object({
    id: Type.Integer(),
    code: Type.String(),
    name: Type.String(),
    description: Type.Union([Type.String(), Type.Null()]),
  })),
})

const errorResponseSchema = Type.Object({ message: Type.String() })
const fieldErrorResponseSchema = Type.Object({
  error: Type.Object({
    code: Type.String(),
    field: Type.String(),
    message: Type.String(),
  }),
  requestId: Type.String(),
})

type RoleParams = Static<typeof roleParamsSchema>
type ReplacePermissionsBody = Static<typeof replacePermissionsBodySchema>

export interface RolePermissionRoutesOptions extends FastifyPluginOptions {
  rolePermissionService: RolePermissionUseCase
  authorizationService: AuthorizationUseCase
}

export async function rolePermissionRoutes(
  app: FastifyInstance,
  options: RolePermissionRoutesOptions,
) {
  const guards = [
    requireAdminSession,
    requireAdminReadySession,
    requireAdminPermission(options.authorizationService, 'role.manage'),
  ]

  app.get(
    '/role-permissions',
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

      try {
        return await options.rolePermissionService.getSnapshot(session.sub)
      } catch (error: unknown) {
        return sendRolePermissionError(error, request.id, reply)
      }
    },
  )

  app.put<{ Params: RoleParams, Body: ReplacePermissionsBody }>(
    '/roles/:id/permissions',
    {
      preHandler: guards,
      schema: {
        params: roleParamsSchema,
        body: replacePermissionsBodySchema,
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
        await options.rolePermissionService.replacePermissions({
          actor: {
            userId: session.sub,
            username: session.username,
          },
          audit: getAuditRequestContext(request),
          roleId: request.params.id,
          permissionCodes: request.body.permissionCodes,
        })
        return reply.code(204).send()
      } catch (error: unknown) {
        return sendRolePermissionError(error, request.id, reply)
      }
    },
  )
}

function sendRolePermissionError(
  error: unknown,
  requestId: string,
  reply: FastifyReply,
) {
  if (error instanceof RolePermissionForbiddenError) {
    return reply.code(403).send({ message: 'Forbidden' })
  }
  if (error instanceof RolePermissionNotFoundError) {
    return reply.code(404).send({
      error: {
        code: 'NOT_FOUND',
        field: error.field,
        message: error.message,
      },
      requestId,
    })
  }
  if (error instanceof RolePermissionConflictError) {
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
