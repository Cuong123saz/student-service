export interface ProcedureField {
  key: string
  label: string
  type: 'TEXT' | 'TEXTAREA' | 'NUMBER' | 'DATE' | 'SELECT' | 'BOOLEAN'
  source: 'STUDENT_INPUT' | 'PROFILE'
  profileKey: 'studentCode' | 'fullName' | 'classCode' | 'facultyCode' | null
  required: boolean
  maxLength: number
  options: { value: string; label: string }[]
}
export interface ProcedureConfig {
  processingMode: 'OFFLINE' | 'ONLINE' | 'HYBRID'
  processingUnitId: string
  processorUserId: string | null
  contactInstructions: string
  fields: ProcedureField[]
  attachments: {
    key: string
    label: string
    required: boolean
    mimeTypes: ('application/pdf' | 'image/png' | 'image/jpeg')[]
    maxFiles: number
    maxBytes: number
  }[]
  maxTotalAttachmentBytes: number
}
export interface ProcedureVersion {
  id: string
  serviceId: number
  ownerUnitId: string
  versionNumber: number
  revision: number
  status: 'DRAFT' | 'PUBLISHED' | 'RETIRED'
  config: ProcedureConfig
  publishedAt: string | null
}
export interface ProcedureCatalog {
  services: { id: number; code: string; name: string; status: string }[]
  units: { id: string; code: string; name: string }[]
  reviewers: { id: string; name: string; unitId: string | null }[]
  canCreate: boolean
}
export interface ProcedureIssue {
  path: string
  message: string
}
export interface ProcedureApiError {
  status?: number
  message: string
  issues: ProcedureIssue[]
}
export interface PublicProcedure {
  versionId: string
  versionNumber: number
  processingMode: ProcedureConfig['processingMode']
  processingUnitName: string
  contactInstructions: string
  fields: ProcedureField[]
  attachments: ProcedureConfig['attachments']
  maxTotalAttachmentBytes: number
}
