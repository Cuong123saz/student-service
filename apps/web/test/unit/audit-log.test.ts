import {
  describe,
  expect,
  it,
} from 'vitest'

import {
  formatAuditValue,
  sanitizeAuditState,
} from '../../app/utils/audit-log'

describe('sanitizeAuditState', () => {
  it('che các field nhạy cảm theo tên, không phân biệt hoa thường', () => {
    expect(sanitizeAuditState({
      password: 'plain-text',
      accessToken: 'token-value',
      client_secret: 'secret-value',
      passwordHash: 'hash-value',
      errorStack: 'stack-value',
      sessionCookie: 'cookie-value',
      studentCode: 'SV001',
    })).toEqual({
      password: '***',
      accessToken: '***',
      client_secret: '***',
      passwordHash: '***',
      errorStack: '***',
      sessionCookie: '***',
      studentCode: 'SV001',
    })
  })

  it('giữ nguyên null và dữ liệu an toàn', () => {
    expect(sanitizeAuditState(null)).toBeNull()
    expect(sanitizeAuditState({
      active: true,
      count: 3,
      roles: ['ADMIN', 'ADVISOR'],
      note: null,
    })).toEqual({
      active: true,
      count: 3,
      roles: ['ADMIN', 'ADVISOR'],
      note: null,
    })
  })
})

describe('formatAuditValue', () => {
  it('hiển thị mảng và null rõ ràng', () => {
    expect(formatAuditValue(['A', 'B'])).toBe('A, B')
    expect(formatAuditValue(null)).toBe('null')
  })
})
