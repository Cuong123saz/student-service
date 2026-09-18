export type OrganizationStatus = 'ACTIVE' | 'INACTIVE'

export interface ManagedAdvisor {
  userId: string
  username: string
  fullName: string
  email: string | null
}

export interface CurrentAdvisor extends ManagedAdvisor {
  assignmentId: string
  validFrom: string
}

export interface ManagedAcademicClass {
  id: string
  code: string
  name: string
  status: OrganizationStatus
  canManage: boolean
  currentAdvisor: CurrentAdvisor | null
}

export interface ManagedFaculty {
  id: string
  code: string
  name: string
  status: OrganizationStatus
  canManage: boolean
  canCreateClass: boolean
  classes: ManagedAcademicClass[]
}

export interface ManagedOrganizationalUnit {
  id: string
  code: string
  name: string
  status: OrganizationStatus
  canManage: boolean
}

export interface OrganizationManagementSnapshot {
  faculties: ManagedFaculty[]
  organizationalUnits: ManagedOrganizationalUnit[]
  advisors: ManagedAdvisor[]
  capabilities: {
    canCreateFaculty: boolean
    canCreateOrganizationalUnit: boolean
  }
}

export interface CreateOrganizationInput {
  code: string
  name: string
}

export interface OrganizationApiError {
  status?: number
  field?: string
  message: string
}
