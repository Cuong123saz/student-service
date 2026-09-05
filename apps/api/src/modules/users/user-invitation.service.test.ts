import assert from 'node:assert/strict'
import { test } from 'node:test'

import type {
  InvitationMailer,
  SendActivationEmailInput,
} from './invitation-mailer.js'

import {
  ForbiddenRoleAssignmentError,
} from './role-assignment-policy.js'

import {
  UserInvitationService,
  type CreateUserInvitationInput,
  type PersistInvitationInput,
  type UserInvitationRepository,
} from './user-invitation.service.js'

const userId =
  '85ca4291-c7bd-4370-a117-976bf237261c'

const actorUserId =
  '2f230120-c001-4e71-a17d-f18541e64d87'

const fixedNow =
  new Date('2026-01-01T00:00:00.000Z')

const rawToken =
  'raw-token-for-test'

const tokenHash =
  'a'.repeat(64)

const validInput:
CreateUserInvitationInput = {
  actorUserId,
  actorRoles: ['ADMIN'],
  username: '  STUDENT001  ',
  email: '  Student001@Example.edu.vn  ',
  fullName: '  Nguyễn Văn A  ',
  targetRoles: [
    'STUDENT',
    'STUDENT',
  ],
}

class FakeInvitationRepository
implements UserInvitationRepository {
  persistedInput:
    PersistInvitationInput | undefined

  markedInvitation:
    {
      userId: string
      sentAt: Date
    } | undefined

  async createInvitedUserWithToken(
    input: PersistInvitationInput,
  ) {
    this.persistedInput = input

    return {
      userId,
    }
  }

  async markInvitationSent(
    markedUserId: string,
    sentAt: Date,
  ) {
    this.markedInvitation = {
      userId: markedUserId,
      sentAt,
    }
  }
}

class FakeInvitationMailer
implements InvitationMailer {
  sentInput:
    SendActivationEmailInput | undefined

  constructor(
    private readonly failure?: Error,
  ) {}

  async sendActivationEmail(
    input: SendActivationEmailInput,
  ) {
    if (this.failure) {
      throw this.failure
    }

    this.sentInput = input
  }
}

function createService(
  repository:
    UserInvitationRepository,
  mailer:
    InvitationMailer,
) {
  return new UserInvitationService(
    repository,
    mailer,
    'http://localhost:3001',
    () => ({
      rawToken,
      tokenHash,
    }),
    () => fixedNow,
  )
}

test(
  'tạo lời mời, lưu token hash và gửi raw token qua email',
  async () => {
    const repository =
      new FakeInvitationRepository()

    const mailer =
      new FakeInvitationMailer()

    const service =
      createService(
        repository,
        mailer,
      )

    const result =
      await service.createInvitation(
        validInput,
      )

    assert.deepEqual(result, {
      userId,
    })

    const persistedInput =
      repository.persistedInput

    assert.ok(persistedInput)

    assert.equal(
      persistedInput.username,
      'student001',
    )

    assert.equal(
      persistedInput.email,
      'student001@example.edu.vn',
    )

    assert.equal(
      persistedInput.fullName,
      'Nguyễn Văn A',
    )

    assert.deepEqual(
      persistedInput.targetRoles,
      ['STUDENT'],
    )

    assert.equal(
      persistedInput.tokenHash,
      tokenHash,
    )

    assert.equal(
      'rawToken' in persistedInput,
      false,
    )

    assert.equal(
      persistedInput.createdByUserId,
      actorUserId,
    )

    assert.equal(
      persistedInput
        .tokenExpiresAt
        .getTime()
      - persistedInput
        .invitedAt
        .getTime(),
      72 * 60 * 60 * 1000,
    )

    const sentInput =
      mailer.sentInput

    assert.ok(sentInput)

    assert.equal(
      sentInput.recipientEmail,
      'student001@example.edu.vn',
    )

    assert.equal(
      sentInput.recipientName,
      'Nguyễn Văn A',
    )

    const activationUrl =
      new URL(sentInput.activationUrl)

    assert.equal(
      activationUrl.origin,
      'http://localhost:3001',
    )

    assert.equal(
      activationUrl.pathname,
      '/activate',
    )

    assert.equal(
      activationUrl.searchParams
        .get('token'),
      rawToken,
    )

    assert.deepEqual(
      repository.markedInvitation,
      {
        userId,
        sentAt: fixedNow,
      },
    )
  },
)

test(
  'không tạo dữ liệu khi actor không được phép gán role',
  async () => {
    const repository =
      new FakeInvitationRepository()

    const mailer =
      new FakeInvitationMailer()

    const service =
      createService(
        repository,
        mailer,
      )

    await assert.rejects(
      () =>
        service.createInvitation({
          ...validInput,
          actorRoles: ['STUDENT'],
        }),
      ForbiddenRoleAssignmentError,
    )

    assert.equal(
      repository.persistedInput,
      undefined,
    )

    assert.equal(
      mailer.sentInput,
      undefined,
    )
  },
)

test(
  'không đánh dấu đã gửi khi email thất bại',
  async () => {
    const repository =
      new FakeInvitationRepository()

    const mailer =
      new FakeInvitationMailer(
        new Error(
          'Email provider unavailable',
        ),
      )

    const service =
      createService(
        repository,
        mailer,
      )

    await assert.rejects(
      () =>
        service.createInvitation(
          validInput,
        ),
      /Email provider unavailable/,
    )

    // User và token đã được lưu trước
    // khi gọi nhà cung cấp email.
    assert.ok(
      repository.persistedInput,
    )

    // Nhưng không được tuyên bố rằng
    // email đã được gửi thành công.
    assert.equal(
      repository.markedInvitation,
      undefined,
    )
  },
)