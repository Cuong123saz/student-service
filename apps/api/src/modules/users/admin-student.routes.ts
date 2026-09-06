import {
  type Static,
  Type,
} from '@sinclair/typebox'
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
  AdminStudentUseCase,
} from './admin-student.service.js'

const listStudentsQuerySchema = Type.Object(
  {
    limit: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 100,
        default: 20,
      }),
    ),
    after: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 50,
      }),
    ),
    status: Type.Optional(
      Type.Union([
        Type.Literal('INVITED'),
        Type.Literal('ACTIVE'),
        Type.Literal('INACTIVE'),
        Type.Literal('SUSPENDED'),
      ]),
    ),
    facultyId: Type.Optional(
      Type.String({ format: 'uuid' }),
    ),
    classId: Type.Optional(
      Type.String({ format: 'uuid' }),
    ),
    search: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 100,
      }),
    ),
  },
  { additionalProperties: false },
)

type ListStudentsQuery = Static<
  typeof listStudentsQuerySchema
>

const studentSchema = Type.Object({
  userId: Type.String({ format: 'uuid' }),
  username: Type.String(),
  fullName: Type.String(),
  email: Type.Union([
    Type.String(),
    Type.Null(),
  ]),
  status: Type.String(),
  studentCode: Type.String(),
  academicClass: Type.Object({
    id: Type.String({ format: 'uuid' }),
    code: Type.String(),
    name: Type.String(),
  }),
  faculty: Type.Object({
    id: Type.String({ format: 'uuid' }),
    code: Type.String(),
    name: Type.String(),
  }),
})

const responseSchema = Type.Object({
  students: Type.Array(studentSchema),
  nextCursor: Type.Union([
    Type.String(),
    Type.Null(),
  ]),
})

const errorResponseSchema = Type.Object({
  message: Type.String(),
})

export interface AdminStudentRoutesOptions
extends FastifyPluginOptions {
  studentService: AdminStudentUseCase
  authorizationService:
    AuthorizationUseCase
}

export async function adminStudentRoutes(
  app: FastifyInstance,
  options: AdminStudentRoutesOptions,
) {
  app.get<{
    Querystring: ListStudentsQuery
  }>(
    '/students',
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
        querystring: listStudentsQuerySchema,
        response: {
          200: responseSchema,
          400: errorResponseSchema,
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

      return options.studentService
        .listVisibleStudents({
          actorUserId: session.sub,
          limit: request.query.limit ?? 20,
          ...(request.query.after
            ? {
                afterStudentCode:
                  request.query.after,
              }
            : {}),
          ...(request.query.status
            ? { status: request.query.status }
            : {}),
          ...(request.query.facultyId
            ? {
                facultyId:
                  request.query.facultyId,
              }
            : {}),
          ...(request.query.classId
            ? {
                classId:
                  request.query.classId,
              }
            : {}),
          ...(request.query.search
            ? { search: request.query.search }
            : {}),
        })
    },
  )
}
