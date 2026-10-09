import type {
  PublicProcedure,
  ValidationIssue,
  ProcedureActor,
} from '../procedures/procedure.contract.js'
export type DraftValues = Record<string, string | number | boolean | null>
export type SubmissionActor = ProcedureActor
export interface EvidenceView {
  id: string
  attachmentKey: string
  name: string
  mimeType: string
  size: number
  sha256: string
  signatureStatus: 'NOT_CHECKED'
}
export interface DraftView {
  id: string
  serviceId: number
  serviceName: string
  revision: number
  status: 'DRAFT'
  procedure: PublicProcedure
  values: DraftValues
  files: EvidenceView[]
  issues: ValidationIssue[]
  editable: boolean
  readOnlyReason: string | null
  updatedAt: string
}
export interface StoredEvidence {
  key: string
  name: string
  mimeType: string
  size: number
  sha256: string
}
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
  new SubmissionError(404, 'NOT_FOUND', 'Không tìm thấy bản nháp hoặc minh chứng.')
export const revisionConflict = () =>
  new SubmissionError(
    409,
    'REVISION_CONFLICT',
    'Bản nháp đã thay đổi ở phiên khác. Nội dung đang nhập được giữ lại; tải bản mới để đối chiếu.',
  )
