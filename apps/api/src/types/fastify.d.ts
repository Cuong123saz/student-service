import 'fastify'

import type {
  AdminSession,
  UserSession,
} from '../modules/auth/auth-session.js'

declare module 'fastify' {
  interface FastifyRequest {
    adminSession:
      AdminSession | null

    userSession:
      UserSession | null
  }
}