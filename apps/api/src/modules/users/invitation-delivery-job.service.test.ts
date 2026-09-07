import assert from 'node:assert/strict'
import { test } from 'node:test'

import type {
  InvitationMailer,
  SendActivationEmailInput,
} from './invitation-mailer.js'
import {
  InvitationDeliveryJobService,
  type ClaimInvitationJobInput,
  type ClaimedInvitationDeliveryJob,
  type CompleteInvitationJobInput,
  type FailInvitationJobInput,
  type InvitationDeliveryJobRepository,
  type PrepareInvitationJobInput,
} from './invitation-delivery-job.service.js'

const claimedJob: ClaimedInvitationDeliveryJob = {
  id: '85ca4291-c7bd-4370-a117-976bf237261c',
  userId: '7aecf61b-cfe1-476f-9b65-0b328136381b',
  recipientEmail: 'student@example.edu.vn',
  recipientName: 'Nguyễn Văn A',
  attempt: 1,
  maxAttempts: 3,
}

class FakeRepository
implements InvitationDeliveryJobRepository {
  job: ClaimedInvitationDeliveryJob | null =
    claimedJob
  claims: ClaimInvitationJobInput[] = []
  preparations: PrepareInvitationJobInput[] = []
  sent: CompleteInvitationJobInput[] = []
  failed: FailInvitationJobInput[] = []

  async claimNext(input: ClaimInvitationJobInput) {
    this.claims.push(input)
    return this.job
  }

  async prepareActivationToken(
    input: PrepareInvitationJobInput,
  ) {
    this.preparations.push(input)
    return true
  }

  async markSent(input: CompleteInvitationJobInput) {
    this.sent.push(input)
    return true
  }

  async markFailed(input: FailInvitationJobInput) {
    this.failed.push(input)
    return true
  }
}

class FakeMailer implements InvitationMailer {
  deliveries: SendActivationEmailInput[] = []
  shouldFail = false

  async sendActivationEmail(
    input: SendActivationEmailInput,
  ) {
    this.deliveries.push(input)
    if (this.shouldFail) {
      throw new Error('SMTP unavailable')
    }
  }
}

function sequentialClock(...dates: string[]) {
  let index = 0
  return () => {
    const value = dates[index]
    index += 1
    if (!value) {
      throw new Error('Clock exhausted')
    }
    return new Date(value)
  }
}

test(
  'worker tạo token, gửi raw token và đánh dấu SENT',
  async () => {
    const repository = new FakeRepository()
    const mailer = new FakeMailer()
    const service = new InvitationDeliveryJobService(
      repository,
      mailer,
      'http://localhost:3001',
      () => ({
        rawToken: 'raw-token-for-email',
        tokenHash: 'a'.repeat(64),
      }),
      sequentialClock(
        '2026-09-06T00:00:00.000Z',
        '2026-09-06T00:00:01.000Z',
        '2026-09-06T00:00:02.000Z',
      ),
    )

    assert.equal(
      await service.processNext(
        '2f230120-c001-4e71-a17d-f18541e64d87',
      ),
      true,
    )
    assert.equal(repository.preparations.length, 1)
    assert.equal(
      repository.preparations[0]?.tokenHash,
      'a'.repeat(64),
    )
    assert.equal(
      repository.preparations[0]
        ?.tokenExpiresAt.toISOString(),
      '2026-09-09T00:00:01.000Z',
    )
    assert.match(
      mailer.deliveries[0]?.activationUrl ?? '',
      /token=raw-token-for-email/,
    )
    assert.equal(repository.sent.length, 1)
    assert.equal(repository.failed.length, 0)
  },
)

test(
  'SMTP lỗi trả job về PENDING với backoff và không lộ nội dung lỗi',
  async () => {
    const repository = new FakeRepository()
    const mailer = new FakeMailer()
    mailer.shouldFail = true
    const service = new InvitationDeliveryJobService(
      repository,
      mailer,
      'http://localhost:3001',
      () => ({
        rawToken: 'raw-token',
        tokenHash: 'b'.repeat(64),
      }),
      sequentialClock(
        '2026-09-06T00:00:00.000Z',
        '2026-09-06T00:00:01.000Z',
        '2026-09-06T00:00:02.000Z',
      ),
    )

    await service.processNext(
      '2f230120-c001-4e71-a17d-f18541e64d87',
    )

    assert.deepEqual(repository.failed, [{
      jobId: claimedJob.id,
      workerId:
        '2f230120-c001-4e71-a17d-f18541e64d87',
      now: new Date('2026-09-06T00:00:02.000Z'),
      errorCode: 'MAIL_DELIVERY_FAILED',
      permanent: false,
      retryAt:
        new Date('2026-09-06T00:01:02.000Z'),
    }])
    assert.equal(repository.sent.length, 0)
  },
)

test(
  'worker rảnh trả false và không tạo token',
  async () => {
    const repository = new FakeRepository()
    repository.job = null
    const mailer = new FakeMailer()
    const service = new InvitationDeliveryJobService(
      repository,
      mailer,
      'http://localhost:3001',
      undefined,
      () => new Date('2026-09-06T00:00:00.000Z'),
    )

    assert.equal(
      await service.processNext(
        '2f230120-c001-4e71-a17d-f18541e64d87',
      ),
      false,
    )
    assert.equal(repository.preparations.length, 0)
    assert.equal(mailer.deliveries.length, 0)
  },
)
