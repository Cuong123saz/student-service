import { SubmissionError } from '../submissions/submission.types.js'
import { groups, type PeriodInput, type Answers, type Criterion } from './training-points.types.js'
const invalid = (message: string) => new SubmissionError(400, 'INVALID_TRAINING_INPUT', message)
export function validatePeriod(v: PeriodInput) {
  if (
    !v ||
    !v.name?.trim() ||
    v.name.length > 200 ||
    !v.policyLabel?.trim() ||
    v.policyLabel.length > 200 ||
    !/^\d{4}-\d{4}$/.test(v.academicYear) ||
    Number(v.academicYear.slice(5)) !== Number(v.academicYear.slice(0, 4)) + 1 ||
    !['1', '2', 'SUMMER'].includes(v.semester) ||
    !Number.isFinite(Date.parse(v.startsAt)) ||
    !Number.isFinite(Date.parse(v.endsAt)) ||
    Date.parse(v.startsAt) >= Date.parse(v.endsAt)
  )
    throw invalid('Kiểm tra tên, năm học, học kỳ và thời gian bắt đầu/kết thúc.')
  if (
    !Array.isArray(v.criteria) ||
    v.criteria.length !== 5 ||
    new Set(v.criteria.map((c) => c.code)).size !== 5 ||
    v.criteria.some(
      (c) =>
        !groups.includes(c.code) ||
        !c.label?.trim() ||
        c.label.length > 200 ||
        !Number.isInteger(c.maxPoints) ||
        c.maxPoints < 1 ||
        c.maxPoints > 100 ||
        typeof c.evidenceRequired !== 'boolean',
    ) ||
    v.criteria.reduce((n, c) => n + c.maxPoints, 0) !== 100
  )
    throw invalid('Cần đủ năm nhóm A–E, tổng điểm tối đa bằng 100.')
}
export function validateAnswers(v: Answers, criteria: Criterion[], complete = false) {
  if (!v || typeof v !== 'object' || Array.isArray(v))
    throw invalid('Thông tin kê khai không đúng định dạng.')
  const issues: { path: string; message: string }[] = []
  for (const key of new Set([...Object.keys(v), ...(complete ? groups : [])])) {
    const a = v[key],
      c = criteria.find((c) => c.code === key)
    if (
      !c ||
      !a ||
      Object.keys(a).some((k) => !['points', 'note'].includes(k)) ||
      typeof a.note !== 'string' ||
      a.note.length > 2000 ||
      (a.points !== null &&
        (!Number.isInteger(a.points) || a.points < 0 || a.points > c.maxPoints)) ||
      (complete && (a.points === null || (a.points > 0 && !a.note.trim())))
    )
      issues.push({
        path: key,
        message: 'Nhập điểm nguyên trong giới hạn và giải trình khi điểm lớn hơn 0.',
      })
  }
  if (issues.length)
    throw new SubmissionError(
      400,
      'INVALID_TRAINING_ANSWERS',
      'Kiểm tra lại các nhóm được đánh dấu.',
      issues,
    )
}
