import { Type } from '@sinclair/typebox'
import type {
  FastifyInstance,
  FastifyPluginOptions,
} from 'fastify'

import {
  requireAdminReadySession,
  requireAdminSession,
} from '../auth/admin-auth.guard.js'
import {
  requireAdminPermission,
} from '../auth/admin-permission.guard.js'
import type {
  AuthorizationUseCase,
} from '../auth/authorization.service.js'
import type {
  AcademicCatalogUseCase,
} from './academic-catalog.service.js'

const identitySchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  code: Type.String(),
  name: Type.String(),
})

const catalogResponseSchema = Type.Object({
  faculties: Type.Array(
    Type.Composite([
      identitySchema,
      Type.Object({
        classes: Type.Array(identitySchema),
      }),
    ]),
  ),
})

const errorResponseSchema = Type.Object({
  message: Type.String(),
})

export interface AcademicCatalogRoutesOptions
extends FastifyPluginOptions {
  academicCatalogService:
    AcademicCatalogUseCase
  authorizationService:
    AuthorizationUseCase
}

export async function academicCatalogRoutes(
  app: FastifyInstance,
  options: AcademicCatalogRoutesOptions,
) {
  app.get(
    '/academic-catalog',
    {
      preHandler: [
        requireAdminSession,
        requireAdminReadySession,
        requireAdminPermission(
          options.authorizationService,
          'student.read',
        ),
      ],
      schema: {
        response: {
          200: catalogResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const session = request.adminSession

      if (!session) {
        return reply.code(401).send({
          message: 'Unauthorized',
        })
      }

      const faculties = await options
        .academicCatalogService
        .listVisibleCatalog(session.sub)

      return { faculties }
    },
  )
}
