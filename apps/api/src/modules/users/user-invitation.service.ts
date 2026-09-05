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
} from './role-assignment-policy.js'

const ACCOUNT_ACTIVATION_TTL_MS =
  72 * 60 * 60 * 1000

export interface CreateUserInvitationInput {
  actorUserId: string
  actorRoles: readonly string[]
  username: string
  email: string
  fullName: string
  targetRoles: readonly SystemRoleCode[]
}
export interface UserInvitationUseCase {
  createInvitation(
    input: CreateUserInvitationInput,
  ): Promise<{
    userId: string
  }>
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
  ): Promise<{
    userId: string
  }> {
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

    await this.mailer
      .sendActivationEmail({
        recipientEmail: email,
        recipientName: fullName,
        activationUrl:
          activationUrl.toString(),
      })

    await this.repository
      .markInvitationSent(
        result.userId,
        this.clock(),
      )

    return {
      userId: result.userId,
    }
  }
}