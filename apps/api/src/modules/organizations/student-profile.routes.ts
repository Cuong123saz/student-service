import { Type } from '@sinclair/typebox'
import type {
  FastifyInstance,
  FastifyPluginOptions,
} from 'fastify'

import {
  requireStudentRole,
  requireUserSession,
} from '../auth/user-auth.guard.js'
import {
  StudentProfileNotFoundError,
  type StudentProfileUseCase,
} from './student-profile.service.js'

const identitySchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  code: Type.String(),
  name: Type.String(),
})

const errorResponseSchema = Type.Object({
  message: Type.String(),
})

const profileResponseSchema = Type.Object({
  profile: Type.Object({
    userId: Type.String({ format: 'uuid' }),
    username: Type.String(),
    fullName: Type.String(),
    email: Type.Union([
      Type.String({ format: 'email' }),
      Type.Null(),
    ]),
    studentCode: Type.String(),
    class: identitySchema,
    faculty: identitySchema,
  }),
})

const advisorResponseSchema = Type.Object({
  assignmentStatus: Type.Union([
    Type.Literal('ASSIGNED'),
    Type.Literal('UNASSIGNED'),
  ]),
  advisor: Type.Union([
    Type.Object({
      userId: Type.String({ format: 'uuid' }),
      username: Type.String(),
      fullName: Type.String(),
      email: Type.Union([
        Type.String({ format: 'email' }),
        Type.Null(),
      ]),
      class: identitySchema,
      validFrom: Type.String({ format: 'date-time' }),
      validTo: Type.Union([
        Type.String({ format: 'date-time' }),
        Type.Null(),
      ]),
    }),
    Type.Null(),
  ]),
})

export interface StudentProfileRoutesOptions
extends FastifyPluginOptions {
  studentProfileService:
    StudentProfileUseCase
}

export async function studentProfileRoutes(
  app: FastifyInstance,
  options: StudentProfileRoutesOptions,
) {
  app.get(
    '/profile',
    {
      preHandler: [
        requireUserSession,
        requireStudentRole,
      ],
      schema: {
        response: {
          200: profileResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const profile = await options
          .studentProfileService
          .getProfile(
            request.userSession!.sub,
          )

        return { profile }
      } catch (error: unknown) {
        if (
          error
          instanceof StudentProfileNotFoundError
        ) {
          return reply.code(404).send({
            message: error.message,
          })
        }

        throw error
      }
    },
  )

  app.get(
    '/advisor',
    {
      preHandler: [
        requireUserSession,
        requireStudentRole,
      ],
      schema: {
        response: {
          200: advisorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const advisor = await options
          .studentProfileService
          .getCurrentAdvisor(
            request.userSession!.sub,
          )

        return {
          assignmentStatus:
            advisor ? 'ASSIGNED' : 'UNASSIGNED',
          advisor: advisor
            ? {
                ...advisor,
                validFrom:
                  advisor.validFrom.toISOString(),
                validTo:
                  advisor.validTo?.toISOString()
                  ?? null,
              }
            : null,
        }
      } catch (error: unknown) {
        if (
          error instanceof StudentProfileNotFoundError
        ) {
          return reply.code(404).send({
            message: error.message,
          })
        }

        throw error
      }
    },
  )
}
