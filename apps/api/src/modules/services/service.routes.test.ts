import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'

import { buildApp } from '../../app.js'
import { databaseClient, db } from '../../db/client.js'
import { services } from '../../db/schema.js'

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl || new URL(databaseUrl).pathname !== '/student_service_test') {
  throw new Error('Integration tests must use the student_service_test database')
}

beforeEach(async () => {
  await db.delete(services)
})

after(async () => {
  await databaseClient.end()
})

test('GET /services/:id trả 400 khi id không hợp lệ', async (context) => {
  const app = buildApp()

  context.after(async () => {
    await app.close()
  })

  const response = await app.inject({
    method: 'GET',
    url: '/services/abc',
  })

  assert.equal(response.statusCode, 400)
})
test('GET /services/:id trả 404 khi dịch vụ không tồn tại', async (context) => {
  const app = buildApp()

  context.after(async () => {
    await app.close()
  })

  const response = await app.inject({
    method: 'GET',
    url: '/services/999999',
  })

  assert.equal(response.statusCode, 404)

  assert.deepEqual(response.json(), {
    message: 'Service not found',
  })
})
test('GET /services/:id trả dịch vụ khi id tồn tại', async (context) => {
  const app = buildApp()

  context.after(async () => {
    await app.close()
  })

  const insertedServices = await db
    .insert(services)
    .values({
      code: 'INTEGRATION_TEST',
      name: 'Dịch vụ integration test',
      description: 'Dữ liệu chỉ dùng trong test',
      processingDays: 1,
      status: 'ACTIVE',
    })
    .returning()

  const insertedService = insertedServices[0]

  assert.ok(insertedService)

  const response = await app.inject({
    method: 'GET',
    url: `/services/${insertedService.id}`,
  })

  assert.equal(response.statusCode, 200)

  assert.deepEqual(response.json(), {
    id: insertedService.id,
    code: 'INTEGRATION_TEST',
    name: 'Dịch vụ integration test',
    description: 'Dữ liệu chỉ dùng trong test',
    processingDays: 1,
    status: 'ACTIVE',
  })
})
test('GET /services lọc dịch vụ theo status', async (context) => {
  const app = buildApp()

  context.after(async () => {
    await app.close()
  })

  const insertedServices = await db
    .insert(services)
    .values([
      {
        code: 'ACTIVE_SERVICE',
        name: 'Dịch vụ đang hoạt động',
        description: 'Dịch vụ ACTIVE dùng trong test',
        processingDays: 2,
        status: 'ACTIVE',
      },
      {
        code: 'INACTIVE_SERVICE',
        name: 'Dịch vụ ngừng hoạt động',
        description: 'Dịch vụ INACTIVE dùng trong test',
        processingDays: 5,
        status: 'INACTIVE',
      },
    ])
    .returning()

  const activeService = insertedServices.find((service) => service.status === 'ACTIVE')

  assert.ok(activeService)

  const response = await app.inject({
    method: 'GET',
    url: '/services?status=ACTIVE',
  })

  assert.equal(response.statusCode, 200)

  assert.deepEqual(response.json(), [activeService])
})
test('GET /services trả 400 khi status không hợp lệ', async (context) => {
  const app = buildApp()

  context.after(async () => {
    await app.close()
  })

  const response = await app.inject({
    method: 'GET',
    url: '/services?status=INVALID',
  })

  assert.equal(response.statusCode, 400)
})
