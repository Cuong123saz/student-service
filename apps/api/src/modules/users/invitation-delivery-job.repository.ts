import { and, asc, eq, isNull, lte, sql } from 'drizzle-orm'

import { db } from '../../db/client.js'
import { auditLogs } from '../audit/audit.schema.js'
import { users } from '../auth/auth.schema.js'
import { userActionTokens } from './user-account.schema.js'
import { invitationDeliveryJobs } from './invitation-delivery-job.schema.js'
import type {
  ClaimInvitationJobInput,
  ClaimedInvitationDeliveryJob,
  CompleteInvitationJobInput,
  FailInvitationJobInput,
  InvitationDeliveryJobRepository,
  PrepareInvitationJobInput,
} from './invitation-delivery-job.service.js'

export class DrizzleInvitationDeliveryJobRepository implements InvitationDeliveryJobRepository {
  constructor(private readonly database: typeof db = db) {}

  async claimNext(input: ClaimInvitationJobInput): Promise<ClaimedInvitationDeliveryJob | null> {
    return this.database.transaction(async (transaction) => {
      await transaction
        .update(invitationDeliveryJobs)
        .set({
          status: 'FAILED',
          lockedAt: null,
          lockedBy: null,
          lastErrorCode: 'WORKER_LOCK_EXPIRED',
          updatedAt: input.now,
        })
        .where(
          and(
            eq(invitationDeliveryJobs.status, 'PROCESSING'),
            lte(invitationDeliveryJobs.lockedAt, input.staleBefore),
            sql`${invitationDeliveryJobs.attempts} >= ${invitationDeliveryJobs.maxAttempts}`,
          ),
        )

      await transaction
        .update(invitationDeliveryJobs)
        .set({
          status: 'PENDING',
          lockedAt: null,
          lockedBy: null,
          nextAttemptAt: input.now,
          lastErrorCode: 'WORKER_LOCK_EXPIRED',
          updatedAt: input.now,
        })
        .where(
          and(
            eq(invitationDeliveryJobs.status, 'PROCESSING'),
            lte(invitationDeliveryJobs.lockedAt, input.staleBefore),
            sql`${invitationDeliveryJobs.attempts} < ${invitationDeliveryJobs.maxAttempts}`,
          ),
        )

      const [candidate] = await transaction
        .select({ id: invitationDeliveryJobs.id })
        .from(invitationDeliveryJobs)
        .where(
          and(
            eq(invitationDeliveryJobs.status, 'PENDING'),
            lte(invitationDeliveryJobs.nextAttemptAt, input.now),
            sql`${invitationDeliveryJobs.attempts} < ${invitationDeliveryJobs.maxAttempts}`,
          ),
        )
        .orderBy(asc(invitationDeliveryJobs.nextAttemptAt), asc(invitationDeliveryJobs.createdAt))
        .limit(1)
        .for('update', { skipLocked: true })

      if (!candidate) {
        return null
      }

      const [claimed] = await transaction
        .update(invitationDeliveryJobs)
        .set({
          status: 'PROCESSING',
          attempts: sql`${invitationDeliveryJobs.attempts} + 1`,
          lockedAt: input.now,
          lockedBy: input.workerId,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(invitationDeliveryJobs.id, candidate.id),
            eq(invitationDeliveryJobs.status, 'PENDING'),
          ),
        )
        .returning({
          id: invitationDeliveryJobs.id,
          userId: invitationDeliveryJobs.userId,
          attempt: invitationDeliveryJobs.attempts,
          maxAttempts: invitationDeliveryJobs.maxAttempts,
        })

      if (!claimed) {
        return null
      }

      const [recipient] = await transaction
        .select({
          email: users.email,
          fullName: users.fullName,
        })
        .from(users)
        .where(eq(users.id, claimed.userId))
        .limit(1)

      if (!recipient) {
        return null
      }

      return {
        id: claimed.id,
        userId: claimed.userId,
        recipientEmail: recipient.email,
        recipientName: recipient.fullName,
        attempt: claimed.attempt,
        maxAttempts: claimed.maxAttempts,
      }
    })
  }

  async prepareActivationToken(input: PrepareInvitationJobInput): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      const [job] = await transaction
        .select({
          userId: invitationDeliveryJobs.userId,
        })
        .from(invitationDeliveryJobs)
        .where(
          and(
            eq(invitationDeliveryJobs.id, input.jobId),
            eq(invitationDeliveryJobs.status, 'PROCESSING'),
            eq(invitationDeliveryJobs.lockedBy, input.workerId),
          ),
        )
        .for('update')
        .limit(1)

      if (!job) {
        return false
      }

      const [user] = await transaction
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.id, job.userId),
            eq(users.status, 'INVITED'),
            isNull(users.passwordHash),
            isNull(users.activatedAt),
          ),
        )
        .for('update')
        .limit(1)

      if (!user) {
        return false
      }

      await transaction
        .update(userActionTokens)
        .set({ revokedAt: input.now })
        .where(
          and(
            eq(userActionTokens.userId, user.id),
            eq(userActionTokens.purpose, 'ACCOUNT_ACTIVATION'),
            isNull(userActionTokens.consumedAt),
            isNull(userActionTokens.revokedAt),
          ),
        )

      await transaction.insert(userActionTokens).values({
        userId: user.id,
        purpose: 'ACCOUNT_ACTIVATION',
        tokenHash: input.tokenHash,
        expiresAt: input.tokenExpiresAt,
        createdAt: input.now,
      })

      return true
    })
  }

  async markSent(input: CompleteInvitationJobInput): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      const [job] = await transaction
        .update(invitationDeliveryJobs)
        .set({
          status: 'SENT',
          lockedAt: null,
          lockedBy: null,
          sentAt: input.now,
          lastErrorCode: null,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(invitationDeliveryJobs.id, input.jobId),
            eq(invitationDeliveryJobs.status, 'PROCESSING'),
            eq(invitationDeliveryJobs.lockedBy, input.workerId),
          ),
        )
        .returning({
          userId: invitationDeliveryJobs.userId,
          actorUserId: invitationDeliveryJobs.createdByUserId,
          actorUsername: invitationDeliveryJobs.actorUsername,
          attempts: invitationDeliveryJobs.attempts,
        })

      if (!job) {
        return false
      }

      await transaction
        .update(users)
        .set({
          lastInvitationSentAt: input.now,
          updatedAt: input.now,
        })
        .where(eq(users.id, job.userId))

      await transaction.insert(auditLogs).values({
        occurredAt: input.now,
        actorType: job.actorUserId ? 'USER' : 'SYSTEM',
        actorUserId: job.actorUserId,
        actorUsername: job.actorUsername,
        action: 'INVITATION_EMAIL_SENT',
        resourceType: 'USER',
        resourceId: job.userId,
        outcome: 'SUCCESS',
        requestId: null,
        ipAddress: null,
        userAgent: null,
        metadata: {
          source: 'STUDENT_IMPORT_JOB',
          jobId: input.jobId,
          attempt: job.attempts,
        },
        before: null,
        after: null,
      })

      return true
    })
  }

  async markFailed(input: FailInvitationJobInput): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      const [job] = await transaction
        .update(invitationDeliveryJobs)
        .set({
          status: input.permanent ? 'FAILED' : 'PENDING',
          lockedAt: null,
          lockedBy: null,
          nextAttemptAt: input.retryAt,
          lastErrorCode: input.errorCode,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(invitationDeliveryJobs.id, input.jobId),
            eq(invitationDeliveryJobs.status, 'PROCESSING'),
            eq(invitationDeliveryJobs.lockedBy, input.workerId),
          ),
        )
        .returning({
          userId: invitationDeliveryJobs.userId,
          actorUserId: invitationDeliveryJobs.createdByUserId,
          actorUsername: invitationDeliveryJobs.actorUsername,
          attempts: invitationDeliveryJobs.attempts,
        })

      if (!job) {
        return false
      }

      await transaction.insert(auditLogs).values({
        occurredAt: input.now,
        actorType: job.actorUserId ? 'USER' : 'SYSTEM',
        actorUserId: job.actorUserId,
        actorUsername: job.actorUsername,
        action: 'INVITATION_EMAIL_FAILED',
        resourceType: 'USER',
        resourceId: job.userId,
        outcome: 'FAILURE',
        requestId: null,
        ipAddress: null,
        userAgent: null,
        metadata: {
          source: 'STUDENT_IMPORT_JOB',
          jobId: input.jobId,
          attempt: job.attempts,
          errorCode: input.errorCode,
          willRetry: !input.permanent,
        },
        before: null,
        after: null,
      })

      return true
    })
  }
}
