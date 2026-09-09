import type {
  SystemRoleCode,
} from './auth.constants.js'

export const SYSTEM_PERMISSIONS = [
  {
    code: 'student.read',
    name: 'Xem sinh viên',
    description:
      'Xem hồ sơ sinh viên trong phạm vi được giao',
  },
  {
    code: 'student.create',
    name: 'Tạo sinh viên',
    description:
      'Tạo tài khoản và hồ sơ sinh viên',
  },
  {
    code: 'student.update',
    name: 'Cập nhật sinh viên',
    description:
      'Cập nhật thông tin sinh viên trong phạm vi được giao',
  },
  {
    code: 'student.import',
    name: 'Import sinh viên',
    description:
      'Import tài khoản sinh viên từ Excel hoặc CSV',
  },
  {
    code: 'student.export',
    name: 'Export sinh viên',
    description:
      'Export danh sách sinh viên trong phạm vi được giao',
  },
  {
    code: 'user.manage',
    name: 'Quản lý người dùng',
    description:
      'Quản lý trạng thái và thông tin tài khoản',
  },
  {
    code: 'role.manage',
    name: 'Quản lý vai trò',
    description:
      'Gán hoặc thu hồi vai trò trong phạm vi cho phép',
  },
  {
    code: 'organization.manage',
    name: 'Quản lý cơ cấu',
    description:
      'Quản lý khoa, lớp, đơn vị và phân công cố vấn',
  },
  {
    code: 'audit.read',
    name: 'Xem nhật ký audit',
    description:
      'Tra cứu nhật ký thay đổi dữ liệu quan trọng',
  },
  {
    code: 'service.configure',
    name: 'Cấu hình dịch vụ',
    description:
      'Quản lý cấu hình dịch vụ và biểu mẫu',
  },
  {
    code: 'submission.review',
    name: 'Xét duyệt hồ sơ',
    description:
      'Xem xét hồ sơ được giao trong workflow',
  },
  {
    code: 'submission.reject',
    name: 'Trả lại hồ sơ',
    description:
      'Trả hồ sơ cho người nộp bổ sung hoặc chỉnh sửa',
  },
  {
    code: 'document.sign',
    name: 'Ký tài liệu',
    description:
      'Ký tài liệu khi được workflow phân công',
  },
  {
    code: 'training_point.review',
    name: 'Duyệt điểm rèn luyện',
    description:
      'Duyệt kê khai điểm rèn luyện theo lớp được giao',
  },
  {
    code: 'training_point.faculty_approve',
    name: 'Duyệt điểm rèn luyện cấp khoa',
    description:
      'Phê duyệt kết quả điểm rèn luyện ở cấp khoa',
  },
] as const

export type SystemPermissionCode =
  (typeof SYSTEM_PERMISSIONS)[number]['code']

const allPermissionCodes =
  SYSTEM_PERMISSIONS.map(
    (permission) => permission.code,
  )

export const SYSTEM_ROLE_PERMISSIONS = {
  SYSTEM_ADMIN: allPermissionCodes,
  ADMIN: [
    'student.read',
    'student.create',
    'student.update',
    'student.import',
    'student.export',
    'user.manage',
    'role.manage',
    'organization.manage',
    'service.configure',
  ],
  STUDENT: [],
  ACADEMIC_ADVISOR: [
    'student.read',
    'submission.review',
    'submission.reject',
    'training_point.review',
  ],
  FACULTY_REVIEWER: [
    'student.read',
    'submission.review',
    'submission.reject',
    'training_point.faculty_approve',
  ],
  DOCUMENT_SIGNER: [
    'document.sign',
  ],
} as const satisfies Record<
  SystemRoleCode,
  readonly SystemPermissionCode[]
>
