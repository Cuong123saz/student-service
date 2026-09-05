import type {
  PasswordHasher,
} from './password-hasher.js'
import {
  validateNewPassword,
} from './password-policy.js'

export interface UserPasswordState {
  id: string
  passwordHash: string | null
  status: string
}

export interface PasswordChangeRepository {
  findPasswordStateById(
    userId: string,
  ): Promise<UserPasswordState | null>

  updatePassword(
    userId: string,
    passwordHash: string,
  ): Promise<boolean>
}

export interface ChangePasswordInput {
  userId: string
  currentPassword: string
  newPassword: string
}

export class AccountUnavailableError
extends Error {
  constructor() {
    super('Account unavailable')
    this.name =
      'AccountUnavailableError'
  }
}

export class CurrentPasswordMismatchError
extends Error {
  constructor() {
    super('Current password is incorrect')
    this.name =
      'CurrentPasswordMismatchError'
  }
}

export class PasswordReuseError
extends Error {
  constructor() {
    super(
      'New password must be different from current password',
    )
    this.name = 'PasswordReuseError'
  }
}

export class PasswordChangeService {
  constructor(
    private readonly repository:
      PasswordChangeRepository,

    private readonly passwordHasher:
      PasswordHasher,
  ) {}

  async changePassword(
    input: ChangePasswordInput,
  ): Promise<void> {
    const user =
      await this.repository
        .findPasswordStateById(
          input.userId,
        )

    if (
      !user
      || !user.passwordHash
      || user.status !== 'ACTIVE'
    ) {
      throw new AccountUnavailableError()
    }

    const currentPasswordMatches =
      await this.passwordHasher.verify(
        user.passwordHash,
        input.currentPassword,
      )

    if (!currentPasswordMatches) {
      throw new CurrentPasswordMismatchError()
    }

    const normalizedNewPassword =
      validateNewPassword(
        input.newPassword,
      )

    const reusesCurrentPassword =
      await this.passwordHasher.verify(
        user.passwordHash,
        normalizedNewPassword,
      )

    if (reusesCurrentPassword) {
      throw new PasswordReuseError()
    }

    const newPasswordHash =
      await this.passwordHasher.hash(
        normalizedNewPassword,
      )

    const updated =
      await this.repository
        .updatePassword(
          user.id,
          newPasswordHash,
        )

    if (!updated) {
      throw new AccountUnavailableError()
    }
  }
}