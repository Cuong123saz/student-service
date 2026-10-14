export const groups = ['A', 'B', 'C', 'D', 'E'] as const
export type Group = (typeof groups)[number]
export interface Criterion {
  code: Group
  label: string
  maxPoints: number
  evidenceRequired: boolean
}
export interface Answers {
  [key: string]: { points: number | null; note: string }
}
export interface PeriodInput {
  classId: string
  academicYear: string
  semester: '1' | '2' | 'SUMMER'
  name: string
  policyLabel: string
  startsAt: string
  endsAt: string
  criteria: Criterion[]
}
export const demoCriteria = (): Criterion[] =>
  groups.map((code) => ({
    code,
    label: 'Nhóm ' + code + ' (giả định)',
    maxPoints: 20,
    evidenceRequired: code === 'A',
  }))
