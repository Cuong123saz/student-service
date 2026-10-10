import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, sep } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createRecoveryBundle } from './recovery-bundle.mjs'
import { oldBytes } from './recovery-fixture.mjs'
import {
  createRecoveryKey,
  encryptRecoveryBundle,
  inspectEncryptedRecoveryArchive,
} from './encrypted-recovery.mjs'

const policy = { keepLatest: 2, minAgeDays: 30 }
const cli = fileURLToPath(new URL('./manage-encrypted-recovery.mjs', import.meta.url))
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'student-encrypted-catalog-'))
  t.after(async () => {
    assert.ok(isAbsolute(root) && root.startsWith(join(tmpdir(), 'student-encrypted-catalog-')))
    await rm(root, { recursive: true, force: true })
  })
  const projectRoot = join(root, 'project'),
    archiveRoot = join(root, 'archive'),
    keyRoot = join(root, 'keys')
  await mkdir(projectRoot)
  await mkdir(keyRoot)
  const keyPath = join(keyRoot, 'fake-key.json')
  const keyInfo = await createRecoveryKey({ keyPath, projectRoot })
  const now = new Date()
  async function bundle(daysAgo = 40, selectedKey = keyPath) {
    const runId = randomUUID(),
      runRoot = join(projectRoot, 'run/recovery-drills', runId)
    await mkdir(runRoot, { recursive: true })
    const sourceRoot = join(runRoot, 'source-files'),
      bundleRoot = join(runRoot, 'bundle')
    await mkdir(sourceRoot)
    await writeFile(join(sourceRoot, randomUUID()), oldBytes)
    await createRecoveryBundle({
      sourceRoot,
      bundleRoot,
      runId,
      assertQuiescent: async () => {},
      dump: (path) => writeFile(path, 'PGDMP fake database unit fixture', { flag: 'wx' }),
    })
    const path = join(bundleRoot, 'manifest.json'),
      manifest = JSON.parse(await readFile(path, 'utf8'))
    manifest.createdAt = new Date(now.getTime() - daysAgo * 86400000).toISOString()
    await writeFile(path, JSON.stringify(manifest))
    return encryptRecoveryBundle({ bundleRoot, archiveRoot, keyPath: selectedKey, projectRoot })
  }
  const inspect = (extra = {}) =>
    inspectEncryptedRecoveryArchive({ archiveRoot, keyPath, projectRoot, policy, now, ...extra })
  return { root, projectRoot, archiveRoot, keyPath, keyInfo, keyRoot, now, bundle, inspect }
}
async function snapshot(root) {
  const entries = []
  for (const entry of (await readdir(root, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const path = join(root, entry.name)
    entries.push([
      entry.name,
      entry.isDirectory() ? await snapshot(path) : (await readFile(path)).toString('hex'),
    ])
  }
  return entries
}
function invoke(args, extra = {}) {
  const env = { ...process.env }
  delete env.DATABASE_URL
  delete env.SUBMISSION_STORAGE_ROOT
  delete env.APP_ENV
  return spawnSync(process.execPath, [cli, ...args], {
    env: { ...env, ...extra },
    encoding: 'utf8',
    timeout: 15000,
  })
}

test('authenticates every package; protects latest and minimum age without writing plaintext or changing files', async (t) => {
  const f = await fixture(t)
  for (const days of [60, 40, 5, 1]) await f.bundle(days)
  const before = await snapshot(f.root)
  const report = await f.inspect()
  assert.equal(report.status, 'OK')
  assert.equal(report.mode, 'READ_ONLY_ENCRYPTED_RETENTION_PROPOSAL')
  assert.equal(report.verified, 4)
  assert.equal(report.invalid, 0)
  assert.equal(report.unverified, 0)
  assert.equal(report.candidates, 2)
  assert.equal(report.deletionPerformed, false)
  assert.equal(report.restoreTestedByThisInspection, false)
  assert.deepEqual(
    report.entries.map((e) => e.reason),
    ['LATEST_PROTECTED', 'LATEST_PROTECTED', 'POLICY_EXCEEDED', 'POLICY_EXCEEDED'],
  )
  assert.ok(
    report.entries.every((e) => e.keyId === f.keyInfo.keyId && e.fileBytes === oldBytes.length),
  )
  const output = JSON.stringify(report),
    secret = JSON.parse(await readFile(f.keyPath, 'utf8')).keyHex
  assert.ok(!output.includes(secret) && !output.includes(f.keyPath) && !output.includes('Nguyễn'))
  assert.deepEqual(await snapshot(f.root), before)
})
test('young copies remain protected even beyond the latest count', async (t) => {
  const f = await fixture(t)
  for (const days of [2, 1, 0]) await f.bundle(days)
  const report = await f.inspect()
  assert.equal(report.candidates, 0)
  assert.equal(report.entries[2].reason, 'MINIMUM_AGE_PROTECTED')
})
test('minimum age boundary is inclusive and latest protection takes priority', async (t) => {
  const f = await fixture(t)
  await f.bundle(30)
  await f.bundle(31)
  const report = await f.inspect({ policy: { keepLatest: 1, minAgeDays: 31 } })
  assert.equal(report.candidates, 1)
  assert.equal(report.entries[0].reason, 'LATEST_PROTECTED')
  assert.equal(report.entries[1].reason, 'POLICY_EXCEEDED')
})
test('equal creation dates sort deterministically by ascending runId before latest protection', async (t) => {
  const f = await fixture(t)
  for (let i = 0; i < 3; i++) await f.bundle(40)
  const report = await f.inspect({ policy: { keepLatest: 1, minAgeDays: 30 } })
  const ids = report.entries.map((e) => e.runId)
  assert.deepEqual(ids, [...ids].sort())
  assert.equal(report.candidates, 2)
})
test('owned empty archive reports EMPTY; missing archive is never created', async (t) => {
  const f = await fixture(t)
  await assert.rejects(f.inspect(), /ENCRYPTED_ARCHIVE_NOT_FOUND/)
  await assert.rejects(readdir(f.archiveRoot), (e) => e.code === 'ENOENT')
  const result = await f.bundle()
  assert.ok(isAbsolute(result.bundleRoot) && result.bundleRoot.startsWith(f.root + sep))
  await rm(result.bundleRoot, { recursive: true })
  const report = await f.inspect()
  assert.equal(report.status, 'EMPTY')
  assert.equal(report.verified, 0)
  assert.equal(report.candidates, 0)
})
for (const part of ['database.enc', 'manifest.enc'])
  test('corrupt ' + part + ' blocks proposals for every otherwise valid package', async (t) => {
    const f = await fixture(t),
      damaged = await f.bundle(100)
    for (const days of [90, 80, 70]) await f.bundle(days)
    const path = join(damaged.bundleRoot, part),
      bytes = await readFile(path)
    bytes[0] ^= 1
    await writeFile(path, bytes)
    const before = await snapshot(f.archiveRoot),
      report = await f.inspect()
    assert.equal(report.status, 'ATTENTION')
    assert.equal(report.verified, 3)
    assert.equal(report.invalid, 1)
    assert.equal(report.candidates, 0)
    assert.ok(
      report.entries
        .filter((e) => e.status === 'VERIFIED')
        .every((e) => e.reason === 'ARCHIVE_REQUIRES_ATTENTION' && e.proposal === 'KEEP'),
    )
    assert.deepEqual(await snapshot(f.archiveRoot), before)
  })
test('missing encrypted attachment blocks the catalog despite a valid manifest', async (t) => {
  const f = await fixture(t),
    result = await f.bundle()
  const path = join(
    result.bundleRoot,
    'files',
    (await readdir(join(result.bundleRoot, 'files')))[0],
  )
  assert.ok(isAbsolute(path) && path.startsWith(f.root + sep))
  await rm(path)
  const report = await f.inspect()
  assert.equal(report.status, 'ATTENTION')
  assert.equal(report.invalid, 1)
  assert.equal(report.candidates, 0)
})
test('different keyId is UNVERIFIED, not corrupt, and blocks otherwise eligible proposals', async (t) => {
  const f = await fixture(t)
  for (const days of [90, 80, 70]) await f.bundle(days)
  const another = join(f.keyRoot, 'another-key.json')
  await createRecoveryKey({ keyPath: another, projectRoot: f.projectRoot })
  const unknown = await f.bundle(100, another)
  const report = await f.inspect()
  assert.equal(report.status, 'ATTENTION')
  assert.equal(report.verified, 3)
  assert.equal(report.invalid, 0)
  assert.equal(report.unverified, 1)
  assert.equal(report.candidates, 0)
  const entry = report.entries.find((e) => e.runId === unknown.runId)
  assert.deepEqual(entry, {
    runId: unknown.runId,
    status: 'UNVERIFIED',
    code: 'KEY_UNAVAILABLE_FOR_PACKAGE',
  })
})
test('same keyId with a wrong secret cannot authenticate a package', async (t) => {
  const f = await fixture(t)
  await f.bundle()
  const key = JSON.parse(await readFile(f.keyPath, 'utf8'))
  key.keyHex = '0'.repeat(64)
  await writeFile(f.keyPath, JSON.stringify(key), { mode: 0o600 })
  const report = await f.inspect()
  assert.equal(report.status, 'ATTENTION')
  assert.equal(report.invalid, 1)
  assert.equal(report.unverified, 0)
  assert.equal(report.verified, 0)
})
test('unknown archive names are sanitized and stop all proposals', async (t) => {
  const f = await fixture(t)
  await f.bundle()
  await writeFile(join(f.archiveRoot, 'fictional-student-private-name.txt'), 'fake')
  const report = await f.inspect()
  assert.equal(report.status, 'ATTENTION')
  assert.equal(report.candidates, 0)
  assert.ok(!JSON.stringify(report).includes('private-name'))
  assert.deepEqual(report.entries.at(-1), { status: 'INVALID', code: 'UNEXPECTED_ARCHIVE_ENTRY' })
})
test('package folder must match the authenticated runId', async (t) => {
  const f = await fixture(t),
    result = await f.bundle(),
    destination = join(f.archiveRoot, randomUUID())
  assert.ok(isAbsolute(result.bundleRoot) && result.bundleRoot.startsWith(f.root + sep))
  assert.ok(isAbsolute(destination) && destination.startsWith(f.root + sep))
  await rename(result.bundleRoot, destination)
  assert.equal((await f.inspect()).invalid, 1)
})
test('inspection time before an authenticated creation date is not treated as healthy', async (t) => {
  const f = await fixture(t)
  await f.bundle(1)
  const report = await f.inspect({ now: new Date(f.now.getTime() - 2 * 86400000) })
  assert.equal(report.status, 'ATTENTION')
  assert.equal(report.invalid, 1)
})
test('package junctions are refused without following their contents', async (t) => {
  const f = await fixture(t)
  await f.bundle()
  const other = join(f.root, 'unrelated'),
    path = join(f.archiveRoot, randomUUID())
  await mkdir(other)
  await writeFile(join(other, 'private.txt'), 'fake-private')
  await symlink(other, path, process.platform === 'win32' ? 'junction' : 'dir')
  assert.equal((await f.inspect()).invalid, 1)
  assert.equal(await readFile(join(other, 'private.txt'), 'utf8'), 'fake-private')
})
test('root junctions and unmarked folders are refused', async (t) => {
  const f = await fixture(t)
  await f.bundle()
  const alias = join(f.root, 'alias'),
    unmarked = join(f.root, 'unmarked')
  await symlink(f.archiveRoot, alias, process.platform === 'win32' ? 'junction' : 'dir')
  await mkdir(unmarked)
  await assert.rejects(f.inspect({ archiveRoot: alias }))
  await assert.rejects(f.inspect({ archiveRoot: unmarked }))
})
test('missing key refuses the scan instead of returning a healthy or empty result', async (t) => {
  const f = await fixture(t)
  await f.bundle()
  await assert.rejects(f.inspect({ keyPath: join(f.keyRoot, 'missing.json') }))
})
for (const [name, extra] of [
  ['zero latest', { policy: { keepLatest: 0, minAgeDays: 30 } }],
  ['string latest', { policy: { keepLatest: '2', minAgeDays: 30 } }],
  ['too many latest', { policy: { keepLatest: 10001, minAgeDays: 30 } }],
  ['fractional age', { policy: { keepLatest: 2, minAgeDays: 1.5 } }],
  ['zero age', { policy: { keepLatest: 2, minAgeDays: 0 } }],
  ['excessive age', { policy: { keepLatest: 2, minAgeDays: 36501 } }],
  ['absent policy', { policy: undefined }],
  ['invalid time', { policy, now: new Date('invalid') }],
])
  test('refuses ' + name + ' before filesystem access', async () => {
    await assert.rejects(
      inspectEncryptedRecoveryArchive({
        archiveRoot: 'unused',
        keyPath: 'unused',
        projectRoot: 'unused',
        ...extra,
      }),
      /INVALID_RETENTION_POLICY/,
    )
  })
test('CLI returns 0 for verified catalog and 2 for attention without modifying packages', async (t) => {
  const f = await fixture(t),
    result = await f.bundle()
  const args = ['--fake-data-only', 'inspect', f.archiveRoot, f.keyPath, '2', '30']
  const before = await snapshot(f.archiveRoot),
    healthy = invoke(args)
  assert.equal(healthy.error, undefined)
  assert.equal(healthy.status, 0, healthy.stderr)
  assert.equal(JSON.parse(healthy.stdout).status, 'OK')
  assert.deepEqual(await snapshot(f.archiveRoot), before)
  const path = join(result.bundleRoot, 'database.enc'),
    bytes = await readFile(path)
  bytes[0] ^= 1
  await writeFile(path, bytes)
  const attention = invoke(args)
  assert.equal(attention.error, undefined)
  assert.equal(attention.status, 2, attention.stderr)
  assert.equal(JSON.parse(attention.stdout).status, 'ATTENTION')
  assert.equal(attention.stderr, '')
})
for (const [name, args, extra] of [
  ['missing fake flag', ['inspect', 'unused', 'secret-key-path', '2', '30'], {}],
  ['missing key argument', ['--fake-data-only', 'inspect', 'unused', '2', '30'], {}],
  [
    'noninteger policy',
    ['--fake-data-only', 'inspect', 'unused', 'secret-key-path', '2.5', '30'],
    {},
  ],
  [
    'extra argument',
    ['--fake-data-only', 'inspect', 'unused', 'secret-key-path', '2', '30', 'extra'],
    {},
  ],
  [
    'database environment',
    ['--fake-data-only', 'inspect', 'unused', 'secret-key-path', '2', '30'],
    { DATABASE_URL: 'postgres://fake:secret@example.invalid/db' },
  ],
  [
    'storage environment',
    ['--fake-data-only', 'inspect', 'unused', 'secret-key-path', '2', '30'],
    { SUBMISSION_STORAGE_ROOT: 'secret-storage' },
  ],
  [
    'production environment',
    ['--fake-data-only', 'inspect', 'unused', 'secret-key-path', '2', '30'],
    { APP_ENV: 'production' },
  ],
])
  test('CLI refuses ' + name + ' safely', () => {
    const result = invoke(args, extra)
    assert.equal(result.error, undefined)
    assert.equal(result.status, 1)
    assert.equal(result.stdout, '')
    assert.match(result.stderr.trim(), /^[A-Z_]+$/)
    assert.ok(!result.stderr.includes('secret'))
  })
