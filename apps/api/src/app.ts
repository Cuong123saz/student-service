import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import jwt from '@fastify/jwt'
import rateLimit from '@fastify/rate-limit'
import Fastify from 'fastify'

import { env } from './config/env.js'
import {
  configureGlobalErrorHandler,
} from './http/error-handler.js'
import {
  createNodemailerTransport,
} from './infrastructure/mail/nodemailer-transport.js'
import {
  DrizzleAuditLogRepository,
} from './modules/audit/audit.repository.js'
import {
  auditRoutes,
} from './modules/audit/audit.routes.js'
import {
  AuditLogService,
  type AuditLogUseCase,
} from './modules/audit/audit.service.js'
import {
  ADMIN_API_PREFIX,
  ADMIN_SESSION_COOKIE_NAME,
  USER_API_PREFIX,
} from './modules/auth/auth.constants.js'
import {
  adminAuthRoutes,
} from './modules/auth/auth.routes.js'
import type {
  AuthenticationUseCase,
} from './modules/auth/auth.service.js'
import {
  Argon2PasswordHasher,
} from './modules/auth/password-hasher.js'
import {
  userAuthRoutes,
} from './modules/auth/user-auth.routes.js'
import {
  DrizzleStudentProfileRepository,
} from './modules/organizations/student-profile.repository.js'
import {
  studentProfileRoutes,
} from './modules/organizations/student-profile.routes.js'
import {
  StudentProfileService,
  type StudentProfileUseCase,
} from './modules/organizations/student-profile.service.js'
import {
  serviceRoutes,
} from './modules/services/service.routes.js'
import {
  DrizzleAccountActivationRepository,
} from './modules/users/account-activation.repository.js'
import {
  accountActivationRoutes,
} from './modules/users/account-activation.routes.js'
import {
  AccountActivationService,
  type AccountActivationUseCase,
} from './modules/users/account-activation.service.js'
import {
  adminUserRoutes,
} from './modules/users/admin-user.routes.js'
import {
  SmtpInvitationMailer,
} from './modules/users/smtp-invitation-mailer.js'
import {
  DrizzleUserInvitationRepository,
} from './modules/users/user-invitation.repository.js'
import {
  UserInvitationService,
  type UserInvitationUseCase,
} from './modules/users/user-invitation.service.js'

export interface BuildAppOptions {
  userInvitationService?:
    UserInvitationUseCase

  accountActivationService?:
    AccountActivationUseCase

  userAuthenticationService?:
    AuthenticationUseCase

  studentProfileService?:
    StudentProfileUseCase

  auditLogService?: AuditLogUseCase
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

  return new UserInvitationService(
    new DrizzleUserInvitationRepository(),
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

  const studentProfileService =
    options.studentProfileService
    ?? new StudentProfileService(
      new DrizzleStudentProfileRepository(),
    )

  const auditLogService =
    options.auditLogService
    ?? new AuditLogService(
      new DrizzleAuditLogRepository(),
    )

  app.decorateRequest(
    'adminSession',
    null,
  )

  app.decorateRequest(
    'userSession',
    null,
  )

  configureGlobalErrorHandler(app)

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
        options.userAuthenticationService
          === undefined
          ? {}
          : {
              authenticationService:
                options.userAuthenticationService,
            }
      ),
    },
  )

  app.register(
    studentProfileRoutes,
    {
      prefix: USER_API_PREFIX,
      studentProfileService,
    },
  )

  app.register(
    adminAuthRoutes,
    {
      prefix: ADMIN_API_PREFIX,
      auditRecorder: auditLogService,
    },
  )

  app.register(
    adminUserRoutes,
    {
      prefix: ADMIN_API_PREFIX,
      invitationService,
      auditRecorder: auditLogService,
    },
  )

  app.register(
    auditRoutes,
    {
      prefix: ADMIN_API_PREFIX,
      auditLogService,
    },
  )

  app.register(serviceRoutes)

  return app
}
