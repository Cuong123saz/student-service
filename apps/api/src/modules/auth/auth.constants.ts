export const SYSTEM_ROLES = [
  {
    code: 'SYSTEM_ADMIN',
    name: 'Quản trị hệ thống',
    description:
      'Quản lý cấu hình và quyền cao nhất của hệ thống',
    isSystem: true,
  },
  {
    code: 'ADMIN',
    name: 'Quản trị nghiệp vụ',
    description:
      'Quản lý người dùng, dịch vụ và quy trình',
    isSystem: true,
  },
  {
    code: 'STUDENT',
    name: 'Sinh viên',
    description:
      'Kê khai và theo dõi hồ sơ của bản thân',
    isSystem: true,
  },
  {
    code: 'ACADEMIC_ADVISOR',
    name: 'Giảng viên cố vấn',
    description:
      'Duyệt hồ sơ và điểm rèn luyện của lớp được phân công',
    isSystem: true,
  },
  {
    code: 'FACULTY_REVIEWER',
    name: 'Cán bộ khoa',
    description:
      'Tiếp nhận và duyệt hồ sơ thuộc phạm vi khoa',
    isSystem: true,
  },
  {
    code: 'DOCUMENT_SIGNER',
    name: 'Người ký văn bản',
    description:
      'Thực hiện ký văn bản khi được phân công',
    isSystem: true,
  },
] as const
export const USER_API_PREFIX =
  '/api/v1/user'

export const USER_SESSION_COOKIE_NAME =
  'user_session'

export const USER_SESSION_TTL_SECONDS =
  2 * 60 * 60

export const USER_JWT_AUDIENCE =
  'student-service-user'
export type SystemRoleCode =
  (typeof SYSTEM_ROLES)[number]['code']

export const ADMIN_API_PREFIX =
  '/api/v1/admin'
export const ADMIN_SESSION_COOKIE_NAME =
  'admin_session'

export const ADMIN_SESSION_TTL_SECONDS =
  15 * 60

export const ADMIN_JWT_AUDIENCE =
  'student-service-admin'

export const JWT_ISSUER =
  'student-service-api'