/** ADR 0030: extracurricular activities. */
export const activityKinds = ['MANDATORY', 'VOLUNTARY'] as const
export const activityCategories = ['SCHOOL', 'CLUB_ACADEMIC', 'VOLUNTEER'] as const
export const activityStatuses = ['DRAFT', 'PUBLISHED', 'SUSPENDED', 'CANCELLED'] as const
export const mandatoryOwners = ['STUDENT_AFFAIRS', 'TRAINING_OFFICE'] as const
export type ActivityKind = (typeof activityKinds)[number]
export type ActivityCategory = (typeof activityCategories)[number]
export type ActivityStatus = (typeof activityStatuses)[number]
export type MandatoryOwner = (typeof mandatoryOwners)[number]
export type ActivityOwnerType = MandatoryOwner | 'CLUB'

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
  ownerType: ActivityOwnerType
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
export interface ActivityPermissions {
  canEdit: boolean
  canPublish: boolean
  canCancel: boolean
  canDelegate: boolean
  canSuspend: boolean
  canResume: boolean
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
export interface ActivityDetail extends Activity, ActivityPermissions {
  events: ActivityEvent[]
}
export interface ActivityInput {
  kind: ActivityKind
  category: ActivityCategory
  ownerType?: MandatoryOwner
  clubId?: string
  title: string
  description: string
  location: string
  startsAt: string
  endsAt: string
  capacity: number | null
  eligibility: Eligibility
}
export type ActivityUpdate = Omit<ActivityInput, 'kind' | 'ownerType' | 'clubId'> & {
  expectedRevision: number
}
export const activityLimits = {
  maxDurationMs: 14 * 24 * 3600 * 1000,
  maxListItems: 50,
  minCohort: 2007,
  maxCohort: 2100,
  maxCapacity: 100000,
}
/** Fields whose changes are recorded in the history with before/after values. */
export const trackedFields = [
  'category',
  'title',
  'description',
  'location',
  'startsAt',
  'endsAt',
  'capacity',
  'eligibility',
] as const

/** ADR 0031: registration states; REGISTERED and CANCEL_REQUESTED hold a seat. */
export const registrationStatuses = [
  'REGISTERED',
  'WAITLISTED',
  'CANCEL_REQUESTED',
  'CANCELLED',
  'WITHDRAWN',
] as const
export type RegistrationStatus = (typeof registrationStatuses)[number]
/** Cancellation requests must be sent at least this long before the start. */
export const cancelNoticeMs = 24 * 3600 * 1000
