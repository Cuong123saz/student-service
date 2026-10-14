import { describe, it, expect } from 'vitest'
import { trainingIssues, trainingError, trainingFetchError } from '../../app/utils/training-point'
import type { TrainingCriterion } from '../../app/types/training-point'
const criteria: TrainingCriterion[] = ['A', 'B', 'C', 'D', 'E'].map((code) => ({
  code: code as TrainingCriterion['code'],
  label: code,
  maxPoints: 20,
  evidenceRequired: code === 'A',
}))
describe('training declaration review', () => {
  it('zero is a completed score and needs neither explanation nor evidence', () => {
    const answers = Object.fromEntries(criteria.map((c) => [c.code, { points: 0, note: '' }]))
    expect(trainingIssues(answers, criteria, [])).toEqual([])
    answers.A!.points = 1
    expect(trainingIssues(answers, criteria, [])[0]?.path).toBe('A')
    answers.A!.note = 'Hoạt động giả định'
    expect(trainingIssues(answers, criteria, [])[0]?.message).toContain('minh chứng')
    expect(trainingIssues(answers, criteria, [{ criterion: 'A' }])).toEqual([])
  })
  it('unknown and over-cap scores remain errors rather than silently becoming zero', () => {
    const answers = Object.fromEntries(
      criteria.map((c) => [c.code, { points: 0 as number | null, note: '' }]),
    )
    answers.B!.points = null
    answers.C!.points = 21
    expect(trainingIssues(answers, criteria, []).map((i) => i.path)).toEqual(['B', 'C'])
  })
  it('expired and forbidden sessions have actionable Vietnamese messages', () => {
    expect(trainingError({ statusCode: 401 }).message).toContain('đăng nhập lại')
    expect(trainingError({ response: { status: 403 } }).message).toContain('không có quyền')
    expect(
      trainingError({
        statusCode: 409,
        data: { message: 'Tải lại', issues: [{ path: 'A', message: 'Thiếu' }] },
      }),
    ).toMatchObject({ status: 409, message: 'Tải lại', issues: [{ path: 'A', message: 'Thiếu' }] })
  })
  it('decodes bounded JSON download errors and safely falls back for malformed or oversized bodies', async () => {
    const data = new Blob([JSON.stringify({ message: 'Tệp không khớp bản đã lưu.', issues: [] })], {
      type: 'application/json',
    })
    expect(await trainingFetchError({ statusCode: 409, data })).toMatchObject({
      status: 409,
      message: 'Tệp không khớp bản đã lưu.',
    })
    for (const text of ['{broken', 'x'.repeat(16385)])
      expect(
        await trainingFetchError({
          statusCode: 409,
          data: new Blob([text], { type: 'application/json' }),
        }),
      ).toMatchObject({ status: 409, message: expect.stringContaining('Tải lại trạng thái') })
  })
})
