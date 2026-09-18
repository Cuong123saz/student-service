import type { FastifyReply, FastifyRequest } from 'fastify'

import type { SystemPermissionCode } from './authorization.constants.js'
import type { AuthorizationUseCase } from './authorization.service.js'

export function requireAdminPermission(
  authorizationService: AuthorizationUseCase,
  permission: SystemPermissionCode,
) {
  return async function checkAdminPermission(request: FastifyRequest, reply: FastifyReply) {
    const session = request.adminSession

    if (!session) {
      return reply.code(401).send({
        message: 'Unauthorized',
      })
    }

    const allowed = await authorizationService.hasPermission({
      userId: session.sub,
      permission,
    })

    if (!allowed) {
      return reply.code(403).send({
        message: 'Forbidden',
      })
    }
  }
}
