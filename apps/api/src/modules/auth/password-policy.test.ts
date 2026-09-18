import assert from 'node:assert/strict'
import { test } from 'node:test'

import { InvalidPasswordError, validateNewPassword } from './password-policy.js'

test('chấp nhận mật khẩu đủ 15 ký tự', () => {
  assert.equal(validateNewPassword('123456789012345'), '123456789012345')
})

test('từ chối mật khẩu dưới 15 ký tự', () => {
  assert.throws(() => validateNewPassword('12345678901234'), InvalidPasswordError)
})

test('từ chối mật khẩu trên 128 ký tự', () => {
  assert.throws(() => validateNewPassword('a'.repeat(129)), InvalidPasswordError)
})

test('chuẩn hóa Unicode về NFC', () => {
  const decomposed = 'e\u0301'.repeat(15)

  const result = validateNewPassword(decomposed)

  assert.equal(result, 'é'.repeat(15))
})
