import type { Answers, Criterion } from '../training-points/training-points.types.js'
import type { TrainingClassificationInfo } from './training-classification.js'
import type { ReviewDecision, ReviewDetail, ReviewSummary } from './training-review.types.js'

export const trainingExportMaxRows = 1000
/** Audit actions are a closed set; the format never becomes free text in the action name. */
export const trainingExportAuditActions = Object.freeze({
  XLSX: 'training.export.xlsx.prepared',
  DOCX: 'training.export.docx.prepared',
  PDF: 'training.export.pdf.prepared',
  ZIP: 'training.export.zip.prepared',
  CLASS_SHEET: 'training.export.class-sheet.prepared',
  FORM: 'training.export.form.prepared',
} as const)
export type TrainingExportAuditFormat = keyof typeof trainingExportAuditActions
export interface TrainingExportAuditReceipt {
  format: TrainingExportAuditFormat
  snapshotId: string
  rowCount: number
  sha256: string
  size: number
  templateVersion?: string
  sourceDocxSha256?: string
  manifestSha256?: string
  /** FORM only: the printed declaration. */
  declarationId?: string
}
export interface TrainingExportReceipt {
  id: string
  revision: number
  actor: ReviewDecision['actor']
  confirmedAt: string
  payloadSha256: string
}
export interface TrainingExportRow {
  declarationId: string
  declarationSha256: string
  student: ReviewDetail['student']
  selfPoints: number
  approvedAnswers: Answers
  approvedPoints: number
  advisor: TrainingExportReceipt
  faculty: TrainingExportReceipt
  /**
   * ADR 0027: current profile date of birth (ISO) read in the same snapshot transaction; only
   * the class sheet prints it. Absent in snapshots that predate it.
   */
  dateOfBirth?: string | null
  /** ADR 0028: student's own per-section answers, admission year and the monitor step. */
  selfAnswers?: Answers
  cohortYear?: number | null
  monitor?: (TrainingExportReceipt & { action: 'MONITOR_CONFIRMED' | 'MONITOR_BYPASSED' }) | null
}
export interface TrainingExportSnapshot {
  schemaVersion: 1
  snapshotId: string
  capturedAt: string
  exportedBy: { userId: string; username: string; fullName: string }
  period: {
    id: string
    classId: string
    classCode: string
    className: string
    facultyCode: string
    facultyName: string
    name: string
    academicYear: string
    semester: string
    status: string
    policyLabel: string
    criteria: Criterion[]
  }
  summary: ReviewSummary
  rows: TrainingExportRow[]
  /** ADR 0026: provisional bands; per-row classification is derived from approvedPoints. */
  classification: TrainingClassificationInfo
  technicalSignatureStatus: 'NOT_VERIFIED'
  legalEffect: false
  notice: string
}
