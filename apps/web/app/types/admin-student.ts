export const studentAccountStatuses = ['INVITED', 'ACTIVE', 'INACTIVE', 'SUSPENDED'] as const

export type StudentAccountStatus = (typeof studentAccountStatuses)[number]

export const studentAccountStatusLabels: Record<StudentAccountStatus, string> = {
  INVITED: 'Chờ kích hoạt',
  ACTIVE: 'Đang hoạt động',
  INACTIVE: 'Ngừng hoạt động',
  SUSPENDED: 'Đã tạm khóa',
}

export interface AdminStudentIdentity {
  id: string
  code: string
  name: string
}

export interface AdminStudentDirectoryItem {
  userId: string
  username: string
  fullName: string
  email: string | null
  status: StudentAccountStatus
  studentCode: string
  /** Niên khóa (năm bắt đầu), null khi chưa có. */
  cohortYear: number | null
  academicClass: AdminStudentIdentity
  faculty: AdminStudentIdentity
}

export interface AdminStudentDirectoryResponse {
  students: AdminStudentDirectoryItem[]
  nextCursor: string | null
}

export interface AdminStudentDirectoryQuery {
  limit?: number
  after?: string
  status?: StudentAccountStatus
  facultyId?: string
  classId?: string
  search?: string
}

export interface UpdateAdminStudentInput {
  studentCode: string
  fullName: string
  facultyId: string
  classId: string
}
