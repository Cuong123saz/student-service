import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import jwt from '@fastify/jwt'
import multipart from '@fastify/multipart'
import rateLimit from '@fastify/rate-limit'
import Fastify from 'fastify'

import { env } from './config/env.js'
import { configureGlobalErrorHandler } from './http/error-handler.js'
import { createNodemailerTransport } from './infrastructure/mail/nodemailer-transport.js'
import { DrizzleAuditLogRepository } from './modules/audit/audit.repository.js'
import { auditRoutes } from './modules/audit/audit.routes.js'
import { AuditLogService, type AuditLogUseCase } from './modules/audit/audit.service.js'
import {
  ADMIN_API_PREFIX,
  ADMIN_SESSION_COOKIE_NAME,
  USER_API_PREFIX,
} from './modules/auth/auth.constants.js'
import { adminAuthRoutes } from './modules/auth/auth.routes.js'
import { DrizzleAuthorizationRepository } from './modules/auth/authorization.repository.js'
import {
  AuthorizationService,
  type AuthorizationUseCase,
} from './modules/auth/authorization.service.js'
import { DrizzleRolePermissionRepository } from './modules/auth/role-permission.repository.js'
import { rolePermissionRoutes } from './modules/auth/role-permission.routes.js'
import {
  RolePermissionService,
  type RolePermissionUseCase,
} from './modules/auth/role-permission.service.js'
import type { AuthenticationUseCase } from './modules/auth/auth.service.js'
import { Argon2PasswordHasher } from './modules/auth/password-hasher.js'
import { userAuthRoutes } from './modules/auth/user-auth.routes.js'
import { DrizzleStudentProfileRepository } from './modules/organizations/student-profile.repository.js'
import { DrizzleAcademicCatalogRepository } from './modules/organizations/academic-catalog.repository.js'
import { academicCatalogRoutes } from './modules/organizations/academic-catalog.routes.js'
import {
  AcademicCatalogService,
  type AcademicCatalogUseCase,
} from './modules/organizations/academic-catalog.service.js'
import { DrizzleOrganizationManagementRepository } from './modules/organizations/organization-management.repository.js'
import { organizationManagementRoutes } from './modules/organizations/organization-management.routes.js'
import {
  OrganizationManagementService,
  type OrganizationManagementUseCase,
} from './modules/organizations/organization-management.service.js'
import { studentProfileRoutes } from './modules/organizations/student-profile.routes.js'
import {
  StudentProfileService,
  type StudentProfileUseCase,
} from './modules/organizations/student-profile.service.js'
import { serviceRoutes } from './modules/services/service.routes.js'
import { DrizzleAccountActivationRepository } from './modules/users/account-activation.repository.js'
import { accountActivationRoutes } from './modules/users/account-activation.routes.js'
import {
  AccountActivationService,
  type AccountActivationUseCase,
} from './modules/users/account-activation.service.js'
import { adminUserRoutes } from './modules/users/admin-user.routes.js'
import { DrizzleAdminStudentRepository } from './modules/users/admin-student.repository.js'
import { adminStudentRoutes } from './modules/users/admin-student.routes.js'
import {
  AdminStudentService,
  type AdminStudentUseCase,
} from './modules/users/admin-student.service.js'
import { DrizzleStudentExportRepository } from './modules/users/student-export.repository.js'
import { studentExportRoutes } from './modules/users/student-export.routes.js'
import {
  StudentExportService,
  type StudentExportUseCase,
} from './modules/users/student-export.service.js'
import { DrizzleStudentImportRepository } from './modules/users/student-import.repository.js'
import { STUDENT_IMPORT_MAX_FILE_BYTES } from './modules/users/student-import.parser.js'
import { studentImportRoutes } from './modules/users/student-import.routes.js'
import {
  StudentImportService,
  type StudentImportUseCase,
} from './modules/users/student-import.service.js'
import { DrizzleStudentImportPreviewStore } from './modules/users/student-import-preview.repository.js'
import { DrizzleStudentImportProcessingJobRepository } from './modules/users/student-import-processing-job.repository.js'
import {
  StudentImportProcessingJobService,
  type StudentImportProcessingJobUseCase,
} from './modules/users/student-import-processing-job.service.js'
import { SmtpInvitationMailer } from './modules/users/smtp-invitation-mailer.js'
import { DrizzleUserInvitationRepository } from './modules/users/user-invitation.repository.js'
import {
  UserInvitationService,
  type UserInvitationUseCase,
} from './modules/users/user-invitation.service.js'
import { DrizzleUserAccessRepository } from './modules/users/user-access.repository.js'
import { userAccessRoutes } from './modules/users/user-access.routes.js'
import { UserAccessService, type UserAccessUseCase } from './modules/users/user-access.service.js'

import { DrizzleProcedureRepository } from './modules/procedures/procedure.repository.js'
import { ProcedureService, type ProcedureUseCase } from './modules/procedures/procedure.service.js'
import {
  procedureAdminRoutes,
  procedurePublicRoutes,
} from './modules/procedures/procedure.routes.js'
import { DrizzleSubmissionRepository } from './modules/submissions/submission.repository.js'
import { SubmissionService } from './modules/submissions/submission.service.js'
import { LocalEvidenceStorage } from './modules/submissions/submission.storage.js'
import { submissionRoutes } from './modules/submissions/submission.routes.js'
import { submissionReviewRoutes } from './modules/submissions/submission-review.routes.js'
export interface BuildAppOptions {
  submissionService?: SubmissionService
  procedureService?: ProcedureUseCase
  userInvitationService?: UserInvitationUseCase

  accountActivationService?: AccountActivationUseCase

  userAuthenticationService?: AuthenticationUseCase

  studentProfileService?: StudentProfileUseCase

  auditLogService?: AuditLogUseCase

  authorizationService?: AuthorizationUseCase

  adminStudentService?: AdminStudentUseCase

  studentImportService?: StudentImportUseCase

  studentImportProcessingJobService?: StudentImportProcessingJobUseCase

  studentExportService?: StudentExportUseCase

  academicCatalogService?: AcademicCatalogUseCase

  organizationManagementService?: OrganizationManagementUseCase

  userAccessService?: UserAccessUseCase

  rolePermissionService?: RolePermissionUseCase
}

function createDefaultUserInvitationService(): UserInvitationUseCase {
  const mailTransport = createNodemailerTransport()
  const invitationMailer = new SmtpInvitationMailer(mailTransport, env.mailFrom)

  return new UserInvitationService(
    new DrizzleUserInvitationRepository(),
    invitationMailer,
    env.webBaseUrl,
  )
}

export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: {
      redact: {
        paths: [
          'req.headers.cookie',
          'req.headers.authorization',
          'body.password',
          'body.currentPassword',
          'body.newPassword',
        ],
        censor: '[REDACTED]',
      },
    },
  })

  const accountActivationService =
    options.accountActivationService ??
    new AccountActivationService(
      new DrizzleAccountActivationRepository(app.log),
      new Argon2PasswordHasher(),
    )

  const invitationService = options.userInvitationService ?? createDefaultUserInvitationService()

  const studentProfileService =
    options.studentProfileService ??
    new StudentProfileService(new DrizzleStudentProfileRepository())

  const auditLogService =
    options.auditLogService ?? new AuditLogService(new DrizzleAuditLogRepository())

  const authorizationService =
    options.authorizationService ?? new AuthorizationService(new DrizzleAuthorizationRepository())

  const adminStudentService =
    options.adminStudentService ?? new AdminStudentService(new DrizzleAdminStudentRepository())

  const studentImportService =
    options.studentImportService ??
    new StudentImportService(
      new DrizzleStudentImportRepository(),
      new DrizzleStudentImportPreviewStore(),
    )

  const studentImportProcessingJobService =
    options.studentImportProcessingJobService ??
    new StudentImportProcessingJobService(
      new DrizzleStudentImportProcessingJobRepository(),
      studentImportService,
    )

  const studentExportService =
    options.studentExportService ??
    new StudentExportService(new DrizzleStudentExportRepository(), auditLogService)

  const academicCatalogService =
    options.academicCatalogService ??
    new AcademicCatalogService(new DrizzleAcademicCatalogRepository())

  const organizationManagementService =
    options.organizationManagementService ??
    new OrganizationManagementService(new DrizzleOrganizationManagementRepository())

  const userAccessService =
    options.userAccessService ?? new UserAccessService(new DrizzleUserAccessRepository())

  const rolePermissionService =
    options.rolePermissionService ??
    new RolePermissionService(new DrizzleRolePermissionRepository())

  app.decorateRequest('adminSession', null)

  app.decorateRequest('userSession', null)

  configureGlobalErrorHandler(app)

  app.register(cors, {
    origin: env.corsOrigin,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    credentials: true,
  })

  app.register(helmet)
  app.register(cookie)
  app.register(multipart, {
    limits: {
      files: 1,
      parts: 1,
      fileSize: STUDENT_IMPORT_MAX_FILE_BYTES,
    },
    throwFileSizeLimit: true,
  })

  app.register(jwt, {
    secret: env.jwtSecret,
    cookie: {
      cookieName: ADMIN_SESSION_COOKIE_NAME,
      signed: false,
    },
  })

  app.register(rateLimit, {
    global: false,
  })

  app.register(accountActivationRoutes, {
    prefix: '/api/v1',
    activationService: accountActivationService,
  })

  app.register(userAuthRoutes, {
    prefix: USER_API_PREFIX,
    ...(options.userAuthenticationService === undefined
      ? {}
      : {
          authenticationService: options.userAuthenticationService,
        }),
  })

  app.register(studentProfileRoutes, {
    prefix: USER_API_PREFIX,
    studentProfileService,
  })

  app.register(adminAuthRoutes, {
    prefix: ADMIN_API_PREFIX,
    auditRecorder: auditLogService,
  })

  app.register(adminUserRoutes, {
    prefix: ADMIN_API_PREFIX,
    invitationService,
    auditRecorder: auditLogService,
    authorizationService,
  })

  app.register(auditRoutes, {
    prefix: ADMIN_API_PREFIX,
    auditLogService,
    authorizationService,
  })

  app.register(adminStudentRoutes, {
    prefix: ADMIN_API_PREFIX,
    studentService: adminStudentService,
    authorizationService,
  })

  app.register(studentImportRoutes, {
    prefix: ADMIN_API_PREFIX,
    studentImportService,
    studentImportProcessingJobService,
    authorizationService,
  })

  app.register(studentExportRoutes, {
    prefix: ADMIN_API_PREFIX,
    studentExportService,
    authorizationService,
  })

  app.register(academicCatalogRoutes, {
    prefix: ADMIN_API_PREFIX,
    academicCatalogService,
    authorizationService,
  })

  app.register(organizationManagementRoutes, {
    prefix: ADMIN_API_PREFIX,
    organizationManagementService,
    authorizationService,
  })

  app.register(userAccessRoutes, {
    prefix: ADMIN_API_PREFIX,
    userAccessService,
    authorizationService,
  })

  app.register(rolePermissionRoutes, {
    prefix: ADMIN_API_PREFIX,
    rolePermissionService,
    authorizationService,
  })

  const procedureService =
    options.procedureService ?? new ProcedureService(new DrizzleProcedureRepository())
  app.register(procedureAdminRoutes, {
    prefix: ADMIN_API_PREFIX,
    procedureService,
    authorizationService,
  })
  app.register(procedurePublicRoutes, { procedureService })
  const submissionService =
    options.submissionService ??
    new SubmissionService(new DrizzleSubmissionRepository(), new LocalEvidenceStorage())
  app.register(submissionRoutes, { prefix: USER_API_PREFIX, submissionService })
  app.register(submissionReviewRoutes, {
    prefix: USER_API_PREFIX,
    submissionService,
    portal: 'user',
  })
  app.register(submissionReviewRoutes, {
    prefix: ADMIN_API_PREFIX,
    submissionService,
    portal: 'admin',
  })
  app.register(serviceRoutes)

  return app
}
