import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  InvalidPasswordError,
} from '../auth/password-policy.js'

import type {
  PasswordHasher,
} from '../auth/password-hasher.js'

import {
  AccountActivationService,
  InvalidActivationTokenError,
  type AccountActivationRepository,
  type ActivationTokenCandidate,
  type CompleteActivationInput,
} from './account-activation.service.js'

const rawToken =
  'activation-token-for-test'

const expectedTokenHash =
  'd0b50d8094da859b0b6dfc949081df2b'
  + '97392f7a78dac85bf186f7c4663cf11c'

const newPassword =
  'NewSecurePassword2026'

const passwordHash =
  'hashed-password-for-test'

const checkedAt =
  new Date('2026-01-01T00:00:00.000Z')

const activatedAt =
  new Date('2026-01-01T00:00:01.000Z')

const candidate:
ActivationTokenCandidate = {
  tokenId:
    'f901fdfd-0ae2-43a8-a0a2-14ee39d9b2ab',

  userId:
    '85ca4291-c7bd-4370-a117-976bf237261c',
}

class FakeActivationRepository
implements AccountActivationRepository {
  lookupInput:
    {
      tokenHash: string
      now: Date
    } | undefined

  completionInput:
    CompleteActivationInput
    | undefined

  constructor(
    private readonly candidate:
      ActivationTokenCandidate | null,

    private readonly completionResult =
      true,
  ) {}

  async findUsableActivationToken(
    tokenHash: string,
    now: Date,
  ) {
    this.lookupInput = {
      tokenHash,
      now,
    }

    return this.candidate
  }

  async completeActivation(
    input: CompleteActivationInput,
  ) {
    this.completionInput = input

    return this.completionResult
  }
}

class FakePasswordHasher
implements PasswordHasher {
  hashedPassword:
    string | undefined

  async hash(
    plainTextPassword: string,
  ): Promise<string> {
    this.hashedPassword =
      plainTextPassword

    return passwordHash
  }

  async verify(
    _passwordHash: string,
    _plainTextPassword: string,
  ): Promise<boolean> {
    return false
  }
}
function createClock(
  ...times: readonly Date[]
) {
  let index = 0

  return () => {
    const time = times[index]

    assert.ok(
      time,
      'Clock was called more times than expected',
    )

    index += 1

    return time
  }
}
test(
  'kích hoạt tài khoản bằng token hợp lệ',
  async () => {
    const repository =
      new FakeActivationRepository(
        candidate,
      )

    const passwordHasher =
      new FakePasswordHasher()

    const service =
      new AccountActivationService(
        repository,
        passwordHasher,
        createClock(checkedAt, activatedAt),
      )

    await service.activateAccount({
      rawToken,
      newPassword,
    })

    assert.deepEqual(
  repository.lookupInput,
  {
    tokenHash:
      expectedTokenHash,
    now: checkedAt,
  },
)

    assert.equal(
      passwordHasher.hashedPassword,
      newPassword,
    )

    assert.deepEqual(
      repository.completionInput,
      {
        tokenId:
          candidate.tokenId,
        userId:
          candidate.userId,
        tokenHash:
          expectedTokenHash,
        passwordHash,
        activatedAt,
      },
    )

    const completionInput =
      repository.completionInput

    assert.ok(completionInput)

    assert.equal(
      'rawToken' in completionInput,
      false,
    )
  },
)

test(
  'token không hợp lệ không chạy Argon2',
  async () => {
    const repository =
      new FakeActivationRepository(
        null,
      )

    const passwordHasher =
      new FakePasswordHasher()

    const service =
      new AccountActivationService(
        repository,
        passwordHasher,
       createClock(checkedAt),
      )

    await assert.rejects(
      () =>
        service.activateAccount({
          rawToken,
          newPassword,
        }),
      InvalidActivationTokenError,
    )

    assert.equal(
      passwordHasher.hashedPassword,
      undefined,
    )

    assert.equal(
      repository.completionInput,
      undefined,
    )
  },
)

test(
  'từ chối khi token bị request khác sử dụng trước bước hoàn tất',
  async () => {
    const repository =
      new FakeActivationRepository(
        candidate,
        false,
      )

    const passwordHasher =
      new FakePasswordHasher()

    const service =
      new AccountActivationService(
        repository,
        passwordHasher,
       createClock(checkedAt, activatedAt),
      )

    await assert.rejects(
      () =>
        service.activateAccount({
          rawToken,
          newPassword,
        }),
      InvalidActivationTokenError,
    )

    assert.equal(
      passwordHasher.hashedPassword,
      newPassword,
    )

    assert.ok(
      repository.completionInput,
    )
  },
)

test(
  'mật khẩu không đạt policy bị từ chối trước khi truy vấn token',
  async () => {
    const repository =
      new FakeActivationRepository(
        candidate,
      )

    const passwordHasher =
      new FakePasswordHasher()

    const service =
      new AccountActivationService(
        repository,
        passwordHasher,
       createClock(),
      )

    await assert.rejects(
      () =>
        service.activateAccount({
          rawToken,
          newPassword: 'short',
        }),
      InvalidPasswordError,
    )

    assert.equal(
      repository.lookupInput,
      undefined,
    )

    assert.equal(
      passwordHasher.hashedPassword,
      undefined,
    )
  },
)