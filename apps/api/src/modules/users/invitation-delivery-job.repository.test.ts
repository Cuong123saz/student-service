import assert from 'node:assert/strict'
import { sql } from 'drizzle-orm'
import { after, beforeEach, test } from 'node:test'

import { databaseClient, db } from '../../db/client.js'
import { auditLogs } from '../audit/audit.schema.js'
import { users } from '../auth/auth.schema.js'
import { userActionTokens } from './user-account.schema.js'
import { DrizzleInvitationDeliveryJobRepository } from './invitation-delivery-job.repository.js'
import { invitationDeliveryJobs } from './invitation-delivery-job.schema.js'

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl || new URL(databaseUrl).pathname !== '/student_service_test') {
  throw new Error('Integration tests must use the student_service_test database')
}

beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE ${auditLogs}`)
  await db.delete(invitationDeliveryJobs)
  await db.delete(userActionTokens)
  await db.delete(users)
})

after(async () => {
  await databaseClient.end()
})

test('hai worker không claim cùng một job và retry kết thúc bằng SENT', async () => {
  const now = new Date('2026-09-06T00:00:00.000Z')
  const userRows = await db
    .insert(users)
    .values([
      {
        username: 'queue.actor',
        fullName: 'Queue Actor',
        status: 'ACTIVE',
      },
      {
        username: 'queue.student',
        fullName: 'Sinh viên Queue',
        email: 'queue.student@example.edu.vn',
        status: 'INVITED',
        passwordHash: null,
        mustChangePassword: false,
      },
    ])
    .returning({ id: users.id })
  const actor = userRows[0]
  const student = userRows[1]
  assert.ok(actor)
  assert.ok(student)

  const [job] = await db
    .insert(invitationDeliveryJobs)
    .values({
      userId: student.id,
      createdByUserId: actor.id,
      actorUsername: 'queue.actor',
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: invitationDeliveryJobs.id })
  assert.ok(job)

  const repository = new DrizzleInvitationDeliveryJobRepository()
  const claims = await Promise.all([
    repository.claimNext({
      workerId: '2f230120-c001-4e71-a17d-f18541e64d87',
      now,
      staleBefore: new Date('2026-09-05T23:55:00.000Z'),
    }),
    repository.claimNext({
      workerId: '46f9323a-1c5c-4c8a-b596-cac83f5eaf96',
      now,
      staleBefore: new Date('2026-09-05T23:55:00.000Z'),
    }),
  ])
  const claimed = claims.find((claim) => claim !== null)
  assert.ok(claimed)
  assert.equal(claims.filter((claim) => claim !== null).length, 1)

  assert.equal(
    await repository.prepareActivationToken({
      jobId: job.id,
      workerId: claims[0]
        ? '2f230120-c001-4e71-a17d-f18541e64d87'
        : '46f9323a-1c5c-4c8a-b596-cac83f5eaf96',
      tokenHash: 'c'.repeat(64),
      tokenExpiresAt: new Date('2026-09-09T00:00:00.000Z'),
      now,
    }),
    true,
  )

  const ownerWorkerId = claims[0]
    ? '2f230120-c001-4e71-a17d-f18541e64d87'
    : '46f9323a-1c5c-4c8a-b596-cac83f5eaf96'
  const retryAt = new Date('2026-09-06T00:01:00.000Z')
  assert.equal(
    await repository.markFailed({
      jobId: job.id,
      workerId: ownerWorkerId,
      now,
      retryAt,
      errorCode: 'MAIL_DELIVERY_FAILED',
      permanent: false,
    }),
    true,
  )

  assert.equal(
    await repository.claimNext({
      workerId: ownerWorkerId,
      now: new Date('2026-09-06T00:00:59.000Z'),
      staleBefore: new Date('2026-09-05T23:55:59.000Z'),
    }),
    null,
  )

  const retried = await repository.claimNext({
    workerId: ownerWorkerId,
    now: retryAt,
    staleBefore: new Date('2026-09-05T23:56:00.000Z'),
  })
  assert.ok(retried)
  assert.equal(retried.attempt, 2)

  assert.equal(
    await repository.prepareActivationToken({
      jobId: job.id,
      workerId: ownerWorkerId,
      tokenHash: 'd'.repeat(64),
      tokenExpiresAt: new Date('2026-09-09T00:01:00.000Z'),
      now: retryAt,
    }),
    true,
  )
  assert.equal(
    await repository.markSent({
      jobId: job.id,
      workerId: ownerWorkerId,
      now: new Date('2026-09-06T00:01:01.000Z'),
    }),
    true,
  )

  const [storedJob] = await db
    .select({
      status: invitationDeliveryJobs.status,
      attempts: invitationDeliveryJobs.attempts,
    })
    .from(invitationDeliveryJobs)
  assert.deepEqual(storedJob, {
    status: 'SENT',
    attempts: 2,
  })

  const tokens = await db
    .select({
      tokenHash: userActionTokens.tokenHash,
      revokedAt: userActionTokens.revokedAt,
    })
    .from(userActionTokens)
  assert.equal(tokens.length, 2)
  assert.equal(
    tokens.find((token) => token.tokenHash === 'c'.repeat(64))?.revokedAt?.toISOString(),
    retryAt.toISOString(),
  )
  assert.equal(tokens.find((token) => token.tokenHash === 'd'.repeat(64))?.revokedAt, null)

  const events = await db.select({ action: auditLogs.action }).from(auditLogs)
  assert.deepEqual(events.map((event) => event.action).sort(), [
    'INVITATION_EMAIL_FAILED',
    'INVITATION_EMAIL_SENT',
  ])
})
