import type { TrainingAnswers, TrainingCriterion, TrainingDeclaration } from './training-point'
export type ReviewState =
  'WAITING_MONITOR' | 'WAITING_ADVISOR' | 'WAITING_FACULTY' | 'RETURNED_TO_ADVISOR' | 'APPROVED'
export type ReviewAction =
  'monitor-confirm' | 'monitor-bypass' | 'advisor-sign' | 'faculty-return' | 'faculty-approve'
export interface ReviewDecision {
  id: string
  revision: number
  action:
    | 'MONITOR_CONFIRMED'
    | 'MONITOR_BYPASSED'
    | 'ADVISOR_SIGNED'
    | 'FACULTY_RETURNED'
    | 'FACULTY_APPROVED'
  actor: { userId: string; username: string; fullName: string; roleCode: string }
  answers: TrainingAnswers
  totalPoints: number
  comment: string
  declarationSha256: string
  parentDecisionId: string | null
  requestId: string
  inputRevision: number
  payloadSha256: string
  confirmedAt: string
  technicalSignatureStatus: 'NOT_VERIFIED'
  legalEffect: false
}
export interface ReviewDetail {
  id: string
  periodId: string
  period: {
    name: string
    academicYear: string
    semester: string
    policyLabel: string
    criteria: TrainingCriterion[]
  }
  student: TrainingDeclaration['student']
  answers: TrainingAnswers
  totalPoints: number
  submittedAt: string
  declarationSha256: string
  files: TrainingDeclaration['files']
  state: ReviewState
  revision: number
  decisions: ReviewDecision[]
  historyTruncated: boolean
  canAdvisorSign: boolean
  canFacultyDecide: boolean
  /** ADR 0028 */
  canMonitorConfirm: boolean
  canAdvisorBypass: boolean
}
export interface ReviewPeriod {
  id: string
  name: string
  academicYear: string
  semester: string
  classCode: string
  className: string
  facultyName: string
  status: string
}
export interface ReviewQueue {
  period: {
    id: string
    name: string
    classCode: string
    academicYear: string
    semester: string
    status: string
  }
  summary: {
    submitted: number
    waitingMonitor: number
    waitingAdvisor: number
    waitingFaculty: number
    returnedToAdvisor: number
    approved: number
    approvedTotalPoints: number
    approvedAveragePoints: number | null
  }
  items: {
    id: string
    student: TrainingDeclaration['student']
    selfPoints: number
    reviewPoints: number | null
    revision: number
    state: ReviewState
  }[]
  nextCursor: string | null
}

/** ADR 0028: class roster for the advisor, faculty or class monitor. */
export interface ReviewRosterStudent {
  userId: string
  studentCode: string
  fullName: string
  email: string | null
  cohortYear: number | null
  dateOfBirth: string | null
  declarationState: 'NONE' | 'DRAFT' | 'SUBMITTED'
  declarationId: string | null
  isMonitor: boolean
}
export interface ReviewRoster {
  period: { id: string; classCode: string; name: string }
  canAppointMonitor: boolean
  viewerRole: 'ADVISOR' | 'FACULTY' | 'MONITOR'
  monitor: { userId: string; fullName: string; validFrom: string; validTo: string | null } | null
  students: ReviewRosterStudent[]
  truncated: boolean
}
export interface MonitorAuditItem {
  id: string
  occurredAt: string
  actor: string
  action: string
  metadata: Record<string, unknown>
}
