import { describe, it, expect } from 'vitest'
import { formatCohort } from '../../app/utils/cohort'

describe('formatCohort', () => {
  it('hiển thị niên khóa K = năm vào học − 2006', () => {
    expect(formatCohort(2021)).toBe('K15')
    expect(formatCohort(2007)).toBe('K1')
  })
  it('null hoặc thiếu (preview cũ) là chưa có, không đoán', () => {
    expect(formatCohort(null)).toBe('Chưa có')
    expect(formatCohort(undefined)).toBe('Chưa có')
  })
})
