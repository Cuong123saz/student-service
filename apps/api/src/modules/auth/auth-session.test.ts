import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  ADMIN_JWT_AUDIENCE,
  JWT_ISSUER,
} from './auth.constants.js'
import {
  isAdminSession,
} from './auth-session.js'

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

test(
  'chấp nhận admin session hợp lệ',
  () => {
    assert.equal(
      isAdminSession(validSession),
      true,
    )
  },
)

test(
  'từ chối session khi roles không phải array',
  () => {
    assert.equal(
      isAdminSession({
        ...validSession,
        roles: 'SYSTEM_ADMIN',
      }),
      false,
    )
  },
)

test(
  'từ chối session thuộc user portal',
  () => {
    assert.equal(
      isAdminSession({
        ...validSession,
        portal: 'user',
      }),
      false,
    )
  },
)

test(
  'từ chối session có audience không đúng',
  () => {
    assert.equal(
      isAdminSession({
        ...validSession,
        aud: 'student-service-user',
      }),
      false,
    )
  },
)
test(
  'từ chối admin session thiếu mustChangePassword',
  () => {
    const {
      mustChangePassword:
        _mustChangePassword,
      ...sessionWithoutFlag
    } = validSession

    assert.equal(
      isAdminSession(
        sessionWithoutFlag,
      ),
      false,
    )
  },
)