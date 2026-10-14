export type TrainingGroup = 'A' | 'B' | 'C' | 'D' | 'E'
export interface TrainingCriterion {
  code: TrainingGroup
  label: string
  maxPoints: number
  evidenceRequired: boolean
}
export interface TrainingPeriodInput {
  classId: string
  academicYear: string
  semester: '1' | '2' | 'SUMMER'
  name: string
  policyLabel: string
  startsAt: string
  endsAt: string
  criteria: TrainingCriterion[]
}
export interface TrainingPeriod extends TrainingPeriodInput {
  id: string
  status: 'DRAFT' | 'OPEN' | 'CLOSED'
  revision: number
  declarationId?: string | null
  declarationState?: string | null
}
export type TrainingAnswers = Record<string, { points: number | null; note: string }>
export interface TrainingDeclaration {
  id: string
  period: TrainingPeriod
  state: 'DRAFT' | 'SUBMITTED'
  revision: number
  answers: TrainingAnswers
  editable: boolean
  student: { fullName: string; studentCode: string; classCode: string; facultyCode: string }
  totalPoints: number
  submittedAt: string | null
  files: {
    id: string
    criterion: TrainingGroup
    name: string
    mimeType: string
    size: number
    sha256: string
    signatureStatus: 'NOT_CHECKED'
  }[]
  history: { id: string; action: string; revision: number; createdAt: string }[]
  historyTruncated: boolean
  scoreStatus: 'SELF_DECLARED_NOT_REVIEWED'
}
export interface TrainingCatalog {
  classes: { id: string; name: string; code: string; facultyName: string }[]
  truncated: boolean
}
export interface TrainingError {
  status?: number
  message: string
  issues: { path: string; message: string }[]
}
