import type {
  PasswordHasher,
} from '../auth/password-hasher.js'

import {
  validateNewPassword,
} from '../auth/password-policy.js'

import {
  hashActionToken,
} from './user-action-token.js'

export interface ActivationTokenCandidate {
  tokenId: string
  userId: string
}

export interface CompleteActivationInput {
  tokenId: string
  userId: string
  tokenHash: string
  passwordHash: string
  activatedAt: Date
}

export interface AccountActivationRepository {
  findUsableActivationToken(
    tokenHash: string,
    now: Date,
  ): Promise<
    ActivationTokenCandidate | null
  >

  completeActivation(
    input: CompleteActivationInput,
  ): Promise<boolean>
}

export interface ActivateAccountInput {
  rawToken: string
  newPassword: string
}
export interface AccountActivationUseCase {
  activateAccount(
    input: ActivateAccountInput,
  ): Promise<void>
}
export class InvalidActivationTokenError
extends Error {
  constructor() {
    super(
      'Activation token is invalid or expired',
    )

    this.name =
      'InvalidActivationTokenError'
  }
}

type Clock = () => Date

export class AccountActivationService 
implements AccountActivationUseCase{
  constructor(
    private readonly repository:
      AccountActivationRepository,

    private readonly passwordHasher:
      PasswordHasher,

    private readonly clock:
      Clock = () => new Date(),
  ) {}

  async activateAccount(
    input: ActivateAccountInput,
  ): Promise<void> {
    // Kiểm tra password policy trước khi
    // thực hiện Argon2 hoặc ghi database.
    const normalizedPassword =
      validateNewPassword(
        input.newPassword,
      )

    const tokenHash =
      hashActionToken(
        input.rawToken,
      )

 const checkedAt =
  this.clock()

const candidate =
  await this.repository
    .findUsableActivationToken(
      tokenHash,
      checkedAt,
    )

    if (!candidate) {
      throw new InvalidActivationTokenError()
    }

    const passwordHash =
      await this.passwordHasher.hash(
        normalizedPassword,
      )
      const activatedAt =
  this.clock()
    const completed =
      await this.repository
        .completeActivation({
          tokenId:
            candidate.tokenId,

          userId:
            candidate.userId,

          tokenHash,
          passwordHash,
          activatedAt,
        })

    if (!completed) {
      // Token có thể vừa được request khác
      // sử dụng sau bước find.
      throw new InvalidActivationTokenError()
    }
  }
}