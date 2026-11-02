import type { Answers, Criterion } from '../training-points/training-points.types.js'
import type { ReviewDecision, ReviewDetail, ReviewSummary } from './training-review.types.js'

export const trainingExportMaxRows = 1000
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
  classification: 'NOT_ASSIGNED'
  technicalSignatureStatus: 'NOT_VERIFIED'
  legalEffect: false
  notice: string
}
