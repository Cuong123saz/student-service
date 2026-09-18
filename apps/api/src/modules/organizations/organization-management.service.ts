export type OrganizationStatus = 'ACTIVE' | 'INACTIVE'

export interface OrganizationActor {
  userId: string
  username: string
}

export interface OrganizationAuditContext {
  requestId: string | null
  ipAddress: string | null
  userAgent: string | null
}

export interface ManagedAdvisor {
  userId: string
  username: string
  fullName: string
  email: string | null
}

export interface CurrentAdvisor extends ManagedAdvisor {
  assignmentId: string
  validFrom: Date
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

export interface OrganizationMutationContext {
  actor: OrganizationActor
  audit: OrganizationAuditContext
  changedAt: Date
}

export interface CreateFacultyInput extends OrganizationMutationContext {
  code: string
  name: string
}

export interface UpdateFacultyInput extends OrganizationMutationContext {
  facultyId: string
  code?: string
  name?: string
  status?: OrganizationStatus
}

export interface CreateOrganizationalUnitInput extends OrganizationMutationContext {
  code: string
  name: string
}

export interface UpdateOrganizationalUnitInput extends OrganizationMutationContext {
  organizationalUnitId: string
  code?: string
  name?: string
  status?: OrganizationStatus
}

export interface CreateAcademicClassInput extends OrganizationMutationContext {
  facultyId: string
  code: string
  name: string
}

export interface UpdateAcademicClassInput extends OrganizationMutationContext {
  classId: string
  facultyId?: string
  code?: string
  name?: string
  status?: OrganizationStatus
}

export interface SetAcademicAdvisorInput extends OrganizationMutationContext {
  classId: string
  advisorUserId: string | null
  effectiveAt: Date
}

export interface OrganizationManagementRepository {
  getSnapshot(actorUserId: string, at: Date): Promise<OrganizationManagementSnapshot>

  createFaculty(input: CreateFacultyInput): Promise<{ id: string }>

  updateFaculty(input: UpdateFacultyInput): Promise<void>

  createOrganizationalUnit(input: CreateOrganizationalUnitInput): Promise<{ id: string }>

  updateOrganizationalUnit(input: UpdateOrganizationalUnitInput): Promise<void>

  createAcademicClass(input: CreateAcademicClassInput): Promise<{ id: string }>

  updateAcademicClass(input: UpdateAcademicClassInput): Promise<void>

  setAcademicAdvisor(input: SetAcademicAdvisorInput): Promise<void>
}

export interface OrganizationManagementUseCase {
  getSnapshot(actorUserId: string): Promise<OrganizationManagementSnapshot>

  createFaculty(input: Omit<CreateFacultyInput, 'changedAt'>): Promise<{ id: string }>

  updateFaculty(input: Omit<UpdateFacultyInput, 'changedAt'>): Promise<void>

  createOrganizationalUnit(
    input: Omit<CreateOrganizationalUnitInput, 'changedAt'>,
  ): Promise<{ id: string }>

  updateOrganizationalUnit(input: Omit<UpdateOrganizationalUnitInput, 'changedAt'>): Promise<void>

  createAcademicClass(input: Omit<CreateAcademicClassInput, 'changedAt'>): Promise<{ id: string }>

  updateAcademicClass(input: Omit<UpdateAcademicClassInput, 'changedAt'>): Promise<void>

  setAcademicAdvisor(input: Omit<SetAcademicAdvisorInput, 'changedAt'>): Promise<void>
}

export class OrganizationManagementService implements OrganizationManagementUseCase {
  constructor(
    private readonly repository: OrganizationManagementRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  getSnapshot(actorUserId: string): Promise<OrganizationManagementSnapshot> {
    return this.repository.getSnapshot(actorUserId, this.clock())
  }

  createFaculty(input: Omit<CreateFacultyInput, 'changedAt'>): Promise<{ id: string }> {
    return this.repository.createFaculty({
      ...input,
      changedAt: this.clock(),
    })
  }

  updateFaculty(input: Omit<UpdateFacultyInput, 'changedAt'>): Promise<void> {
    return this.repository.updateFaculty({
      ...input,
      changedAt: this.clock(),
    })
  }

  createOrganizationalUnit(
    input: Omit<CreateOrganizationalUnitInput, 'changedAt'>,
  ): Promise<{ id: string }> {
    return this.repository.createOrganizationalUnit({
      ...input,
      changedAt: this.clock(),
    })
  }

  updateOrganizationalUnit(input: Omit<UpdateOrganizationalUnitInput, 'changedAt'>): Promise<void> {
    return this.repository.updateOrganizationalUnit({
      ...input,
      changedAt: this.clock(),
    })
  }

  createAcademicClass(input: Omit<CreateAcademicClassInput, 'changedAt'>): Promise<{ id: string }> {
    return this.repository.createAcademicClass({
      ...input,
      changedAt: this.clock(),
    })
  }

  updateAcademicClass(input: Omit<UpdateAcademicClassInput, 'changedAt'>): Promise<void> {
    return this.repository.updateAcademicClass({
      ...input,
      changedAt: this.clock(),
    })
  }

  setAcademicAdvisor(input: Omit<SetAcademicAdvisorInput, 'changedAt'>): Promise<void> {
    return this.repository.setAcademicAdvisor({
      ...input,
      changedAt: this.clock(),
    })
  }
}
