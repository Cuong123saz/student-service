import type {
  FastifyReply,
  FastifyRequest,
} from 'fastify'

import {
  ADMIN_JWT_AUDIENCE,
  JWT_ISSUER,
} from './auth.constants.js'
import { isAdminSession } from './auth-session.js'
export async function requireAdminSession(
  request: FastifyRequest,
  reply: FastifyReply,
) { 
     let decoded: unknown
   try {
   decoded = await request.jwtVerify({
      onlyCookie: true,
      allowedAud: ADMIN_JWT_AUDIENCE,
      allowedIss: JWT_ISSUER,
    })
  } catch {
    return reply.code(401).send({
      message: 'Unauthorized',
    })
  }

  if (!isAdminSession(decoded)) {
    return reply.code(401).send({
      message: 'Unauthorized',
    })
  }

  const hasAdminRole = decoded.roles.some(
    (role) =>
      role === 'ADMIN' ||
      role === 'SYSTEM_ADMIN',
  )

  if (!hasAdminRole) {
    return reply.code(403).send({
      message: 'Forbidden',
    })
  }
  request.adminSession = decoded
}
export async function requireAdminReadySession(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session =
    request.adminSession

  if (!session) {
    return reply.code(401).send({
      message: 'Unauthorized',
    })
  }

  if (session.mustChangePassword) {
    return reply.code(403).send({
      message:
        'Password change required',
    })
  }
}