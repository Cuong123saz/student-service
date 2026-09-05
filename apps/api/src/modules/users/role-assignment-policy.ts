import type {
  SystemRoleCode,
} from '../auth/auth.constants.js'

const ADMIN_ASSIGNABLE_ROLES =
  new Set<SystemRoleCode>([
    'STUDENT',
    'ACADEMIC_ADVISOR',
    'FACULTY_REVIEWER',
    'DOCUMENT_SIGNER',
  ])

export class EmptyRoleAssignmentError
extends Error {
  constructor() {
    super(
      'At least one role is required',
    )

    this.name =
      'EmptyRoleAssignmentError'
  }
}

export class ForbiddenRoleAssignmentError
extends Error {
  constructor() {
    super(
      'You are not allowed to assign these roles',
    )

    this.name =
      'ForbiddenRoleAssignmentError'
  }
}

export function assertCanAssignRoles(
  actorRoles: readonly string[],
  targetRoles:
    readonly SystemRoleCode[],
): void {
  if (targetRoles.length === 0) {
    throw new EmptyRoleAssignmentError()
  }

  if (
    actorRoles.includes(
      'SYSTEM_ADMIN',
    )
  ) {
    return
  }

  const adminCanAssignEveryRole =
    actorRoles.includes('ADMIN')
    && targetRoles.every(
      (role) =>
        ADMIN_ASSIGNABLE_ROLES
          .has(role),
    )

  if (adminCanAssignEveryRole) {
    return
  }

  throw new ForbiddenRoleAssignmentError()
}