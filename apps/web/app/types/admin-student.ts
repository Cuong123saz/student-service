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
  /** Niên khóa (lưu năm vào học; hiển thị K = năm − 2006), null khi chưa có. */
  cohortYear: number | null
  /** Ngày sinh yyyy-mm-dd (dữ liệu cá nhân, ADR 0027), null khi chưa có. */
  dateOfBirth: string | null
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
