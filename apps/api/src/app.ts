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
import {  adminUserRoutes,} from './modules/users/admin-user.routes.js'
import { DrizzleUserInvitationRepository,} from './modules/users/user-invitation.repository.js'
import {UserInvitationService,type UserInvitationUseCase,} from './modules/users/user-invitation.service.js'
import { SmtpInvitationMailer,} from './modules/users/smtp-invitation-mailer.js'
import { createNodemailerTransport,} from './infrastructure/mail/nodemailer-transport.js'
import { Argon2PasswordHasher,} from './modules/auth/password-hasher.js'
import { accountActivationRoutes,} from './modules/users/account-activation.routes.js'
import {  DrizzleAccountActivationRepository,} from './modules/users/account-activation.repository.js'
import { AccountActivationService,type AccountActivationUseCase,} from './modules/users/account-activation.service.js'
import {USER_API_PREFIX,} from './modules/auth/auth.constants.js'
import { userAuthRoutes,} from './modules/auth/user-auth.routes.js'
import type {AuthenticationUseCase,} from './modules/auth/auth.service.js'
export interface BuildAppOptions {
  userInvitationService?:
    UserInvitationUseCase

  accountActivationService?:
    AccountActivationUseCase

  userAuthenticationService?:
    AuthenticationUseCase
}

function createDefaultUserInvitationService():
UserInvitationUseCase {
  const mailTransport =
    createNodemailerTransport()
  const invitationMailer =
    new SmtpInvitationMailer(
      mailTransport,
      env.mailFrom,
    )

  const invitationRepository =
    new DrizzleUserInvitationRepository()

  return new UserInvitationService(
    invitationRepository,
    invitationMailer,
    env.webBaseUrl,
  )
}
export function buildApp(
  options: BuildAppOptions = {},
) {
  const app = Fastify({
    logger: true,
  })
const accountActivationService =
  options.accountActivationService
  ?? new AccountActivationService(
    new DrizzleAccountActivationRepository(
      app.log,
    ),
    new Argon2PasswordHasher(),
  )
const invitationService =
  options.userInvitationService
  ?? createDefaultUserInvitationService()
  // Request decorators
// Request decorators
app.decorateRequest(
  'adminSession',
  null,
)

app.decorateRequest(
  'userSession',
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
  accountActivationRoutes,
  {
    prefix: '/api/v1',
    activationService:
      accountActivationService,
  },
)
app.register(
  userAuthRoutes,
  {
    prefix: USER_API_PREFIX,

    ...(
      options
        .userAuthenticationService
        === undefined
        ? {}
        : {
            authenticationService:
              options
                .userAuthenticationService,
          }
    ),
  },
)
app.register(
  adminAuthRoutes,
  {
    prefix: ADMIN_API_PREFIX,
  },
)
app.register(
  adminUserRoutes,
  {
    prefix: ADMIN_API_PREFIX,
    invitationService,
  },
)

app.register(serviceRoutes)
  return app

}