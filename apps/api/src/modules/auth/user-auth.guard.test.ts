import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { FastifyInstance } from 'fastify'

import { buildApp } from '../../app.js'

import {
  ADMIN_JWT_AUDIENCE,
  ADMIN_SESSION_COOKIE_NAME,
  JWT_ISSUER,
  USER_JWT_AUDIENCE,
  USER_SESSION_COOKIE_NAME,
  USER_SESSION_TTL_SECONDS,
} from './auth.constants.js'

import { requireUserSession } from './user-auth.guard.js'

function registerProtectedRoute(app: FastifyInstance) {
  app.get(
    '/test/user-protected',
    {
      preHandler: requireUserSession,
    },
    async (request) => ({
      username: request.userSession?.username,
    }),
  )
}

test('user guard chấp nhận user session hợp lệ', async (context) => {
  const app = buildApp()

  registerProtectedRoute(app)

  context.after(async () => {
    await app.close()
  })

  await app.ready()

  const token = app.jwt.sign(
    {
      sub: 'student-user-id',
      username: 'student001',
      roles: ['STUDENT'],
      portal: 'user',
      mustChangePassword: false,
      aud: USER_JWT_AUDIENCE,
      iss: JWT_ISSUER,
    },
    {
      expiresIn: USER_SESSION_TTL_SECONDS,
    },
  )

  const response = await app.inject({
    method: 'GET',
    url: '/test/user-protected',
    headers: {
      cookie: `${USER_SESSION_COOKIE_NAME}=${token}`,
    },
  })

  assert.equal(response.statusCode, 200)

  assert.deepEqual(response.json(), {
    username: 'student001',
  })
})

test('user guard từ chối admin session', async (context) => {
  const app = buildApp()

  registerProtectedRoute(app)

  context.after(async () => {
    await app.close()
  })

  await app.ready()

  const token = app.jwt.sign({
    sub: 'admin-user-id',
    username: 'system.admin',
    roles: ['SYSTEM_ADMIN'],
    portal: 'admin',
    mustChangePassword: false,
    aud: ADMIN_JWT_AUDIENCE,
    iss: JWT_ISSUER,
  })

  const response = await app.inject({
    method: 'GET',
    url: '/test/user-protected',
    headers: {
      cookie: `${ADMIN_SESSION_COOKIE_NAME}=${token}`,
    },
  })

  assert.equal(response.statusCode, 401)
})
test('user guard trả 403 khi session không có user portal role', async (context) => {
  const app = buildApp()

  registerProtectedRoute(app)

  context.after(async () => {
    await app.close()
  })

  await app.ready()

  const token = app.jwt.sign(
    {
      sub: 'admin-user-id',
      username: 'system.admin',
      roles: ['ADMIN'],
      portal: 'user',
      mustChangePassword: false,
      aud: USER_JWT_AUDIENCE,
      iss: JWT_ISSUER,
    },
    {
      expiresIn: USER_SESSION_TTL_SECONDS,
    },
  )

  const response = await app.inject({
    method: 'GET',
    url: '/test/user-protected',

    headers: {
      cookie: `${USER_SESSION_COOKIE_NAME}=${token}`,
    },
  })

  assert.equal(response.statusCode, 403)
})
