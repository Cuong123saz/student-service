import type {
  FastifyRequest,
} from 'fastify'

export function getAuditRequestContext(
  request: FastifyRequest,
) {
  const userAgent =
    request.headers['user-agent']

  return {
    requestId: request.id,
    ipAddress: request.ip,
    userAgent:
      typeof userAgent === 'string'
        ? userAgent.slice(0, 512)
        : null,
  }
}
