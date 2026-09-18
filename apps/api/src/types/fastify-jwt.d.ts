import '@fastify/jwt'
import type { SessionTokenPayload } from '../modules/auth/auth-session.js'

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: SessionTokenPayload
    user: unknown
  }
}
