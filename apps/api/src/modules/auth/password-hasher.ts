import * as argon2 from 'argon2'

export interface PasswordHasher {
  hash(
    plainTextPassword: string,
  ): Promise<string>

  verify(
    passwordHash: string,
    plainTextPassword: string,
  ): Promise<boolean>
}

export class Argon2PasswordHasher
implements PasswordHasher {
  async hash(
    plainTextPassword: string,
  ): Promise<string> {
    return argon2.hash(plainTextPassword, {
      type: argon2.argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    })
  }

  async verify(
    passwordHash: string,
    plainTextPassword: string,
  ): Promise<boolean> {
    return argon2.verify(
      passwordHash,
      plainTextPassword,
    )
  }
}