import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { buildApp } from '../../app.js'
import { databaseClient } from '../../db/client.js'
import { env } from '../../config/env.js'
import { SubmissionService } from './submission.service.js'
import { SubmissionError } from './submission.types.js'
import { JWT_ISSUER, USER_JWT_AUDIENCE, ADMIN_JWT_AUDIENCE } from '../auth/auth.constants.js'
after(() => databaseClient.end())
const id = randomUUID(),
  userId = randomUUID(),
  token = randomUUID()
const input = { requestId: randomUUID(), expectedAttemptId: token, reasonCode: 'CONVERTER_FIXED' }
async function appFixture(t: { after: (fn: () => Promise<unknown>) => unknown }) {
  const calls: unknown[][] = []
  const service = {
    documentStatus: async (...args: unknown[]) => {
      calls.push(args)
      return { enabled: true, documents: [] }
    },
    retryDocument: async (...args: unknown[]) => {
      calls.push(args)
      return { requestId: input.requestId, attemptLimit: 4, alreadyApplied: false }
    },
  } as unknown as SubmissionService
  const app = buildApp({ submissionService: service })
  await app.ready()
  t.after(() => app.close())
  function cookie(
    portal: 'user' | 'admin' = 'user',
    roles = portal === 'admin' ? ['ADMIN'] : ['FACULTY_REVIEWER'],
    mustChangePassword = false,
  ) {
    return (
      portal +
      '_session=' +
      app.jwt.sign(
        {
          sub: userId,
          username: 'synthetic',
          roles,
          mustChangePassword,
          portal,
          aud: portal === 'admin' ? ADMIN_JWT_AUDIENCE : USER_JWT_AUDIENCE,
          iss: JWT_ISSUER,
        },
        { expiresIn: '5m' },
      )
    )
  }
  return { app, calls, cookie }
}
test('status requires correct portal session, is no-store and passes identity and round without creating files', async (t) => {
  const { app, calls, cookie } = await appFixture(t)
  const url = `/api/v1/admin/review-submissions/${id}/rounds/2/document-status`
  assert.equal((await app.inject({ url })).statusCode, 401)
  assert.equal((await app.inject({ url, headers: { cookie: cookie() } })).statusCode, 401)
  const response = await app.inject({ url, headers: { cookie: cookie('admin') } })
  assert.equal(response.statusCode, 200)
  assert.equal(response.headers['cache-control'], 'no-store')
  assert.deepEqual(calls, [[userId, id, 2, true]])
})
test('retry requires matching origin, reviewer portal and active password session', async (t) => {
  const { app, calls, cookie } = await appFixture(t)
  const url = `/api/v1/user/review-submissions/${id}/rounds/2/documents/pdf/retry`
  for (const headers of [
    { cookie: cookie() },
    { cookie: cookie(), origin: 'https://untrusted.example' },
    { cookie: cookie('user', ['FACULTY_REVIEWER'], true), origin: env.corsOrigin },
  ]) {
    const response = await app.inject({ method: 'POST', url, headers, payload: input })
    assert.equal(response.statusCode, 403)
  }
  assert.equal(calls.length, 0)
})
test('no owner retry endpoint exists and request schema rejects extra fields and invalid identifiers', async (t) => {
  const { app, calls, cookie } = await appFixture(t)
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: `/api/v1/user/submissions/${id}/rounds/2/documents/pdf/retry`,
        headers: { cookie: cookie('user', ['STUDENT']), origin: env.corsOrigin },
        payload: input,
      })
    ).statusCode,
    404,
  )
  for (const payload of [
    { ...input, requestId: 'bad' },
    { ...input, reasonCode: 'IGNORE_FAILURE' },
    { ...input, attempts: 0 },
  ]) {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/review-submissions/${id}/rounds/2/documents/pdf/retry`,
      headers: { cookie: cookie('admin'), origin: env.corsOrigin },
      payload,
    })
    assert.equal(response.statusCode, 400)
  }
  assert.equal(calls.length, 0)
})
test('valid retry forwards scoped identity and typed input with no-store', async (t) => {
  const { app, calls, cookie } = await appFixture(t)
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/review-submissions/${id}/rounds/2/documents/pdf/retry`,
    headers: { cookie: cookie('admin'), origin: env.corsOrigin },
    payload: input,
  })
  assert.equal(response.statusCode, 200)
  assert.equal(response.headers['cache-control'], 'no-store')
  assert.equal(calls.length, 1)
  assert.equal((calls[0]![0] as { userId: string }).userId, userId)
  assert.deepEqual(calls[0]!.slice(1), [id, 2, 'pdf', input])
})
test('status rechecks dossier access after loading job metadata and refuses missing rounds', async () => {
  let count = 0,
    reads = 0
  const denied = new SubmissionError(404, 'NOT_FOUND', 'Không tìm thấy hồ sơ.')
  const repository = {
    reviewGet: async () => {
      if (++count > 1) throw denied
      return { rounds: [{ roundNumber: 1 }] }
    },
  } as unknown as ConstructorParameters<typeof SubmissionService>[0]
  const service = new SubmissionService(
    repository,
    {} as ConstructorParameters<typeof SubmissionService>[1],
    undefined,
    {
      status: async () => {
        reads++
        return { enabled: true, documents: [] }
      },
      retry: async () => {
        throw new Error('unexpected')
      },
    },
  )
  await assert.rejects(service.documentStatus(userId, id, 1, true), denied)
  assert.equal(reads, 1)
  count = 0
  await assert.rejects(
    service.documentStatus(userId, id, 99, true),
    (e) => e instanceof SubmissionError && e.statusCode === 404,
  )
  assert.equal(reads, 1)
})
