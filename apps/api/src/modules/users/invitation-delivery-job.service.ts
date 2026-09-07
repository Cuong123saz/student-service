import type {
  InvitationMailer,
} from './invitation-mailer.js'
import {
  generateActionToken,
  type GeneratedActionToken,
} from './user-action-token.js'

const ACTIVATION_TTL_MS =
  72 * 60 * 60 * 1000
const STALE_LOCK_MS = 5 * 60 * 1000

export interface ClaimedInvitationDeliveryJob {
  id: string
  userId: string
  recipientEmail: string | null
  recipientName: string
  attempt: number
  maxAttempts: number
}

export interface ClaimInvitationJobInput {
  workerId: string
  now: Date
  staleBefore: Date
}

export interface PrepareInvitationJobInput {
  jobId: string
  workerId: string
  tokenHash: string
  tokenExpiresAt: Date
  now: Date
}

export interface CompleteInvitationJobInput {
  jobId: string
  workerId: string
  now: Date
}

export interface FailInvitationJobInput
extends CompleteInvitationJobInput {
  errorCode: string
  retryAt: Date
  permanent: boolean
}

export interface InvitationDeliveryJobRepository {
  claimNext(
    input: ClaimInvitationJobInput,
  ): Promise<ClaimedInvitationDeliveryJob | null>

  prepareActivationToken(
    input: PrepareInvitationJobInput,
  ): Promise<boolean>

  markSent(
    input: CompleteInvitationJobInput,
  ): Promise<boolean>

  markFailed(
    input: FailInvitationJobInput,
  ): Promise<boolean>
}

export interface InvitationDeliveryJobUseCase {
  processNext(workerId: string): Promise<boolean>
}

type Clock = () => Date
type ActionTokenGenerator =
  () => GeneratedActionToken

function retryDelayMs(attempt: number): number {
  return Math.min(
    60 * 60 * 1000,
    60 * 1000 * (5 ** Math.max(0, attempt - 1)),
  )
}

export class InvitationDeliveryJobService
implements InvitationDeliveryJobUseCase {
  constructor(
    private readonly repository:
      InvitationDeliveryJobRepository,
    private readonly mailer: InvitationMailer,
    private readonly webBaseUrl: string,
    private readonly tokenGenerator:
      ActionTokenGenerator = generateActionToken,
    private readonly clock: Clock = () => new Date(),
  ) {}

  async processNext(workerId: string): Promise<boolean> {
    const claimTime = this.clock()
    const job = await this.repository.claimNext({
      workerId,
      now: claimTime,
      staleBefore: new Date(
        claimTime.getTime() - STALE_LOCK_MS,
      ),
    })

    if (!job) {
      return false
    }

    if (!job.recipientEmail) {
      await this.fail(
        job,
        workerId,
        'RECIPIENT_EMAIL_MISSING',
        true,
      )
      return true
    }

    const token = this.tokenGenerator()
    const tokenCreatedAt = this.clock()
    const prepared = await this.repository
      .prepareActivationToken({
        jobId: job.id,
        workerId,
        tokenHash: token.tokenHash,
        tokenExpiresAt: new Date(
          tokenCreatedAt.getTime()
          + ACTIVATION_TTL_MS,
        ),
        now: tokenCreatedAt,
      })

    if (!prepared) {
      await this.fail(
        job,
        workerId,
        'ACCOUNT_NOT_INVITABLE',
        true,
      )
      return true
    }

    const activationUrl = new URL(
      '/activate',
      this.webBaseUrl,
    )
    activationUrl.searchParams.set(
      'token',
      token.rawToken,
    )

    try {
      await this.mailer.sendActivationEmail({
        recipientEmail: job.recipientEmail,
        recipientName: job.recipientName,
        activationUrl: activationUrl.toString(),
      })
      await this.repository.markSent({
        jobId: job.id,
        workerId,
        now: this.clock(),
      })
    } catch {
      await this.fail(
        job,
        workerId,
        'MAIL_DELIVERY_FAILED',
        false,
      )
    }

    return true
  }

  private async fail(
    job: ClaimedInvitationDeliveryJob,
    workerId: string,
    errorCode: string,
    permanent: boolean,
  ): Promise<void> {
    const failedAt = this.clock()
    await this.repository.markFailed({
      jobId: job.id,
      workerId,
      now: failedAt,
      errorCode,
      permanent:
        permanent
        || job.attempt >= job.maxAttempts,
      retryAt: new Date(
        failedAt.getTime()
        + retryDelayMs(job.attempt),
      ),
    })
  }
}
