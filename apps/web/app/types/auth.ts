export type SystemRoleCode =
  'SYSTEM_ADMIN' | 'ADMIN' | 'STUDENT' | 'ACADEMIC_ADVISOR' | 'FACULTY_REVIEWER' | 'DOCUMENT_SIGNER'

export interface SessionUser {
  id: string
  username: string
  mustChangePassword: boolean
  roles: SystemRoleCode[]
}

export type AdminSessionUser = SessionUser
export type UserSessionUser = SessionUser

export interface LoginInput {
  username: string
  password: string
}

export type AdminLoginInput = LoginInput
export type UserLoginInput = LoginInput

export interface SessionResponse {
  user: SessionUser
}

export type AdminLoginResponse = SessionResponse
export type CurrentAdminResponse = SessionResponse
export type UserLoginResponse = SessionResponse
export type CurrentUserResponse = SessionResponse

export interface AdminChangePasswordInput {
  currentPassword: string
  newPassword: string
}

export const roleLabels: Record<SystemRoleCode, string> = {
  SYSTEM_ADMIN: 'Quản trị hệ thống',
  ADMIN: 'Quản trị nghiệp vụ',
  STUDENT: 'Sinh viên',
  ACADEMIC_ADVISOR: 'Giảng viên cố vấn',
  FACULTY_REVIEWER: 'Cán bộ khoa',
  DOCUMENT_SIGNER: 'Người ký văn bản',
}
