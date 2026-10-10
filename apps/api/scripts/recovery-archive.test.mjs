import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, sep } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  createRecoveryBundle,
  restoreRecoveryFiles,
  verifyRecoveryBundle,
} from './recovery-bundle.mjs'
import {
  exportRecoveryBundle,
  inspectRecoveryArchive,
  validateRecoveryArchiveDestination,
} from './recovery-archive.mjs'

const policy = { keepLatest: 2, minAgeDays: 30 }
const now = new Date('2026-10-10T00:00:00.000Z')
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'student-recovery-archive-test-'))
  t.after(async () => {
    assert.ok(isAbsolute(root) && root.startsWith(join(tmpdir(), 'student-recovery-archive-test-')))
    await rm(root, { recursive: true, force: true })
  })
  const projectRoot = join(root, 'project'),
    archiveRoot = join(root, 'archive')
  await mkdir(projectRoot)
  async function bundle(createdAt = '2026-01-01T00:00:00.000Z') {
    const runId = randomUUID(),
      runRoot = join(projectRoot, 'run/recovery-drills', runId)
    await mkdir(runRoot, { recursive: true })
    const sourceRoot = join(runRoot, 'source-files'),
      bundleRoot = join(runRoot, 'bundle'),
      key = randomUUID()
    await mkdir(sourceRoot)
    await writeFile(join(sourceRoot, key), 'fake original evidence')
    await createRecoveryBundle({
      bundleRoot,
      sourceRoot,
      runId,
      assertQuiescent: async () => {},
      dump: (path) => writeFile(path, 'PGDMP fake unit fixture', { flag: 'wx' }),
    })
    const manifestPath = join(bundleRoot, 'manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.createdAt = createdAt
    await writeFile(manifestPath, JSON.stringify(manifest))
    return { bundleRoot, runId, key }
  }
  return {
    root,
    projectRoot,
    archiveRoot,
    bundle,
    export: (bundleRoot) => exportRecoveryBundle({ bundleRoot, archiveRoot, projectRoot }),
    inspect: () => inspectRecoveryArchive({ archiveRoot, projectRoot, policy, now }),
  }
}
async function snapshot(root) {
  const result = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) result.push([entry.name, await snapshot(path)])
    else result.push([entry.name, (await readFile(path)).toString('hex')])
  }
  return result
}

test('exports original bytes outside the project and can restore after the source bundle is lost', async (t) => {
  const f = await fixture(t),
    source = await f.bundle()
  const original = await snapshot(source.bundleRoot)
  const exported = await f.export(source.bundleRoot)
  assert.equal(exported.status, 'VERIFIED')
  assert.deepEqual(await snapshot(exported.bundleRoot), original)
  assert.deepEqual(await snapshot(source.bundleRoot), original)
  // Only delete the freshly created fixture directory, bounded by its unique test root.
  assert.ok(source.bundleRoot.startsWith(join(f.root, 'project') + sep))
  await rm(source.bundleRoot, { recursive: true })
  const targetRoot = join(f.root, 'restored')
  await restoreRecoveryFiles({ bundleRoot: exported.bundleRoot, targetRoot })
  assert.equal(await readFile(join(targetRoot, source.key), 'utf8'), 'fake original evidence')
  assert.equal((await f.inspect()).verified, 1)
})

test('duplicate export never replaces an existing saved copy', async (t) => {
  const f = await fixture(t),
    source = await f.bundle()
  await f.export(source.bundleRoot)
  const before = await snapshot(f.archiveRoot)
  await assert.rejects(f.export(source.bundleRoot), (error) => error.code === 'EEXIST')
  assert.deepEqual(await snapshot(f.archiveRoot), before)
})

test('retention preserves latest copies and minimum age; inspection never writes or deletes', async (t) => {
  const f = await fixture(t)
  const dates = [
    '2026-01-01T00:00:00.000Z',
    '2026-08-01T00:00:00.000Z',
    '2026-09-20T00:00:00.000Z',
    '2026-10-01T00:00:00.000Z',
  ]
  for (const date of dates) await f.export((await f.bundle(date)).bundleRoot)
  const before = await snapshot(f.archiveRoot)
  const report = await f.inspect()
  assert.equal(report.status, 'OK')
  assert.equal(report.candidates, 2)
  assert.deepEqual(
    report.entries.map((entry) => entry.createdAt),
    dates.toReversed(),
  )
  assert.deepEqual(
    report.entries.map((entry) => entry.proposal),
    ['KEEP', 'KEEP', 'CANDIDATE', 'CANDIDATE'],
  )
  const ageProtected = await inspectRecoveryArchive({
    ...f,
    policy: { keepLatest: 1, minAgeDays: 30 },
    now,
  })
  assert.equal(ageProtected.entries[1].reason, 'MINIMUM_AGE_PROTECTED')
  assert.equal(report.deletionPerformed, false)
  assert.equal(report.restoreTestedByThisInspection, false)
  assert.deepEqual(await snapshot(f.archiveRoot), before)
})

test('minimum age boundary is inclusive and policy never proposes the last verified copy', async (t) => {
  const f = await fixture(t)
  await f.export((await f.bundle('2026-09-10T00:00:00.000Z')).bundleRoot)
  await f.export((await f.bundle('2026-09-11T00:00:00.000Z')).bundleRoot)
  const report = await inspectRecoveryArchive({
    ...f,
    policy: { keepLatest: 1, minAgeDays: 30 },
    now,
  })
  assert.equal(report.candidates, 1)
  assert.equal(report.entries[0].proposal, 'KEEP')
})

for (const corruption of [
  'dump',
  'missing-file',
  'incomplete',
  'run-id',
  'future-date',
  'bad-date',
  'unknown-entry',
  'junction',
]) {
  test('blocks all retention candidates when archive has ' + corruption, async (t) => {
    const f = await fixture(t)
    for (let i = 0; i < 3; i++) await f.export((await f.bundle()).bundleRoot)
    const source = await f.bundle(),
      exported = await f.export(source.bundleRoot)
    const path = join(exported.bundleRoot, 'manifest.json')
    if (corruption === 'dump')
      await writeFile(join(exported.bundleRoot, 'database.dump'), 'PGDMP fake unit FIXTURE')
    if (corruption === 'missing-file') await rm(join(exported.bundleRoot, 'files', source.key))
    if (corruption === 'incomplete') await rm(path)
    if (['run-id', 'future-date', 'bad-date'].includes(corruption)) {
      const manifest = JSON.parse(await readFile(path, 'utf8'))
      if (corruption === 'run-id') manifest.runId = randomUUID()
      if (corruption === 'future-date') manifest.createdAt = '2099-01-01T00:00:00.000Z'
      if (corruption === 'bad-date') manifest.createdAt = 'invalid'
      await writeFile(path, JSON.stringify(manifest))
    }
    if (corruption === 'unknown-entry')
      await writeFile(join(f.archiveRoot, 'unrelated'), 'leave untouched')
    if (corruption === 'junction')
      await symlink(
        f.projectRoot,
        join(f.archiveRoot, randomUUID()),
        process.platform === 'win32' ? 'junction' : 'dir',
      )
    const report = await f.inspect()
    assert.equal(report.status, 'ATTENTION')
    assert.equal(report.invalid, 1)
    assert.equal(report.candidates, 0)
    assert.ok(
      report.entries
        .filter((entry) => entry.status === 'VERIFIED')
        .every((entry) => entry.reason === 'ARCHIVE_REQUIRES_ATTENTION'),
    )
  })
}

for (const type of [
  'inside-project',
  'ancestor-of-project',
  'relative',
  'unknown-existing',
  'linked-parent',
  'linked-archive',
  'outside-source',
  'corrupt-source',
  'non-fake',
]) {
  test('export refuses ' + type + ' without publishing a copy', async (t) => {
    const f = await fixture(t),
      source = await f.bundle()
    let archiveRoot = f.archiveRoot,
      bundleRoot = source.bundleRoot
    if (type === 'inside-project') archiveRoot = join(f.projectRoot, 'archive')
    if (type === 'ancestor-of-project') archiveRoot = f.root
    if (type === 'relative') archiveRoot = './archive'
    if (type === 'unknown-existing') {
      await mkdir(archiveRoot)
      await writeFile(join(archiveRoot, 'keep'), 'preserve')
    }
    if (type === 'linked-parent') {
      const link = join(f.root, 'linked')
      await symlink(f.projectRoot, link, process.platform === 'win32' ? 'junction' : 'dir')
      archiveRoot = join(link, 'archive')
    }
    if (type === 'linked-archive')
      await symlink(f.projectRoot, archiveRoot, process.platform === 'win32' ? 'junction' : 'dir')
    if (type === 'outside-source') {
      const external = join(f.root, 'external-bundle')
      await mkdir(external)
      // A valid bundle can be restored elsewhere, but export's source is restricted to project drills.
      const manifest = await verifyRecoveryBundle(bundleRoot)
      await writeFile(
        join(external, 'database.dump'),
        await readFile(join(bundleRoot, 'database.dump')),
      )
      await mkdir(join(external, 'files'))
      for (const file of manifest.files)
        await writeFile(
          join(external, 'files', file.key),
          await readFile(join(bundleRoot, 'files', file.key)),
        )
      await writeFile(join(external, 'manifest.json'), JSON.stringify(manifest))
      bundleRoot = external
    }
    if (type === 'corrupt-source') await writeFile(join(bundleRoot, 'database.dump'), 'broken')
    if (type === 'non-fake') {
      const path = join(bundleRoot, 'manifest.json'),
        manifest = JSON.parse(await readFile(path, 'utf8'))
      manifest.fakeDataOnly = false
      await writeFile(path, JSON.stringify(manifest))
    }
    const original = await snapshot(bundleRoot)
    await assert.rejects(exportRecoveryBundle({ ...f, archiveRoot, bundleRoot }))
    assert.deepEqual(await snapshot(bundleRoot), original)
    assert.ok(!(await readdir(f.projectRoot)).includes('fake-recovery-archive.json'))
    if (type === 'unknown-existing')
      assert.equal(await readFile(join(archiveRoot, 'keep'), 'utf8'), 'preserve')
    if (['outside-source', 'corrupt-source', 'non-fake'].includes(type))
      await assert.rejects(
        readFile(join(f.archiveRoot, 'fake-recovery-archive.json')),
        (error) => error.code === 'ENOENT',
      )
  })
}

test('invalid retention settings are refused, including zero latest copies and invalid dates', async (t) => {
  const f = await fixture(t)
  for (const invalid of [
    { keepLatest: 0, minAgeDays: 30 },
    { keepLatest: 1, minAgeDays: -1 },
    { keepLatest: 1.5, minAgeDays: 1 },
    { keepLatest: 10001, minAgeDays: 1 },
    { keepLatest: 1, minAgeDays: 36501 },
  ])
    await assert.rejects(
      inspectRecoveryArchive({ ...f, policy: invalid, now }),
      /INVALID_RETENTION_POLICY/,
    )
  await assert.rejects(
    inspectRecoveryArchive({ ...f, policy, now: new Date('invalid') }),
    /INVALID_RETENTION_POLICY/,
  )
})

test('malformed null manifests and null file entries fail with INVALID_MANIFEST', async (t) => {
  const f = await fixture(t),
    source = await f.bundle(),
    path = join(source.bundleRoot, 'manifest.json')
  const manifest = JSON.parse(await readFile(path, 'utf8'))
  for (const bad of [null, { ...manifest, files: [null] }]) {
    await writeFile(path, JSON.stringify(bad))
    await assert.rejects(verifyRecoveryBundle(source.bundleRoot), /INVALID_MANIFEST/)
  }
})

const cli = fileURLToPath(new URL('./manage-recovery-archive.mjs', import.meta.url))
for (const [name, args, extra] of [
  ['no flag', [], {}],
  ['unknown action', ['--fake-data-only', 'delete'], {}],
  ['bad policy', ['--fake-data-only', 'inspect', 'unused', '0', '30'], {}],
  [
    'external database',
    ['--fake-data-only', 'export', 'unused', 'unused'],
    { DATABASE_URL: 'postgres://private:secret@example.invalid/db' },
  ],
  [
    'external storage',
    ['--fake-data-only', 'export', 'unused', 'unused'],
    { SUBMISSION_STORAGE_ROOT: tmpdir() },
  ],
  ['production', ['--fake-data-only', 'inspect', 'unused', '1', '30'], { APP_ENV: 'production' }],
]) {
  test('archive CLI refuses ' + name, () => {
    const env = { ...process.env }
    delete env.DATABASE_URL
    delete env.SUBMISSION_STORAGE_ROOT
    delete env.APP_ENV
    Object.assign(env, extra)
    const result = spawnSync(process.execPath, [cli, ...args], {
      env,
      encoding: 'utf8',
      timeout: 10000,
    })
    assert.equal(result.error, undefined)
    assert.equal(result.status, 1)
    assert.equal(result.stdout, '')
    assert.ok(!result.stderr.includes('secret'))
    assert.match(result.stderr.trim(), /^[A-Z_]+$/)
  })
}

test('archive CLI inspection returns verified plan, ATTENTION for corruption and safe errors', async (t) => {
  const f = await fixture(t),
    source = await f.bundle(),
    exported = await f.export(source.bundleRoot)
  const env = { ...process.env }
  delete env.DATABASE_URL
  delete env.SUBMISSION_STORAGE_ROOT
  delete env.APP_ENV
  const inspect = () =>
    spawnSync(process.execPath, [cli, '--fake-data-only', 'inspect', f.archiveRoot, '2', '30'], {
      env,
      encoding: 'utf8',
      timeout: 10000,
    })
  const good = inspect()
  assert.equal(good.status, 0)
  assert.equal(JSON.parse(good.stdout).verified, 1)
  await writeFile(join(exported.bundleRoot, 'database.dump'), 'corrupted')
  const bad = inspect()
  assert.equal(bad.status, 2)
  assert.equal(JSON.parse(bad.stdout).status, 'ATTENTION')
})

test('empty owned archive reports EMPTY and never claims a usable backup', async (t) => {
  const f = await fixture(t),
    source = await f.bundle(),
    exported = await f.export(source.bundleRoot)
  assert.ok(exported.bundleRoot.startsWith(f.archiveRoot + sep))
  await rm(exported.bundleRoot, { recursive: true })
  const report = await f.inspect()
  assert.equal(report.status, 'EMPTY')
  assert.equal(report.verified, 0)
  assert.equal(report.candidates, 0)
})

test('altered archive marker refuses inspection and additional exports', async (t) => {
  const f = await fixture(t),
    source = await f.bundle()
  await f.export(source.bundleRoot)
  await writeFile(join(f.archiveRoot, 'fake-recovery-archive.json'), '{"fakeDataOnly":false}')
  const before = await snapshot(f.archiveRoot)
  await assert.rejects(f.inspect(), /UNRECOGNIZED_ARCHIVE/)
  await assert.rejects(f.export(source.bundleRoot), /UNRECOGNIZED_ARCHIVE/)
  assert.deepEqual(await snapshot(f.archiveRoot), before)
})

test('destination preflight creates nothing and accepts an existing owned archive', async (t) => {
  const f = await fixture(t)
  const before = await snapshot(f.root)
  assert.deepEqual(await validateRecoveryArchiveDestination(f), { exists: false })
  assert.deepEqual(await snapshot(f.root), before)
  await f.export((await f.bundle()).bundleRoot)
  const saved = await snapshot(f.root)
  assert.deepEqual(await validateRecoveryArchiveDestination(f), { exists: true })
  assert.deepEqual(await snapshot(f.root), saved)
})

test('destination preflight rejects unrelated and linked folders without modifying them', async (t) => {
  const f = await fixture(t)
  await mkdir(f.archiveRoot)
  await writeFile(join(f.archiveRoot, 'keep'), 'preserve')
  await assert.rejects(validateRecoveryArchiveDestination(f))
  assert.equal(await readFile(join(f.archiveRoot, 'keep'), 'utf8'), 'preserve')
  const linked = join(f.root, 'linked')
  await symlink(f.archiveRoot, linked, process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(
    validateRecoveryArchiveDestination({ ...f, archiveRoot: linked }),
    /UNSAFE_ARCHIVE_DIRECTORY/,
  )
  assert.deepEqual(await readdir(f.archiveRoot), ['keep'])
})
