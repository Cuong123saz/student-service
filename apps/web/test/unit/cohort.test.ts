import { describe, it, expect } from 'vitest'
import { formatCohort } from '../../app/utils/cohort'

describe('formatCohort', () => {
  it('hiển thị niên khóa dạng K + năm bắt đầu', () => {
    expect(formatCohort(2022)).toBe('K2022')
  })
  it('null hoặc thiếu (preview cũ) là chưa có, không đoán', () => {
    expect(formatCohort(null)).toBe('Chưa có')
    expect(formatCohort(undefined)).toBe('Chưa có')
  })
})
