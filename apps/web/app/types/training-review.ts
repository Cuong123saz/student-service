import type { TrainingAnswers, TrainingCriterion, TrainingDeclaration } from './training-point'
export type ReviewState = 'WAITING_ADVISOR' | 'WAITING_FACULTY' | 'RETURNED_TO_ADVISOR' | 'APPROVED'
export type ReviewAction = 'advisor-sign' | 'faculty-return' | 'faculty-approve'
export interface ReviewDecision {
  id: string
  revision: number
  action: 'ADVISOR_SIGNED' | 'FACULTY_RETURNED' | 'FACULTY_APPROVED'
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
