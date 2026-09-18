import type { PasswordHasher } from './password-hasher.js'

export interface UserForAuthentication {
  id: string
  username: string
  passwordHash: string | null
  status: string
  mustChangePassword: boolean
  roles: string[]
}

export interface AuthenticatedUser {
  id: string
  username: string
  mustChangePassword: boolean
  roles: string[]
}

export interface AuthUserRepository {
  findByUsername(username: string): Promise<UserForAuthentication | null>
}

export interface LoginInput {
  username: string
  password: string
}
export interface AuthenticationUseCase {
  authenticate(input: LoginInput): Promise<AuthenticatedUser>
}
export class InvalidCredentialsError extends Error {
  constructor() {
    super('Invalid username or password')
    this.name = 'InvalidCredentialsError'
  }
}

export class AuthService implements AuthenticationUseCase {
  constructor(
    private readonly userRepository: AuthUserRepository,

    private readonly passwordHasher: PasswordHasher,

    private readonly dummyPasswordHash: string,
  ) {}

  async authenticate(input: LoginInput): Promise<AuthenticatedUser> {
    const normalizedUsername = input.username.trim().toLowerCase()

    const user = normalizedUsername
      ? await this.userRepository.findByUsername(normalizedUsername)
      : null

    const passwordHash = user?.passwordHash ?? this.dummyPasswordHash

    const passwordMatches = await this.passwordHasher.verify(passwordHash, input.password)

    if (!user || !user.passwordHash || user.status !== 'ACTIVE' || !passwordMatches) {
      throw new InvalidCredentialsError()
    }

    return {
      id: user.id,
      username: user.username,
      mustChangePassword: user.mustChangePassword,
      roles: [...user.roles],
    }
  }
}
