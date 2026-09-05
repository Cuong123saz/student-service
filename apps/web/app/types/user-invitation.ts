import type { SystemRoleCode } from '~/types/auth'

export interface CreateUserInvitationInput {
  username: string
  email: string
  fullName: string
  roles: SystemRoleCode[]
  studentCode?: string
  classId?: string
}

export interface CreateUserInvitationResponse {
  user: {
    id: string
    status: 'INVITED'
  }
  invitation: {
    deliveryStatus: 'SENT' | 'FAILED'
  }
}
