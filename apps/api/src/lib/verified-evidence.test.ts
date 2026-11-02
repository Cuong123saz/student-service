import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import {
  readVerifiedEvidence,
  type EvidenceFailure,
  type StoredEvidence,
} from './verified-evidence.js'
const bytes = Buffer.from('synthetic evidence')
const file: StoredEvidence = {
  storageKey: 'one',
  size: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  name: 'proof.pdf',
  mimeType: 'application/pdf',
}
const failure = (reason: EvidenceFailure) => new Error(reason)
test('verified evidence returns original bytes after a second authorization check', async () => {
  let checks = 0
  const result = await readVerifiedEvidence(
    async () => {
      checks++
      return file
    },
    async () => bytes,
    failure,
  )
  assert.equal(checks, 2)
  assert.equal(result.bytes, bytes)
  assert.equal(result.name, file.name)
})
test('storage failures are classified without exposing a private path', async () => {
  await assert.rejects(
    readVerifiedEvidence(
      async () => file,
      async () => {
        throw new Error('private/path')
      },
      failure,
    ),
    { message: 'UNAVAILABLE' },
  )
})
test('corrupt or truncated bytes cannot be returned', async () => {
  for (const bad of [Buffer.alloc(bytes.length), bytes.subarray(0, 2)])
    await assert.rejects(
      readVerifiedEvidence(
        async () => file,
        async () => bad,
        failure,
      ),
      { message: 'INTEGRITY' },
    )
})
test('all evidence binding fields are checked again after reading', async () => {
  for (const change of [
    { storageKey: 'two' },
    { sha256: 'bad' },
    { size: bytes.length + 1 },
    { name: 'other.pdf' },
    { mimeType: 'text/html' },
  ]) {
    let checks = 0
    await assert.rejects(
      readVerifiedEvidence(
        async () => (++checks === 1 ? file : { ...file, ...change }),
        async () => bytes,
        failure,
      ),
      { message: 'CHANGED' },
    )
  }
})
test('authorization failures before and after I/O keep their original identity', async () => {
  for (const rejectAt of [1, 2]) {
    let checks = 0,
      reads = 0
    const denied = new Error('ACCESS_REVOKED')
    await assert.rejects(
      readVerifiedEvidence(
        async () => {
          if (++checks === rejectAt) throw denied
          return file
        },
        async () => {
          reads++
          return bytes
        },
        failure,
      ),
      (e) => e === denied,
    )
    assert.equal(reads, rejectAt - 1)
  }
})

test('a caching adapter cannot mutate the captured evidence binding during I/O', async () => {
  const source = { ...file }
  await assert.rejects(
    readVerifiedEvidence(
      async () => source,
      async () => {
        source.name = 'replaced.pdf'
        return bytes
      },
      failure,
    ),
    { message: 'CHANGED' },
  )
})
