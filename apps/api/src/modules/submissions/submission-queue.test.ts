import assert from 'node:assert/strict'
import test from 'node:test'
import { queueFilters, queueFingerprint, queueCursor, queueSearch } from './submission-queue.js'
import { SubmissionError } from './submission.types.js'
const user = '11111111-1111-4111-8111-111111111111',
  id = '22222222-2222-4222-8222-222222222222'
const fingerprint = queueFingerprint(user, queueFilters({ q: 'An' }))
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
test('queue cursor keeps microseconds and binds the normalized filters and identity', () => {
  const time = '2026-10-10T01:02:03.123456Z',
    raw = encode([time, id, fingerprint])
  assert.deepEqual(queueCursor(raw, fingerprint), [time, id])
  assert.equal(queueCursor(undefined, fingerprint), null)
  assert.equal(queueFingerprint(user, queueFilters({ q: '  An  ' })), fingerprint)
  for (const scope of [
    queueFingerprint('other', queueFilters({ q: 'An' })),
    queueFingerprint(user, queueFilters({ q: 'An', assignment: 'MINE' })),
    queueFingerprint(user, queueFilters({ q: 'An', status: 'SUBMITTED' })),
  ])
    assert.throws(
      () => queueCursor(raw, scope),
      (e: unknown) => e instanceof SubmissionError && e.code === 'INVALID_CURSOR',
    )
})
test('queue rejects malformed cursors including normalized invalid calendar dates', () => {
  for (const raw of [
    '!',
    'a'.repeat(301),
    encode([]),
    encode(['2026-02-30T00:00:00.123456Z', id, fingerprint]),
    encode(['2026-10-10T01:02:03.123Z', id, fingerprint]),
    encode(['2026-10-10T01:02:03.123456Z', 'bad', fingerprint]),
    encode([null, id, fingerprint]),
  ])
    assert.throws(
      () => queueCursor(raw, fingerprint),
      (e: unknown) => e instanceof SubmissionError && e.statusCode === 400,
    )
})
test('queue filters trim and bound search and escape SQL wildcard input literally', () => {
  assert.deepEqual(queueFilters({ q: '  Nguyễn An  ' }), {
    status: undefined,
    assignment: 'ALL',
    q: 'Nguyễn An',
  })
  assert.equal(queueSearch('50%_\\test'), '%50\\%\\_\\\\test%')
  assert.throws(() => queueFilters({ q: 'x'.repeat(101) }))
})
