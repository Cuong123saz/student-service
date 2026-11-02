export const SYSTEM_ROLES = [
  {
    code: 'SYSTEM_ADMIN',
    name: 'Quản trị hệ thống',
    description: 'Quản lý cấu hình và quyền cao nhất của hệ thống',
    isSystem: true,
  },
  {
    code: 'ADMIN',
    name: 'Quản trị nghiệp vụ',
    description: 'Quản lý người dùng, dịch vụ và quy trình',
    isSystem: true,
  },
  {
    code: 'STUDENT',
    name: 'Sinh viên',
    description: 'Kê khai và theo dõi hồ sơ của bản thân',
    isSystem: true,
  },
  {
    code: 'ACADEMIC_ADVISOR',
    name: 'Giảng viên cố vấn',
    description: 'Duyệt hồ sơ và điểm rèn luyện của lớp được phân công',
    isSystem: true,
  },
  {
    code: 'FACULTY_REVIEWER',
    name: 'Cán bộ khoa',
    description: 'Tiếp nhận và duyệt hồ sơ thuộc phạm vi khoa',
    isSystem: true,
  },
  {
    code: 'DOCUMENT_SIGNER',
    name: 'Người ký văn bản',
    description: 'Thực hiện ký văn bản khi được phân công',
    isSystem: true,
  },
  {
    code: 'CLASS_MONITOR',
    name: 'Lớp trưởng',
    description: 'Xác nhận phiếu điểm rèn luyện và tổng hợp bảng điểm của lớp trong nhiệm kỳ',
    isSystem: true,
  },
  {
    code: 'STUDENT_AFFAIRS',
    name: 'Công tác sinh viên (CTSV)',
    description: 'Quản lý CLB và hoạt động ngoại khóa bắt buộc',
    isSystem: true,
  },
  {
    code: 'TRAINING_OFFICE',
    name: 'Phòng Đào tạo',
    description: 'Tạo hoạt động ngoại khóa bắt buộc trong phạm vi được gán',
    isSystem: true,
  },
  {
    code: 'CLUB_LEADER',
    name: 'Người phụ trách CLB',
    description: 'Mở hoạt động tự nguyện của CLB trong nhiệm kỳ',
    isSystem: true,
  },
] as const
export const USER_API_PREFIX = '/api/v1/user'

export const USER_SESSION_COOKIE_NAME = 'user_session'

export const USER_SESSION_TTL_SECONDS = 2 * 60 * 60

export const USER_JWT_AUDIENCE = 'student-service-user'
export type SystemRoleCode = (typeof SYSTEM_ROLES)[number]['code']

/** Roles that may sign in to and use the user portal (single source for login, guards, APIs). */
export const USER_PORTAL_ROLE_CODES: readonly string[] = [
  'STUDENT',
  'ACADEMIC_ADVISOR',
  'FACULTY_REVIEWER',
  'DOCUMENT_SIGNER',
  // ADR 0028/0029: the class monitor, CTSV, Phòng Đào tạo and club leaders work in the user portal.
  'CLASS_MONITOR',
  'STUDENT_AFFAIRS',
  'TRAINING_OFFICE',
  'CLUB_LEADER',
] satisfies SystemRoleCode[]

export const ADMIN_API_PREFIX = '/api/v1/admin'
export const ADMIN_SESSION_COOKIE_NAME = 'admin_session'

export const ADMIN_SESSION_TTL_SECONDS = 15 * 60

export const ADMIN_JWT_AUDIENCE = 'student-service-admin'

export const JWT_ISSUER = 'student-service-api'
