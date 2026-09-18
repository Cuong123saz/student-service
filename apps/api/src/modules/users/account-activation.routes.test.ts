import assert from 'node:assert/strict'
import { test } from 'node:test'
import { InvalidPasswordError, MIN_PASSWORD_LENGTH } from '../auth/password-policy.js'
import Fastify from 'fastify'
import { buildApp } from '../../app.js'
import { accountActivationRoutes } from './account-activation.routes.js'

import {
  InvalidActivationTokenError,
  type AccountActivationUseCase,
  type ActivateAccountInput,
} from './account-activation.service.js'

const endpoint = '/api/v1/auth/activate'

const validPayload = {
  token: 'abcdefghijklmnopqrstuvwxyz' + 'ABCDEFGHIJKLMNOPQ',
  newPassword: 'NewSecurePassword2026',
}
class FakeAccountActivationService implements AccountActivationUseCase {
  receivedInput: ActivateAccountInput | undefined
  callCount = 0
  constructor(private readonly failure?: Error) {}

  async activateAccount(input: ActivateAccountInput): Promise<void> {
    this.receivedInput = input
    this.callCount += 1
    if (this.failure) {
      throw this.failure
    }
  }
}
test('POST /api/v1/auth/activate kích hoạt tài khoản thành công', async (context) => {
  const activationService = new FakeAccountActivationService()

  const app = Fastify()

  app.register(accountActivationRoutes, {
    prefix: '/api/v1',
    activationService,
  })

  context.after(async () => {
    await app.close()
  })

  const response = await app.inject({
    method: 'POST',
    url: endpoint,
    payload: validPayload,
  })

  assert.equal(response.statusCode, 204)

  assert.equal(response.body, '')

  assert.deepEqual(activationService.receivedInput, {
    rawToken: validPayload.token,

    newPassword: validPayload.newPassword,
  })
})
test('POST /api/v1/auth/activate trả 400 khi token không thể sử dụng', async (context) => {
  const activationService = new FakeAccountActivationService(new InvalidActivationTokenError())

  const app = Fastify()

  app.register(accountActivationRoutes, {
    prefix: '/api/v1',
    activationService,
  })

  context.after(async () => {
    await app.close()
  })

  const response = await app.inject({
    method: 'POST',
    url: endpoint,
    payload: validPayload,
  })

  assert.equal(response.statusCode, 400)

  assert.deepEqual(response.json(), {
    message: 'Activation token is invalid or expired',
  })
})
test('POST /api/v1/auth/activate trả 400 khi mật khẩu không đạt policy', async (context) => {
  const message = `Password must contain at least ${MIN_PASSWORD_LENGTH} characters`

  const activationService = new FakeAccountActivationService(new InvalidPasswordError(message))

  const app = Fastify()

  app.register(accountActivationRoutes, {
    prefix: '/api/v1',
    activationService,
  })

  context.after(async () => {
    await app.close()
  })

  const response = await app.inject({
    method: 'POST',
    url: endpoint,
    payload: {
      ...validPayload,
      newPassword: 'short',
    },
  })

  assert.equal(response.statusCode, 400)

  assert.deepEqual(response.json(), {
    message,
  })
})
test('POST /api/v1/auth/activate được đăng ký trong ứng dụng', async (context) => {
  const activationService = new FakeAccountActivationService()

  const app = buildApp({
    accountActivationService: activationService,
  })

  context.after(async () => {
    await app.close()
  })

  const response = await app.inject({
    method: 'POST',
    url: endpoint,
    payload: validPayload,
  })

  assert.equal(response.statusCode, 204)

  assert.deepEqual(activationService.receivedInput, {
    rawToken: validPayload.token,

    newPassword: validPayload.newPassword,
  })
})
test('POST /api/v1/auth/activate giới hạn số lần gọi', async (context) => {
  const activationService = new FakeAccountActivationService()

  const app = buildApp({
    accountActivationService: activationService,
  })

  context.after(async () => {
    await app.close()
  })

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await app.inject({
      method: 'POST',
      url: endpoint,
      payload: validPayload,
    })

    assert.equal(response.statusCode, 204)
  }

  const blockedResponse = await app.inject({
    method: 'POST',
    url: endpoint,
    payload: validPayload,
  })

  assert.equal(blockedResponse.statusCode, 429)

  assert.equal(activationService.callCount, 5)
})
