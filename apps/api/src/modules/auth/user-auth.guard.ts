import type {
  FastifyReply,
  FastifyRequest,
} from 'fastify'

import {
  JWT_ISSUER,
  USER_JWT_AUDIENCE,
  USER_SESSION_COOKIE_NAME,
} from './auth.constants.js'

import {
  isUserSession,
} from './auth-session.js'

const USER_PORTAL_ROLES =
  new Set([
    'STUDENT',
    'ACADEMIC_ADVISOR',
    'FACULTY_REVIEWER',
    'DOCUMENT_SIGNER',
  ])

export async function requireUserSession(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const token =
    request.cookies[
      USER_SESSION_COOKIE_NAME
    ]

  if (!token) {
    return reply.code(401).send({
      message: 'Unauthorized',
    })
  }

  let decoded: unknown

  try {
    decoded =
      request.server.jwt.verify(
        token,
        {
          allowedAud:
            USER_JWT_AUDIENCE,

          allowedIss:
            JWT_ISSUER,
        },
      )
  } catch {
    return reply.code(401).send({
      message: 'Unauthorized',
    })
  }

  if (!isUserSession(decoded)) {
    return reply.code(401).send({
      message: 'Unauthorized',
    })
  }

  const hasUserPortalRole =
    decoded.roles.some(
      (role) =>
        USER_PORTAL_ROLES.has(
          role,
        ),
    )

  if (!hasUserPortalRole) {
    return reply.code(403).send({
      message: 'Forbidden',
    })
  }

  request.userSession = decoded
}