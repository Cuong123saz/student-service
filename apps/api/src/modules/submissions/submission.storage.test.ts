import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { LocalEvidenceStorage } from './submission.storage.js'

test('local evidence storage roundtrips exactly 5 MiB and bounds damaged files before download', async (t) => {
  const parent = resolve(tmpdir()),
    root = await mkdtemp(join(parent, 'student-evidence-boundary-'))
  t.after(async () => {
    assert.equal(dirname(root), parent)
    assert.ok(root.startsWith(join(parent, 'student-evidence-boundary-')))
    await rm(root, { recursive: true, force: true })
  })
  const storage = new LocalEvidenceStorage(root),
    bytes = Buffer.alloc(5 * 1024 * 1024, 7)
  bytes[bytes.length - 1] = 255
  const key = await storage.put(bytes)
  assert.deepEqual(await storage.read(key), bytes)
  for (const invalid of ['../escape', root, '__proto__', ''])
    await assert.rejects(async () => storage.read(invalid), /Invalid storage key/)
  await assert.rejects(() => storage.put(Buffer.alloc(0)), /INVALID_EVIDENCE_SIZE/)
  await assert.rejects(() => storage.put(Buffer.alloc(bytes.length + 1)), /INVALID_EVIDENCE_SIZE/)
  assert.deepEqual(await readdir(root), [key])
  await writeFile(join(root, key), Buffer.alloc(bytes.length + 1))
  await assert.rejects(() => storage.read(key), /PRIVATE_FILE_UNAVAILABLE/)
  await storage.remove(key)
  assert.deepEqual(await readdir(root), [])
})
