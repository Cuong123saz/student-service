import assert from 'node:assert/strict'
import { test } from 'node:test'
import Fastify from 'fastify'

import { configureGlobalErrorHandler } from './error-handler.js'

test('không trả nội dung lỗi bất ngờ cho client', async (context) => {
  const app = Fastify({
    logger: false,
  })

  configureGlobalErrorHandler(app)

  app.get('/unexpected-error', async () => {
    throw new Error('password=secret database users_table')
  })

  context.after(async () => {
    await app.close()
  })

  const response = await app.inject({
    method: 'GET',
    url: '/unexpected-error',
  })

  assert.equal(response.statusCode, 500)

  assert.deepEqual(response.json(), {
    message: 'Internal Server Error',
  })

  assert.doesNotMatch(response.body, /password|secret|users_table/)
})
