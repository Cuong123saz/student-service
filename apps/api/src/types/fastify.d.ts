import 'fastify'
import type {
  AdminSession,
} from '../modules/auth/auth-session.js'

declare module 'fastify' {
  interface FastifyRequest {
    adminSession: AdminSession | null
  }
}