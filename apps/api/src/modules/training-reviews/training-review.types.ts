import type { Answers, Criterion } from '../training-points/training-points.types.js'
export type ReviewAction =
  | 'MONITOR_CONFIRMED'
  | 'MONITOR_BYPASSED'
  | 'ADVISOR_SIGNED'
  | 'FACULTY_RETURNED'
  | 'FACULTY_APPROVED'
export type ReviewState =
  'WAITING_MONITOR' | 'WAITING_ADVISOR' | 'WAITING_FACULTY' | 'RETURNED_TO_ADVISOR' | 'APPROVED'
export interface ReviewInput {
  expectedRevision: number
  requestId: string
  confirmed: true
  comment: string
  answers?: Answers
}
export interface ReviewDecision {
  id: string
  revision: number
  action: ReviewAction
  actor: { userId: string; username: string; fullName: string; roleCode: string }
  answers: Answers
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
    criteria: Criterion[]
  }
  student: { fullName: string; studentCode: string; classCode: string; facultyCode: string }
  answers: Answers
  totalPoints: number
  submittedAt: string
  declarationSha256: string
  files: {
    id: string
    criterion: string
    name: string
    mimeType: string
    size: number
    sha256: string
    signatureStatus: 'NOT_CHECKED'
  }[]
  state: ReviewState
  revision: number
  decisions: ReviewDecision[]
  historyTruncated: boolean
  canAdvisorSign: boolean
  canFacultyDecide: boolean
  /** ADR 0028: the class monitor confirms first; the advisor may bypass with a reason. */
  canMonitorConfirm: boolean
  canAdvisorBypass: boolean
}
/** ADR 0028: with no decision yet, a declaration waits for the monitor unless its student is the monitor. */
export const reviewState = (action?: ReviewAction, studentIsMonitor = false): ReviewState =>
  action === undefined && !studentIsMonitor
    ? 'WAITING_MONITOR'
    : action === 'ADVISOR_SIGNED'
      ? 'WAITING_FACULTY'
      : action === 'FACULTY_RETURNED'
        ? 'RETURNED_TO_ADVISOR'
        : action === 'FACULTY_APPROVED'
          ? 'APPROVED'
          : 'WAITING_ADVISOR'

export interface ReviewPeriod {
  id: string
  name: string
  academicYear: string
  semester: string
  status: string
  classCode: string
  className: string
  facultyName: string
}
export interface ReviewQueueRow {
  id: string
  student: ReviewDetail['student']
  selfPoints: number
  reviewPoints: number | null
  revision: number
  state: ReviewState
}
export interface ReviewSummary {
  submitted: number
  waitingMonitor: number
  waitingAdvisor: number
  waitingFaculty: number
  returnedToAdvisor: number
  approved: number
  approvedTotalPoints: number
  approvedAveragePoints: number | null
}
export interface ReviewQueuePeriod {
  id: string
  name: string
  classCode: string
  academicYear: string
  semester: string
  status: string
}
