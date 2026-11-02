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
  /** Niên khóa (lưu năm vào học; hiển thị K = năm − 2006), null khi chưa có. */
  cohortYear: number | null
  /** Ngày sinh yyyy-mm-dd (dữ liệu cá nhân, ADR 0027), null khi chưa có. */
  dateOfBirth: string | null
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
