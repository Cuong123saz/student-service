/** ADR 0030: extracurricular activities. */
export type ActivityKind = 'MANDATORY' | 'VOLUNTARY'
export type ActivityCategory = 'SCHOOL' | 'CLUB_ACADEMIC' | 'VOLUNTEER'
export type ActivityStatus = 'DRAFT' | 'PUBLISHED' | 'SUSPENDED' | 'CANCELLED'
export type MandatoryOwner = 'STUDENT_AFFAIRS' | 'TRAINING_OFFICE'
export interface Eligibility {
  facultyIds: string[]
  classIds: string[]
  cohortYears: number[]
}
export interface ClubRef {
  id: string
  code: string
  name: string
  status: 'ACTIVE' | 'SUSPENDED' | 'DISSOLVED'
}
export interface Activity {
  id: string
  kind: ActivityKind
  category: ActivityCategory
  ownerType: MandatoryOwner | 'CLUB'
  ownerClub: ClubRef | null
  delegatedClub: ClubRef | null
  title: string
  description: string
  location: string
  startsAt: string
  endsAt: string
  capacity: number | null
  eligibility: Eligibility
  status: ActivityStatus
  statusReason: string | null
  revision: number
  publishedAt: string | null
  createdAt: string
}
/** ADR 0031: REGISTERED and CANCEL_REQUESTED hold a seat. */
export type RegistrationStatus =
  'REGISTERED' | 'WAITLISTED' | 'CANCEL_REQUESTED' | 'CANCELLED' | 'WITHDRAWN'
export interface StudentRegistrationView {
  registrationId: string | null
  myStatus: RegistrationStatus | null
  seatsTaken: number
  waitlistPosition: number | null
  promotionNotice: boolean
  cancelDeadline: string
}
export type StudentActivity = Omit<Activity, 'eligibility' | 'statusReason'> &
  StudentRegistrationView
export interface RegistrationHistoryItem extends StudentRegistrationView {
  activityId: string
  title: string
  kind: ActivityKind
  startsAt: string
  endsAt: string
  activityStatus: ActivityStatus
  absent: boolean
  excused: boolean
}
export interface RosterEntry {
  id: string
  studentUserId: string
  studentCode: string
  fullName: string
  classCode: string
  status: RegistrationStatus
  absent: boolean
  queuedAt: string
  waitlistPosition: number | null
  cancelReason: string | null
  cancelRequestedAt: string | null
  decisionNote: string | null
  autoAccepted: boolean
  excused: boolean
  revision: number
}
export interface ActivityRoster {
  activity: { id: string; title: string; capacity: number | null; startsAt: string; endsAt: string }
  canDecide: boolean
  summary: {
    seats: number
    waitlisted: number
    pendingCancellations: number
    cancelled: number
    absent: number
  }
  items: RosterEntry[]
  truncated: boolean
}
export const registrationStatusLabels: Record<RegistrationStatus, string> = {
  REGISTERED: 'Đã đăng ký',
  WAITLISTED: 'Danh sách chờ',
  CANCEL_REQUESTED: 'Chờ duyệt hủy',
  CANCELLED: 'Đã hủy (được chấp nhận)',
  WITHDRAWN: 'Đã rút khỏi danh sách chờ',
}
export interface ActivityEvent {
  id: string
  revision: number
  action: string
  actor: string
  reason: string | null
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  createdAt: string
}
export interface ActivityDetail extends Activity {
  canEdit: boolean
  canPublish: boolean
  canCancel: boolean
  canDelegate: boolean
  canSuspend: boolean
  canResume: boolean
  events: ActivityEvent[]
}
export interface ActivityOptions {
  mandatoryOwners: MandatoryOwner[]
  trainingFacultyLimited: boolean
  faculties: { id: string; code: string; name: string }[]
  classes: { id: string; code: string; name: string; facultyId: string }[]
  leaderClubs: ClubRef[]
  delegationClubs: ClubRef[]
}
/** Editable fields, as sent to the API. */
export interface ActivityDraft {
  category: ActivityCategory
  title: string
  description: string
  location: string
  startsAt: string
  endsAt: string
  capacity: number | null
  eligibility: Eligibility
}
export const activityKindLabels: Record<ActivityKind, string> = {
  MANDATORY: 'Bắt buộc',
  VOLUNTARY: 'Tự nguyện',
}
export const activityCategoryLabels: Record<ActivityCategory, string> = {
  SCHOOL: 'Học viện tổ chức/điều động',
  CLUB_ACADEMIC: 'CLB, học thuật, ngoại khóa',
  VOLUNTEER: 'Hiến máu, tình nguyện, xã hội',
}
export const activityStatusLabels: Record<ActivityStatus, string> = {
  DRAFT: 'Bản nháp',
  PUBLISHED: 'Đã công bố',
  SUSPENDED: 'Bị tạm dừng',
  CANCELLED: 'Đã hủy',
}
export const activityOwnerLabels: Record<MandatoryOwner | 'CLUB', string> = {
  STUDENT_AFFAIRS: 'CTSV',
  TRAINING_OFFICE: 'Phòng Đào tạo',
  CLUB: 'CLB',
}
export const activityEventLabels: Record<string, string> = {
  CREATED: 'Tạo',
  UPDATED: 'Sửa',
  PUBLISHED: 'Công bố',
  SUSPENDED: 'Tạm dừng',
  RESUMED: 'Mở lại',
  CANCELLED: 'Hủy',
  DELEGATED: 'Giao CLB',
  DELEGATION_REVOKED: 'Rút giao CLB',
}
