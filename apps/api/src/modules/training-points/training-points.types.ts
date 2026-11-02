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

/**
 * ADR 0026: the five sections of the Học viện assessment form (phiếu đánh giá kết quả rèn luyện).
 * Internal codes stay A–E; labels carry the form's Roman numerals. Sub-items are not modelled.
 */
export const academyCriteriaPreset = Object.freeze({
  id: 'academy-assessment-form-v1',
  name: 'Phiếu đánh giá kết quả rèn luyện của Học viện',
  policyLabel: 'Theo phiếu đánh giá kết quả rèn luyện của Học viện — cần đối chiếu văn bản quy chế',
})
export const academyCriteria = (): Criterion[] => [
  { code: 'A', label: 'I. Ý thức học tập', maxPoints: 20, evidenceRequired: false },
  {
    code: 'B',
    label: 'II. Ý thức chấp hành nội quy, quy chế, quy định trong Học viện',
    maxPoints: 25,
    evidenceRequired: false,
  },
  {
    code: 'C',
    label:
      'III. Tham gia hoạt động chính trị, xã hội, văn hóa, văn nghệ, thể thao, phòng chống tệ nạn xã hội',
    maxPoints: 20,
    evidenceRequired: false,
  },
  {
    code: 'D',
    label: 'IV. Phẩm chất công dân và quan hệ với cộng đồng',
    maxPoints: 25,
    evidenceRequired: false,
  },
  {
    code: 'E',
    label: 'V. Công tác phụ trách lớp, đoàn thể, tổ chức hoặc thành tích đặc biệt',
    maxPoints: 10,
    evidenceRequired: false,
  },
]
