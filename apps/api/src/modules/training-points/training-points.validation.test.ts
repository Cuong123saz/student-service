import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validatePeriod, validateAnswers } from './training-points.validation.js'
import { demoCriteria, type PeriodInput } from './training-points.types.js'
const period: PeriodInput = {
  classId: '00000000-0000-4000-8000-000000000001',
  academicYear: '2026-2027',
  semester: '1',
  name: 'Đợt giả định',
  policyLabel: 'Tiêu chí thử nghiệm',
  startsAt: '2026-10-01T00:00:00Z',
  endsAt: '2026-11-01T00:00:00Z',
  criteria: demoCriteria(),
}
test('period requires consecutive academic year, finite increasing dates, unique A–E totaling100', () => {
  assert.doesNotThrow(() => validatePeriod(period))
  for (const change of [
    { academicYear: '2026-2028' },
    { startsAt: 'invalid' },
    { endsAt: period.startsAt },
    { name: ' ' },
    { criteria: period.criteria.slice(1) },
    { criteria: period.criteria.map((c) => ({ ...c, code: 'A' as const })) },
    { criteria: period.criteria.map((c) => ({ ...c, maxPoints: 19 })) },
  ])
    assert.throws(() => validatePeriod({ ...period, ...change }))
})
test('draft preserves zero and unknown points; submission requires all groups and positive score explanation', () => {
  assert.doesNotThrow(() =>
    validateAnswers({ A: { points: 0, note: '' }, B: { points: null, note: '' } }, period.criteria),
  )
  assert.throws(() => validateAnswers({ A: { points: 0, note: '' } }, period.criteria, true))
  const answers = Object.fromEntries(period.criteria.map((c) => [c.code, { points: 0, note: '' }]))
  assert.doesNotThrow(() => validateAnswers(answers, period.criteria, true))
  for (const points of [-1, 21, 1.5, NaN])
    assert.throws(() =>
      validateAnswers({ ...answers, A: { points, note: 'Mẫu' } }, period.criteria),
    )
  assert.throws(() =>
    validateAnswers({ ...answers, A: { points: 1, note: ' ' } }, period.criteria, true),
  )
  assert.throws(() => validateAnswers({ ...answers, F: { points: 0, note: '' } }, period.criteria))
  assert.doesNotThrow(() =>
    validateAnswers(
      { ...answers, A: { points: 20, note: 'Hoạt động giả định' } },
      period.criteria,
      true,
    ),
  )
})
