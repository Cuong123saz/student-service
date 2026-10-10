import type {
  PublicProcedure,
  ValidationIssue,
  ProcedureActor,
} from '../procedures/procedure.contract.js'
export type DraftValues = Record<string, string | number | boolean | null>
export type SubmissionActor = ProcedureActor
export type SubmittedStatus =
  'SUBMITTED' | 'IN_REVIEW' | 'NEEDS_SUPPLEMENT' | 'APPROVED' | 'REJECTED'
export type SubmissionStatus = 'DRAFT' | SubmittedStatus
export type ResolutionAction = 'REQUEST_SUPPLEMENT' | 'APPROVE' | 'REJECT'
export type SubmissionEventAction =
  'SUBMITTED' | 'CLAIMED' | 'SUPPLEMENT_REQUESTED' | 'RESUBMITTED' | 'APPROVED' | 'REJECTED'
export interface StudentSnapshot {
  fullName: string
  studentCode: string
  classCode: string
  facultyCode: string
}
export interface EvidenceView {
  id: string
  attachmentKey: string
  name: string
  mimeType: string
  size: number
  sha256: string
  signatureStatus: 'NOT_CHECKED'
}
export interface SubmissionRoundView {
  roundNumber: number
  submittedAt: string
  studentSnapshot: StudentSnapshot
  values: DraftValues
  files: EvidenceView[]
  source: 'LIVE' | 'MIGRATION'
}
export interface SubmissionEventView {
  id: string
  roundNumber: number
  action: SubmissionEventAction
  actorName: string
  note: string | null
  createdAt: string
}
export interface RoundEvidence extends EvidenceView {
  storageKey: string
}
export interface SubmissionHistory {
  roundNumber: number
  lastSubmittedAt: string | null
  decisionAt: string | null
  rounds: SubmissionRoundView[]
  events: SubmissionEventView[]
}
export interface DraftView extends SubmissionHistory {
  id: string
  serviceId: number
  serviceName: string
  revision: number
  status: SubmissionStatus
  submittedAt: string | null
  reviewStartedAt: string | null
  procedure: PublicProcedure
  values: DraftValues
  files: EvidenceView[]
  issues: ValidationIssue[]
  editable: boolean
  readOnlyReason: string | null
  updatedAt: string
}
export interface ReviewSummary {
  id: string
  serviceName: string
  status: SubmittedStatus
  revision: number
  submittedAt: string
  roundNumber: number
  lastSubmittedAt: string | null
  decisionAt: string | null
  processingUnitName: string
  student: Pick<StudentSnapshot, 'fullName' | 'studentCode'>
  reviewerName: string | null
  canClaim: boolean
}
export interface ReviewDetail extends ReviewSummary, SubmissionHistory {
  allowedActions: ResolutionAction[]
  serviceId: number
  procedure: PublicProcedure
  values: DraftValues
  files: EvidenceView[]
  studentSnapshot: StudentSnapshot
  reviewStartedAt: string | null
}
export interface StoredEvidence {
  key: string
  name: string
  mimeType: string
  size: number
  sha256: string
}
export interface StoredFileIntegrity {
  key: string
  size: number
  sha256: string
}
export type VerifySubmissionFiles = (files: StoredFileIntegrity[]) => Promise<void>
export class SubmissionError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly issues: ValidationIssue[] = [],
  ) {
    super(message)
  }
}
export const missingDraft = () =>
  new SubmissionError(404, 'NOT_FOUND', 'Không tìm thấy hồ sơ hoặc minh chứng.')
export const revisionConflict = () =>
  new SubmissionError(
    409,
    'REVISION_CONFLICT',
    'Hồ sơ đã thay đổi ở phiên khác. Nội dung đang nhập được giữ lại; tải bản mới để đối chiếu.',
  )
export const reviewForbidden = () =>
  new SubmissionError(403, 'FORBIDDEN', 'Bạn không còn quyền tiếp nhận hồ sơ trong phạm vi hợp lệ.')
export const integrityFailure = () =>
  new SubmissionError(
    503,
    'FILE_INTEGRITY',
    'Không đọc được tệp gốc hoặc tệp không vượt qua kiểm tra toàn vẹn. Vui lòng liên hệ đơn vị xử lý.',
  )
