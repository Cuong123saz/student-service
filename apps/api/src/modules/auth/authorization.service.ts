import type {
  SystemPermissionCode,
} from './authorization.constants.js'

export interface PermissionCheckInput {
  userId: string
  permission: SystemPermissionCode
}

export interface AuthorizationRepository {
  hasPermission(
    input: PermissionCheckInput,
  ): Promise<boolean>
}

export interface AuthorizationUseCase {
  hasPermission(
    input: PermissionCheckInput,
  ): Promise<boolean>
}

export class AuthorizationService
implements AuthorizationUseCase {
  constructor(
    private readonly repository:
      AuthorizationRepository,
  ) {}

  hasPermission(
    input: PermissionCheckInput,
  ): Promise<boolean> {
    return this.repository
      .hasPermission(input)
  }
}
