import type { SystemRoleCode } from './auth.constants.js'

export const SYSTEM_PERMISSIONS = [
  {
    code: 'training_point.period.manage',
    name: 'Quản lý đợt điểm rèn luyện',
    description: 'Thiết lập và mở/đóng đợt trong phạm vi được giao',
  },
  {
    code: 'document.mock_sign',
    name: 'Ký mô phỏng dữ liệu giả',
    description: 'Chỉ dùng diễn tập giả, chưa phải thẩm quyền ký thật',
  },
  {
    code: 'student.read',
    name: 'Xem sinh viên',
    description: 'Xem hồ sơ sinh viên trong phạm vi được giao',
  },
  {
    code: 'student.create',
    name: 'Tạo sinh viên',
    description: 'Tạo tài khoản và hồ sơ sinh viên',
  },
  {
    code: 'student.update',
    name: 'Cập nhật sinh viên',
    description: 'Cập nhật thông tin sinh viên trong phạm vi được giao',
  },
  {
    code: 'student.import',
    name: 'Import sinh viên',
    description: 'Import tài khoản sinh viên từ Excel hoặc CSV',
  },
  {
    code: 'student.export',
    name: 'Export sinh viên',
    description: 'Export danh sách sinh viên trong phạm vi được giao',
  },
  {
    code: 'user.manage',
    name: 'Quản lý người dùng',
    description: 'Quản lý trạng thái và thông tin tài khoản',
  },
  {
    code: 'role.manage',
    name: 'Quản lý vai trò',
    description: 'Gán hoặc thu hồi vai trò trong phạm vi cho phép',
  },
  {
    code: 'organization.manage',
    name: 'Quản lý cơ cấu',
    description: 'Quản lý khoa, lớp, đơn vị và phân công cố vấn',
  },
  {
    code: 'audit.read',
    name: 'Xem nhật ký audit',
    description: 'Tra cứu nhật ký thay đổi dữ liệu quan trọng',
  },
  {
    code: 'service.configure',
    name: 'Cấu hình dịch vụ',
    description: 'Quản lý cấu hình dịch vụ và biểu mẫu',
  },
  {
    code: 'submission.review',
    name: 'Xét duyệt hồ sơ',
    description: 'Xem xét hồ sơ được giao trong workflow',
  },
  {
    code: 'submission.assign',
    name: 'Phân công lại cán bộ',
    description: 'Phân công lại cán bộ xử lý hồ sơ',
  },
  {
    code: 'submission.reject',
    name: 'Trả lại hồ sơ',
    description: 'Trả hồ sơ cho người nộp bổ sung hoặc chỉnh sửa',
  },
  {
    code: 'document.retry',
    name: 'Mở thêm lượt tạo tài liệu',
    description: 'Mở một lượt kỹ thuật sau khi kiểm tra lỗi, trong phạm vi hồ sơ được giao',
  },
  {
    code: 'document.sign',
    name: 'Ký tài liệu',
    description: 'Ký tài liệu khi được workflow phân công',
  },
  {
    code: 'training_point.review',
    name: 'Duyệt điểm rèn luyện',
    description: 'Duyệt kê khai điểm rèn luyện theo lớp được giao',
  },
  {
    code: 'training_point.faculty_approve',
    name: 'Duyệt điểm rèn luyện cấp khoa',
    description: 'Phê duyệt kết quả điểm rèn luyện ở cấp khoa',
  },
  {
    code: 'training_point.monitor_confirm',
    name: 'Lớp trưởng xác nhận điểm rèn luyện',
    description: 'Xác nhận phiếu và xem dữ liệu lớp mình trong nhiệm kỳ',
  },
  {
    code: 'club.read',
    name: 'Xem CLB',
    description: 'Xem danh sách CLB và người phụ trách trong phạm vi',
  },
  {
    code: 'club.manage',
    name: 'Quản lý CLB',
    description: 'Tạo, sửa, tạm dừng, giải thể CLB và gán người phụ trách',
  },
  {
    code: 'activity.read',
    name: 'Xem hoạt động ngoại khóa',
    description: 'Xem mọi hoạt động ngoại khóa và lịch sử thay đổi',
  },
  {
    code: 'activity.mandatory.manage',
    name: 'Quản lý hoạt động bắt buộc',
    description: 'Tạo, sửa, công bố, hủy và giao CLB thực hiện hoạt động bắt buộc',
  },
  {
    code: 'activity.moderate',
    name: 'Kiểm soát hoạt động ngoại khóa',
    description: 'Tạm dừng hoặc mở lại hoạt động đã công bố',
  },
  {
    code: 'activity.club.manage',
    name: 'Quản lý hoạt động của CLB',
    description: 'Tạo, sửa, công bố và hủy hoạt động tự nguyện của CLB trong nhiệm kỳ',
  },
] as const

export type SystemPermissionCode = (typeof SYSTEM_PERMISSIONS)[number]['code']

// ADR 0029: SYSTEM_ADMIN assigns roles but does not act as CTSV, so it never manages clubs.
const systemAdminExcluded = new Set<string>([
  'document.mock_sign',
  'club.manage',
  // ADR 0030: SYSTEM_ADMIN only reads activities.
  'activity.mandatory.manage',
  'activity.moderate',
  'activity.club.manage',
])
const allPermissionCodes = SYSTEM_PERMISSIONS.filter(
  (permission) => !systemAdminExcluded.has(permission.code),
).map((permission) => permission.code)

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
  DOCUMENT_SIGNER: ['document.sign'],
  CLASS_MONITOR: ['training_point.monitor_confirm'],
  STUDENT_AFFAIRS: [
    'club.read',
    'club.manage',
    'activity.read',
    'activity.mandatory.manage',
    'activity.moderate',
  ],
  TRAINING_OFFICE: ['club.read', 'activity.read', 'activity.mandatory.manage'],
  CLUB_LEADER: ['club.read', 'activity.club.manage'],
} as const satisfies Record<SystemRoleCode, readonly SystemPermissionCode[]>
