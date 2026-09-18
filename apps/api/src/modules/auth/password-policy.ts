export const MIN_PASSWORD_LENGTH = 15
export const MAX_PASSWORD_LENGTH = 128

export class InvalidPasswordError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidPasswordError'
  }
}

export function validateNewPassword(password: string): string {
  const normalizedPassword = password.normalize('NFC')

  const passwordLength = [...normalizedPassword].length

  if (passwordLength < MIN_PASSWORD_LENGTH) {
    throw new InvalidPasswordError(
      `Password must contain at least ${MIN_PASSWORD_LENGTH} characters`,
    )
  }

  if (passwordLength > MAX_PASSWORD_LENGTH) {
    throw new InvalidPasswordError(`Password must not exceed ${MAX_PASSWORD_LENGTH} characters`)
  }

  return normalizedPassword
}
