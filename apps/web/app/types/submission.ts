import type { PublicProcedure, ProcedureIssue } from './procedure'
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
  status: 'DRAFT'
  procedure: PublicProcedure
  values: DraftValues
  files: Evidence[]
  issues: ProcedureIssue[]
  editable: boolean
  readOnlyReason: string | null
  updatedAt: string
}
export interface DraftSummary {
  id: string
  serviceName: string
  status: 'DRAFT'
  revision: number
  updatedAt: string
}
