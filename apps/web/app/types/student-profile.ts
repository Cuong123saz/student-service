export interface StudentIdentity {
  id: string
  code: string
  name: string
}

export interface StudentProfile {
  userId: string
  username: string
  fullName: string
  email: string | null
  studentCode: string
  class: StudentIdentity
  faculty: StudentIdentity
}

export interface CurrentAdvisor {
  userId: string
  username: string
  fullName: string
  email: string | null
  class: StudentIdentity
  validFrom: string
  validTo: string | null
}

export interface StudentProfileResponse {
  profile: StudentProfile
}

export interface CurrentAdvisorResponse {
  assignmentStatus: 'ASSIGNED' | 'UNASSIGNED'
  advisor: CurrentAdvisor | null
}
