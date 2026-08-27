import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import rateLimit from '@fastify/rate-limit'
import Fastify from 'fastify'
import helmet from '@fastify/helmet'
import { adminAuthRoutes,} from './modules/auth/auth.routes.js'
import { ADMIN_API_PREFIX,ADMIN_SESSION_COOKIE_NAME,} from './modules/auth/auth.constants.js'
import { env } from './config/env.js'
import { serviceRoutes,} from './modules/services/service.routes.js'
import {configureGlobalErrorHandler,} from './http/error-handler.js'

export function buildApp() {
  const app = Fastify({
    logger: true,
  })

  // Request decorators
  app.decorateRequest(
    'adminSession',
    null,
  )

  // Global error handling
  configureGlobalErrorHandler(app)

  // Global plugins
  app.register(cors, {
    origin: env.corsOrigin,
    credentials: true,
  })

  app.register(helmet)

  app.register(cookie)

  app.register(jwt, {
    secret: env.jwtSecret,

    cookie: {
      cookieName:
        ADMIN_SESSION_COOKIE_NAME,
      signed: false,
    },
  })

  app.register(rateLimit, {
    global: false,
  })

  // Feature routes
  app.register(
    adminAuthRoutes,
    {
      prefix: ADMIN_API_PREFIX,
    },
  )

  app.register(serviceRoutes)

  return app
}