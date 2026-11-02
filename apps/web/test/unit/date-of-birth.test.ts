import { describe, it, expect } from 'vitest'
import { formatDateOfBirth } from '../../app/utils/date-of-birth'

describe('formatDateOfBirth', () => {
  it('hiển thị dd/mm/yyyy', () => {
    expect(formatDateOfBirth('2003-02-10')).toBe('10/02/2003')
  })
  it('thiếu hoặc sai định dạng là chưa có, không đoán', () => {
    expect(formatDateOfBirth(null)).toBe('Chưa có')
    expect(formatDateOfBirth(undefined)).toBe('Chưa có')
    expect(formatDateOfBirth('10/02/2003')).toBe('Chưa có')
  })
})
