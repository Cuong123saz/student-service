import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { auditConfiguration, auditEvidence } from './evidence-integrity.mjs'

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const reference = (bytes = Buffer.from('original evidence')) => ({
  kind: 'CURRENT',
  fileId: randomUUID(),
  submissionId: randomUUID(),
  key: randomUUID(),
  size: bytes.length,
  sha256: sha(bytes),
  removed: false,
})
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'student-evidence-audit-'))
  // Only this freshly created temporary directory is removed, never a supplied storage root.
  t.after(async () => {
    assert.ok(
      isAbsolute(directory) && directory.startsWith(join(tmpdir(), 'student-evidence-audit-')),
    )
    await rm(directory, { recursive: true, force: true })
  })
  const root = join(directory, 'store')
  await mkdir(root)
  return { directory, root }
}
const codes = (report) => report.issuesByCode

test('checks active and removed originals plus repeated historical references without modifying bytes', async (t) => {
  const { root } = await fixture(t)
  const bytes = Buffer.from('original evidence')
  const first = reference(bytes),
    removed = { ...reference(bytes), removed: true }
  await writeFile(join(root, first.key), bytes)
  await writeFile(join(root, removed.key), bytes)
  const round = { ...removed, kind: 'HISTORY', roundId: randomUUID() }
  const report = await auditEvidence({
    root,
    references: [first, removed, round, { ...round, roundId: randomUUID() }],
  })
  assert.equal(report.status, 'OK')
  assert.deepEqual(report.counts, {
    currentReferences: 2,
    removedReferences: 1,
    historicalReferences: 2,
    uniqueReferencedFiles: 2,
    diskEntries: 2,
    verifiedFiles: 2,
    unreferencedFiles: 0,
  })
  assert.equal(report.consistentBackup, false)
  assert.equal(report.signaturesChecked, false)
  assert.equal(report.malwareScanned, false)
  assert.deepEqual(await readFile(join(root, first.key)), bytes)
  assert.deepEqual((await readdir(root)).sort(), [first.key, removed.key].sort())
})

test('reports a missing removed original even when the current draft no longer links it', async (t) => {
  const { root } = await fixture(t)
  const ref = { ...reference(), removed: true }
  const report = await auditEvidence({
    root,
    references: [ref, { ...ref, kind: 'HISTORY', roundId: randomUUID() }],
  })
  assert.equal(report.status, 'ATTENTION')
  assert.equal(codes(report).MISSING_FILE, 1)
  assert.equal(report.counts.verifiedFiles, 0)
})

test('detects same-size byte changes by SHA-256', async (t) => {
  const { root } = await fixture(t)
  const ref = reference(Buffer.from('AAAA'))
  await writeFile(join(root, ref.key), 'BBBB')
  const report = await auditEvidence({ root, references: [ref] })
  assert.equal(codes(report).HASH_MISMATCH, 1)
  assert.equal(report.counts.verifiedFiles, 0)
  assert.equal(await readFile(join(root, ref.key), 'utf8'), 'BBBB')
})

test('detects size mismatch without reading an unbounded replacement', async (t) => {
  const { root } = await fixture(t)
  const ref = reference(Buffer.from('A'))
  await writeFile(join(root, ref.key), Buffer.alloc(6 * 1024 * 1024))
  const report = await auditEvidence({ root, references: [ref] })
  assert.equal(codes(report).SIZE_MISMATCH, 1)
})

test('preserves unreferenced files and redacts keys and unexpected original names', async (t) => {
  const { root } = await fixture(t)
  const key = randomUUID(),
    privateName = 'Nguyen Van Secret Student 20260001.pdf'
  await writeFile(join(root, key), 'unlinked upload')
  await writeFile(join(root, privateName), 'private')
  const report = await auditEvidence({ root, references: [] })
  assert.equal(codes(report).UNREFERENCED_FILE, 1)
  assert.equal(codes(report).UNEXPECTED_ENTRY, 1)
  assert.equal(report.counts.unreferencedFiles, 1)
  assert.ok(!JSON.stringify(report).includes(key))
  assert.ok(!JSON.stringify(report).includes(privateName))
  assert.equal((await readdir(root)).length, 2)
})

test('still verifies history-only bytes and flags missing original metadata', async (t) => {
  const { root } = await fixture(t)
  const bytes = Buffer.from('original evidence'),
    ref = reference(bytes)
  await writeFile(join(root, ref.key), bytes)
  const report = await auditEvidence({
    root,
    references: [{ ...ref, kind: 'HISTORY', roundId: randomUUID() }],
  })
  assert.equal(codes(report).HISTORY_METADATA_MISMATCH, 1)
  assert.equal(report.counts.verifiedFiles, 1)
  assert.equal(report.counts.unreferencedFiles, 0)
})

test('detects conflicting size/hash and cross-submission history references', async (t) => {
  const { root } = await fixture(t)
  const bytes = Buffer.from('original evidence'),
    ref = reference(bytes)
  await writeFile(join(root, ref.key), bytes)
  const bad = {
    ...ref,
    kind: 'HISTORY',
    roundId: randomUUID(),
    submissionId: randomUUID(),
    sha256: '0'.repeat(64),
  }
  const report = await auditEvidence({ root, references: [ref, bad] })
  assert.equal(codes(report).CONFLICTING_REFERENCE, 1)
  assert.equal(codes(report).HISTORY_METADATA_MISMATCH, 1)
})

test('invalid path keys never read outside the store; invalid metadata does not make bytes disposable', async (t) => {
  const { directory, root } = await fixture(t)
  const secretName = 'private-outside-store',
    secret = 'sensitive-content'
  await writeFile(join(directory, secretName), secret)
  const ref = reference()
  await writeFile(join(root, ref.key), 'preserve')
  const report = await auditEvidence({
    root,
    references: [
      { ...ref, key: '../' + secretName },
      { ...ref, size: '8' },
      { kind: 'INVALID_ROUND', roundId: randomUUID() },
    ],
  })
  assert.equal(codes(report).INVALID_REFERENCE, 2)
  assert.equal(codes(report).INVALID_ROUND, 1)
  assert.equal(codes(report).UNREFERENCED_FILE, undefined)
  assert.ok(!JSON.stringify(report).includes(secretName))
  assert.equal(await readFile(join(directory, secretName), 'utf8'), secret)
})

test('bounds issue details while retaining all issue counts', async (t) => {
  const { root } = await fixture(t)
  const refs = Array.from({ length: 120 }, () => reference())
  const report = await auditEvidence({ root, references: refs, detailLimit: 3 })
  assert.equal(report.issueCount, 120)
  assert.equal(codes(report).MISSING_FILE, 120)
  assert.equal(report.issues.length, 3)
  assert.equal(report.detailsTruncated, true)
})

test('refuses absent, relative and non-directory roots instead of declaring an empty store healthy', async (t) => {
  const { directory, root } = await fixture(t)
  await assert.rejects(auditEvidence({ root: join(directory, 'missing'), references: [] }))
  await assert.rejects(auditEvidence({ root: '.', references: [] }), /ABSOLUTE_STORAGE_ROOT/)
  const file = join(root, 'file')
  await writeFile(file, 'not directory')
  await assert.rejects(auditEvidence({ root: file, references: [] }), /UNSAFE_STORAGE_ROOT/)
})

test('does not follow a directory link used as the store root', async (t) => {
  const { directory, root } = await fixture(t)
  const link = join(directory, 'linked-store')
  await symlink(root, link, process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(auditEvidence({ root: link, references: [] }), /UNSAFE_STORAGE_ROOT/)
})

test('does not traverse a directory or junction disguised as a storage key', async (t) => {
  const { directory, root } = await fixture(t)
  const other = join(directory, 'other')
  await mkdir(other)
  const ref = reference()
  await symlink(other, join(root, ref.key), process.platform === 'win32' ? 'junction' : 'dir')
  const report = await auditEvidence({ root, references: [ref] })
  assert.equal(codes(report).UNSAFE_ENTRY, 1)
  assert.equal(report.counts.verifiedFiles, 0)
})

const cli = fileURLToPath(new URL('./audit-evidence.mjs', import.meta.url))
for (const [name, env, code] of [
  [
    'remote host',
    {
      APP_ENV: 'test',
      DATABASE_URL: 'postgres://user:secret@example.invalid:5434/student_service_test',
    },
    'REQUIRES_KNOWN_LOCAL_DATABASE',
  ],
  [
    'production',
    {
      APP_ENV: 'production',
      DATABASE_URL: 'postgres://user:secret@localhost:5434/student_service_test',
    },
    'REQUIRES_KNOWN_LOCAL_DATABASE',
  ],
  [
    'wrong database port',
    {
      APP_ENV: 'development',
      DATABASE_URL: 'postgres://user:secret@localhost:5434/student_service',
    },
    'REQUIRES_KNOWN_LOCAL_DATABASE',
  ],
  [
    'connection query options',
    {
      APP_ENV: 'test',
      DATABASE_URL:
        'postgres://user:secret@localhost:5434/student_service_test?host=example.invalid',
    },
    'REQUIRES_KNOWN_LOCAL_DATABASE',
  ],
  ['missing database URL', { APP_ENV: 'test', DATABASE_URL: '' }, 'INVALID_DATABASE_CONFIG'],
  [
    'relative root',
    {
      APP_ENV: 'test',
      DATABASE_URL: 'postgres://user:secret@localhost:5434/student_service_test',
      SUBMISSION_STORAGE_ROOT: '.',
    },
    'REQUIRES_ABSOLUTE_STORAGE_ROOT',
  ],
]) {
  test('CLI refuses ' + name + ' before database access and hides secrets', () => {
    const result = spawnSync(process.execPath, [cli], {
      encoding: 'utf8',
      timeout: 10000,
      env: { ...process.env, SUBMISSION_STORAGE_ROOT: tmpdir(), ...env },
    })
    assert.equal(result.error, undefined)
    assert.equal(result.status, 1)
    assert.equal(result.stdout, '')
    assert.deepEqual(JSON.parse(result.stderr), { status: 'INCOMPLETE', code })
    assert.ok(!result.stderr.includes('secret'))
  })
}

test('configuration accepts only the corresponding local development/test database', () => {
  for (const [APP_ENV, port, name] of [
    ['development', '5433', 'student_service'],
    ['test', '5434', 'student_service_test'],
  ]) {
    const config = auditConfiguration({
      APP_ENV,
      DATABASE_URL: `postgres://user:dummy@127.0.0.1:${port}/${name}`,
      SUBMISSION_STORAGE_ROOT: tmpdir(),
    })
    assert.equal(config.root, tmpdir())
  }
})

test('an interrupted reference scan never returns a healthy partial report', async (t) => {
  const { root } = await fixture(t)
  async function* interrupted() {
    yield reference()
    throw new Error('simulated database failure')
  }
  await assert.rejects(
    auditEvidence({ root, references: interrupted() }),
    /simulated database failure/,
  )
})

test('detects store changes while collecting a database snapshot', async (t) => {
  const { root } = await fixture(t)
  async function* changed() {
    const future = new Date(Date.now() + 60000)
    await utimes(root, future, future)
    yield reference()
  }
  const report = await auditEvidence({ root, references: changed() })
  assert.equal(report.status, 'ATTENTION')
  assert.equal(report.issuesByCode.STORAGE_CHANGED_DURING_SCAN, 1)
})
