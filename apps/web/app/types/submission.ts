import type { PublicProcedure, ProcedureIssue } from './procedure'
export type SubmissionStatus =
  'DRAFT' | 'SUBMITTED' | 'IN_REVIEW' | 'NEEDS_SUPPLEMENT' | 'APPROVED' | 'REJECTED'
export type ResolutionAction = 'REQUEST_SUPPLEMENT' | 'APPROVE' | 'REJECT'
export type DraftValues = Record<string, string | number | boolean | null>
export interface Evidence {
  id: string
  attachmentKey: string
  name: string
  mimeType: string
  size: number
  sha256: string
  signatureStatus: 'NOT_CHECKED'
}
export interface SubmissionStudentSnapshot {
  fullName: string
  studentCode: string
  classCode: string
  facultyCode: string
}
export interface SubmissionRound {
  roundNumber: number
  submittedAt: string
  studentSnapshot: SubmissionStudentSnapshot
  values: DraftValues
  files: Evidence[]
  source: 'LIVE' | 'MIGRATION'
}
export interface SubmissionEvent {
  id: string
  roundNumber: number
  action:
    | 'SUBMITTED'
    | 'CLAIMED'
    | 'SUPPLEMENT_REQUESTED'
    | 'RESUBMITTED'
    | 'APPROVED'
    | 'REJECTED'
    | 'REASSIGNED'
  reassignment: { fromReviewerName: string; toReviewerName: string } | null
  actorName: string
  note: string | null
  createdAt: string
}
export interface SubmissionProgress {
  roundNumber: number
  lastSubmittedAt: string | null
  decisionAt: string | null
}
export interface SubmissionHistory extends SubmissionProgress {
  rounds: SubmissionRound[]
  events: SubmissionEvent[]
}
export interface StudentDraft extends SubmissionHistory {
  id: string
  serviceId: number
  serviceName: string
  revision: number
  status: SubmissionStatus
  procedure: PublicProcedure
  values: DraftValues
  files: Evidence[]
  issues: ProcedureIssue[]
  editable: boolean
  readOnlyReason: string | null
  submittedAt: string | null
  reviewStartedAt: string | null
  updatedAt: string
}
export interface DraftSummary extends SubmissionProgress {
  id: string
  serviceName: string
  status: SubmissionStatus
  revision: number
  submittedAt: string | null
  reviewStartedAt: string | null
  updatedAt: string
}
export interface ReviewSubmissionSummary extends SubmissionProgress {
  id: string
  serviceName: string
  status: Exclude<SubmissionStatus, 'DRAFT'>
  revision: number
  submittedAt: string
  processingUnitName: string
  student: { fullName: string; studentCode: string }
  reviewerName: string | null
  canClaim: boolean
}
export interface ReviewSubmissionDetail extends ReviewSubmissionSummary, SubmissionHistory {
  serviceId: number
  procedure: PublicProcedure
  values: DraftValues
  files: Evidence[]
  studentSnapshot: SubmissionStudentSnapshot
  reviewStartedAt: string | null
  allowedActions: ResolutionAction[]
  canReassign: boolean
}
