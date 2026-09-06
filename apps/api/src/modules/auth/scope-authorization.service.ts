import type {
  SystemPermissionCode,
} from './authorization.constants.js'

export interface StudentScopeCheckInput {
  actorUserId: string
  permission: SystemPermissionCode
  studentUserId: string
}

export interface ScopeAuthorizationRepository {
  canAccessStudent(
    input: StudentScopeCheckInput,
  ): Promise<boolean>
}

export interface ScopeAuthorizationUseCase {
  canAccessStudent(
    input: StudentScopeCheckInput,
  ): Promise<boolean>
}

export class ScopeAuthorizationService
implements ScopeAuthorizationUseCase {
  constructor(
    private readonly repository:
      ScopeAuthorizationRepository,
  ) {}

  canAccessStudent(
    input: StudentScopeCheckInput,
  ): Promise<boolean> {
    return this.repository
      .canAccessStudent(input)
  }
}
