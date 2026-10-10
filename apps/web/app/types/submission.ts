import type { PublicProcedure, ProcedureIssue } from './procedure'
export type SubmissionStatus = 'DRAFT' | 'SUBMITTED' | 'IN_REVIEW'
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
export interface StudentDraft {
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
export interface DraftSummary {
  id: string
  serviceName: string
  status: SubmissionStatus
  revision: number
  submittedAt: string | null
  reviewStartedAt: string | null
  updatedAt: string
}

export interface ReviewSubmissionSummary {
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
export interface ReviewSubmissionDetail extends ReviewSubmissionSummary {
  serviceId: number
  procedure: PublicProcedure
  values: DraftValues
  files: Evidence[]
  studentSnapshot: {
    fullName: string
    studentCode: string
    classCode: string
    facultyCode: string
  }
  reviewStartedAt: string | null
}
