import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { InvitationMailer, SendActivationEmailInput } from './invitation-mailer.js'

import { ForbiddenRoleAssignmentError } from './role-assignment-policy.js'
import {
  StudentAcademicDataNotAllowedError,
  StudentAcademicDataRequiredError,
  UserInvitationService,
  type CreateUserInvitationInput,
  type PersistInvitationInput,
  type PersistResendInvitationInput,
  type UserInvitationRepository,
} from './user-invitation.service.js'

const userId = '85ca4291-c7bd-4370-a117-976bf237261c'

const actorUserId = '2f230120-c001-4e71-a17d-f18541e64d87'

const fixedNow = new Date('2026-01-01T00:00:00.000Z')

const rawToken = 'raw-token-for-test'

const tokenHash = 'a'.repeat(64)

const validInput: CreateUserInvitationInput = {
  actorUserId,
  actorUsername: 'admin001',
  actorRoles: ['ADMIN'],
  username: '  STUDENT001  ',
  email: '  Student001@Example.edu.vn  ',
  fullName: '  Nguyễn Văn A  ',
  targetRoles: ['STUDENT', 'STUDENT'],
  studentCode: '  sv001  ',
  classId: 'bc6573e5-18df-4780-ab06-9e256ba7d83a',
  auditContext: {
    requestId: 'req-1',
    ipAddress: '127.0.0.1',
    userAgent: 'test',
  },
}

class FakeInvitationRepository implements UserInvitationRepository {
  persistedInput: PersistInvitationInput | undefined

  markedInvitation:
    | {
        userId: string
        sentAt: Date
      }
    | undefined

  replacedInput: PersistResendInvitationInput | undefined

  async createInvitedUserWithToken(input: PersistInvitationInput) {
    this.persistedInput = input

    return {
      userId,
    }
  }

  async markInvitationSent(markedUserId: string, sentAt: Date) {
    this.markedInvitation = {
      userId: markedUserId,
      sentAt,
    }
  }

  async replaceActivationToken(input: PersistResendInvitationInput) {
    this.replacedInput = input

    return {
      userId,
      email: 'student001@example.edu.vn',
      fullName: 'Nguyễn Văn A',
    }
  }
}

class FakeInvitationMailer implements InvitationMailer {
  sentInput: SendActivationEmailInput | undefined

  constructor(private readonly failure?: Error) {}

  async sendActivationEmail(input: SendActivationEmailInput) {
    if (this.failure) {
      throw this.failure
    }

    this.sentInput = input
  }
}

function createService(repository: UserInvitationRepository, mailer: InvitationMailer) {
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

test('tạo lời mời, lưu token hash và gửi raw token qua email', async () => {
  const repository = new FakeInvitationRepository()

  const mailer = new FakeInvitationMailer()

  const service = createService(repository, mailer)

  const result = await service.createInvitation(validInput)

  assert.deepEqual(result, {
    userId,
    deliveryStatus: 'SENT',
  })

  const persistedInput = repository.persistedInput

  assert.ok(persistedInput)

  assert.equal(persistedInput.username, 'student001')

  assert.equal(persistedInput.email, 'student001@example.edu.vn')

  assert.equal(persistedInput.fullName, 'Nguyễn Văn A')

  assert.deepEqual(persistedInput.targetRoles, ['STUDENT'])

  assert.equal(persistedInput.studentCode, 'SV001')

  assert.equal(persistedInput.classId, validInput.classId)

  assert.equal(persistedInput.tokenHash, tokenHash)

  assert.equal('rawToken' in persistedInput, false)

  assert.equal(persistedInput.createdByUserId, actorUserId)

  assert.equal(
    persistedInput.tokenExpiresAt.getTime() - persistedInput.invitedAt.getTime(),
    72 * 60 * 60 * 1000,
  )

  const sentInput = mailer.sentInput

  assert.ok(sentInput)

  assert.equal(sentInput.recipientEmail, 'student001@example.edu.vn')

  assert.equal(sentInput.recipientName, 'Nguyễn Văn A')

  const activationUrl = new URL(sentInput.activationUrl)

  assert.equal(activationUrl.origin, 'http://localhost:3001')

  assert.equal(activationUrl.pathname, '/activate')

  assert.equal(activationUrl.searchParams.get('token'), rawToken)

  assert.deepEqual(repository.markedInvitation, {
    userId,
    sentAt: fixedNow,
  })
})

test('không tạo dữ liệu khi actor không được phép gán role', async () => {
  const repository = new FakeInvitationRepository()

  const mailer = new FakeInvitationMailer()

  const service = createService(repository, mailer)

  await assert.rejects(
    () =>
      service.createInvitation({
        ...validInput,
        actorRoles: ['STUDENT'],
      }),
    ForbiddenRoleAssignmentError,
  )

  assert.equal(repository.persistedInput, undefined)

  assert.equal(mailer.sentInput, undefined)
})

test('trả delivery FAILED và không đánh dấu đã gửi khi email thất bại', async () => {
  const repository = new FakeInvitationRepository()

  const mailer = new FakeInvitationMailer(new Error('Email provider unavailable'))

  const service = createService(repository, mailer)

  const result = await service.createInvitation(validInput)

  assert.deepEqual(result, {
    userId,
    deliveryStatus: 'FAILED',
  })

  // User và token đã được lưu trước
  // khi gọi nhà cung cấp email.
  assert.ok(repository.persistedInput)

  // Nhưng không được tuyên bố rằng
  // email đã được gửi thành công.
  assert.equal(repository.markedInvitation, undefined)
})

test('bắt buộc dữ liệu học vụ khi gán role STUDENT', async () => {
  const repository = new FakeInvitationRepository()
  const service = createService(repository, new FakeInvitationMailer())

  const incompleteInput = { ...validInput }
  delete incompleteInput.studentCode

  await assert.rejects(
    () => service.createInvitation(incompleteInput),
    StudentAcademicDataRequiredError,
  )

  assert.equal(repository.persistedInput, undefined)
})

test('không nhận dữ liệu học vụ khi không có role STUDENT', async () => {
  const repository = new FakeInvitationRepository()
  const service = createService(repository, new FakeInvitationMailer())

  await assert.rejects(
    () =>
      service.createInvitation({
        ...validInput,
        targetRoles: ['ACADEMIC_ADVISOR'],
      }),
    StudentAcademicDataNotAllowedError,
  )

  assert.equal(repository.persistedInput, undefined)
})

test('gửi lại lời mời bằng token mới và đánh dấu thời điểm gửi', async () => {
  const repository = new FakeInvitationRepository()
  const mailer = new FakeInvitationMailer()
  const service = createService(repository, mailer)

  const result = await service.resendInvitation({
    actorUserId,
    actorUsername: 'admin001',
    actorRoles: ['ADMIN'],
    userId,
    auditContext: validInput.auditContext,
  })

  assert.deepEqual(result, {
    userId,
    deliveryStatus: 'SENT',
  })
  assert.deepEqual(repository.replacedInput, {
    userId,
    tokenHash,
    tokenExpiresAt: new Date(fixedNow.getTime() + 72 * 60 * 60 * 1000),
    createdAt: fixedNow,
    createdByUserId: actorUserId,
    actorUsername: 'admin001',
    auditContext: validInput.auditContext,
  })
  assert.equal(mailer.sentInput?.recipientEmail, 'student001@example.edu.vn')
  assert.equal(new URL(mailer.sentInput?.activationUrl ?? '').searchParams.get('token'), rawToken)
  assert.deepEqual(repository.markedInvitation, {
    userId,
    sentAt: fixedNow,
  })
})

test('gửi lại lời mời trả FAILED khi email lỗi nhưng token mới đã lưu', async () => {
  const repository = new FakeInvitationRepository()
  const service = createService(repository, new FakeInvitationMailer(new Error('SMTP unavailable')))

  const result = await service.resendInvitation({
    actorUserId,
    actorUsername: 'admin001',
    actorRoles: ['SYSTEM_ADMIN'],
    userId,
    auditContext: validInput.auditContext,
  })

  assert.deepEqual(result, {
    userId,
    deliveryStatus: 'FAILED',
  })
  assert.ok(repository.replacedInput)
  assert.equal(repository.markedInvitation, undefined)
})

test('không cho actor ngoài admin gửi lại lời mời', async () => {
  const repository = new FakeInvitationRepository()
  const service = createService(repository, new FakeInvitationMailer())

  await assert.rejects(
    () =>
      service.resendInvitation({
        actorUserId,
        actorUsername: 'student001',
        actorRoles: ['STUDENT'],
        userId,
        auditContext: validInput.auditContext,
      }),
    ForbiddenRoleAssignmentError,
  )

  assert.equal(repository.replacedInput, undefined)
})
