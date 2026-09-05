import type {
  SystemRoleCode,
} from '../auth/auth.constants.js'

import type {
  InvitationMailer,
} from './invitation-mailer.js'

import {
  generateActionToken,
  type GeneratedActionToken,
} from './user-action-token.js'

import {
  assertCanAssignRoles,
  ForbiddenRoleAssignmentError,
} from './role-assignment-policy.js'

const ACCOUNT_ACTIVATION_TTL_MS =
  72 * 60 * 60 * 1000

export interface CreateUserInvitationInput {
  actorUserId: string
  actorUsername: string
  actorRoles: readonly string[]
  username: string
  email: string
  fullName: string
  targetRoles: readonly SystemRoleCode[]
  studentCode?: string
  classId?: string
  auditContext: InvitationAuditContext
}

export interface ResendUserInvitationInput {
  actorUserId: string
  actorUsername: string
  actorRoles: readonly string[]
  userId: string
  auditContext: InvitationAuditContext
}

export interface InvitationAuditContext {
  requestId: string | null
  ipAddress: string | null
  userAgent: string | null
}

export type InvitationDeliveryStatus =
  | 'SENT'
  | 'FAILED'

export interface UserInvitationResult {
  userId: string
  deliveryStatus: InvitationDeliveryStatus
}

export interface UserInvitationUseCase {
  createInvitation(
    input: CreateUserInvitationInput,
  ): Promise<UserInvitationResult>

  resendInvitation(
    input: ResendUserInvitationInput,
  ): Promise<UserInvitationResult>
}

export interface PersistInvitationInput {
  username: string
  email: string
  fullName: string
  targetRoles: readonly SystemRoleCode[]
  invitedAt: Date
  tokenHash: string
  tokenExpiresAt: Date
  createdByUserId: string
  actorUsername: string
  studentCode?: string
  classId?: string
  auditContext: InvitationAuditContext
}

export interface PersistResendInvitationInput {
  userId: string
  tokenHash: string
  tokenExpiresAt: Date
  createdAt: Date
  createdByUserId: string
  actorUsername: string
  auditContext: InvitationAuditContext
}

export interface UserInvitationRepository {
  createInvitedUserWithToken(
    input: PersistInvitationInput,
  ): Promise<{
    userId: string
  }>

  markInvitationSent(
    userId: string,
    sentAt: Date,
  ): Promise<void>

  replaceActivationToken(
    input: PersistResendInvitationInput,
  ): Promise<{
    userId: string
    email: string
    fullName: string
  }>
}

export class StudentAcademicDataRequiredError
extends Error {
  constructor(readonly field: 'studentCode' | 'classId') {
    super(`${field} is required for STUDENT role`)
    this.name = 'StudentAcademicDataRequiredError'
  }
}

export class StudentAcademicDataNotAllowedError
extends Error {
  constructor(readonly field: 'studentCode' | 'classId') {
    super(`${field} is only allowed for STUDENT role`)
    this.name = 'StudentAcademicDataNotAllowedError'
  }
}

type ActionTokenGenerator =
  () => GeneratedActionToken

type Clock = () => Date

export class UserInvitationService 
implements UserInvitationUseCase {
  constructor(
    private readonly repository:
      UserInvitationRepository,

    private readonly mailer:
      InvitationMailer,

    private readonly webBaseUrl: string,

    private readonly tokenGenerator:
      ActionTokenGenerator =
        generateActionToken,

    private readonly clock:
      Clock = () => new Date(),
  ) {}

  async createInvitation(
    input: CreateUserInvitationInput,
  ): Promise<UserInvitationResult> {
    const targetRoles = [
      ...new Set(input.targetRoles),
    ]

    assertCanAssignRoles(
      input.actorRoles,
      targetRoles,
    )

    const username =
      input.username.trim().toLowerCase()

    const email =
      input.email.trim().toLowerCase()

    const fullName =
      input.fullName.trim()

    const includesStudentRole =
      targetRoles.includes('STUDENT')

    const studentCode =
      input.studentCode?.trim().toUpperCase()

    const classId =
      input.classId?.trim()

    if (includesStudentRole && !studentCode) {
      throw new StudentAcademicDataRequiredError(
        'studentCode',
      )
    }

    if (includesStudentRole && !classId) {
      throw new StudentAcademicDataRequiredError(
        'classId',
      )
    }

    if (!includesStudentRole && studentCode) {
      throw new StudentAcademicDataNotAllowedError(
        'studentCode',
      )
    }

    if (!includesStudentRole && classId) {
      throw new StudentAcademicDataNotAllowedError(
        'classId',
      )
    }

    const createdAt =
      this.clock()

    const token =
      this.tokenGenerator()

    const tokenExpiresAt =
      new Date(
        createdAt.getTime()
        + ACCOUNT_ACTIVATION_TTL_MS,
      )

    const result =
      await this.repository
        .createInvitedUserWithToken({
          username,
          email,
          fullName,
          targetRoles,
          invitedAt: createdAt,
          tokenHash: token.tokenHash,
          tokenExpiresAt,
          createdByUserId:
            input.actorUserId,
          actorUsername:
            input.actorUsername,
          auditContext:
            input.auditContext,
          ...(studentCode
            ? { studentCode }
            : {}),
          ...(classId
            ? { classId }
            : {}),
        })

    const activationUrl =
      new URL(
        '/activate',
        this.webBaseUrl,
      )

    activationUrl.searchParams.set(
      'token',
      token.rawToken,
    )

    let deliveryStatus:
      InvitationDeliveryStatus = 'SENT'

    try {
      await this.mailer.sendActivationEmail({
        recipientEmail: email,
        recipientName: fullName,
        activationUrl:
          activationUrl.toString(),
      })

      await this.repository.markInvitationSent(
        result.userId,
        this.clock(),
      )
    } catch {
      deliveryStatus = 'FAILED'
    }

    return {
      userId: result.userId,
      deliveryStatus,
    }
  }

  async resendInvitation(
    input: ResendUserInvitationInput,
  ): Promise<UserInvitationResult> {
    if (
      !input.actorRoles.includes('ADMIN')
      && !input.actorRoles.includes('SYSTEM_ADMIN')
    ) {
      throw new ForbiddenRoleAssignmentError()
    }

    const createdAt = this.clock()
    const token = this.tokenGenerator()
    const tokenExpiresAt = new Date(
      createdAt.getTime()
      + ACCOUNT_ACTIVATION_TTL_MS,
    )

    const invitation = await this.repository
      .replaceActivationToken({
        userId: input.userId,
        tokenHash: token.tokenHash,
        tokenExpiresAt,
        createdAt,
        createdByUserId: input.actorUserId,
        actorUsername: input.actorUsername,
        auditContext: input.auditContext,
      })

    const activationUrl = new URL(
      '/activate',
      this.webBaseUrl,
    )
    activationUrl.searchParams.set(
      'token',
      token.rawToken,
    )

    let deliveryStatus:
      InvitationDeliveryStatus = 'SENT'

    try {
      await this.mailer.sendActivationEmail({
        recipientEmail: invitation.email,
        recipientName: invitation.fullName,
        activationUrl: activationUrl.toString(),
      })

      await this.repository.markInvitationSent(
        invitation.userId,
        this.clock(),
      )
    } catch {
      deliveryStatus = 'FAILED'
    }

    return {
      userId: invitation.userId,
      deliveryStatus,
    }
  }
}
