import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ADMIN_JWT_AUDIENCE, JWT_ISSUER, USER_JWT_AUDIENCE } from './auth.constants.js'
import { isAdminSession, isUserSession } from './auth-session.js'
const validUserSession = {
  sub: 'student-user-id',
  username: 'student001',
  roles: ['STUDENT'],
  portal: 'user',
  mustChangePassword: false,
  aud: USER_JWT_AUDIENCE,
  iss: JWT_ISSUER,
  iat: 1,
  exp: 2,
}

const validSession = {
  sub: 'user-id',
  username: 'system.admin',
  roles: ['SYSTEM_ADMIN'],
  portal: 'admin',
  mustChangePassword: false,
  aud: ADMIN_JWT_AUDIENCE,
  iss: JWT_ISSUER,
  iat: 1,
  exp: 2,
}

test('chấp nhận admin session hợp lệ', () => {
  assert.equal(isAdminSession(validSession), true)
})

test('từ chối session khi roles không phải array', () => {
  assert.equal(
    isAdminSession({
      ...validSession,
      roles: 'SYSTEM_ADMIN',
    }),
    false,
  )
})

test('từ chối session thuộc user portal', () => {
  assert.equal(
    isAdminSession({
      ...validSession,
      portal: 'user',
    }),
    false,
  )
})

test('từ chối session có audience không đúng', () => {
  assert.equal(
    isAdminSession({
      ...validSession,
      aud: 'student-service-user',
    }),
    false,
  )
})
test('từ chối admin session thiếu mustChangePassword', () => {
  const { mustChangePassword: _mustChangePassword, ...sessionWithoutFlag } = validSession

  assert.equal(isAdminSession(sessionWithoutFlag), false)
})
test('chấp nhận user session hợp lệ', () => {
  assert.equal(isUserSession(validUserSession), true)
})

test('user session từ chối token thuộc admin portal', () => {
  assert.equal(
    isUserSession({
      ...validUserSession,
      portal: 'admin',
    }),
    false,
  )
})

test('user session từ chối admin audience', () => {
  assert.equal(
    isUserSession({
      ...validUserSession,
      aud: ADMIN_JWT_AUDIENCE,
    }),
    false,
  )
})
