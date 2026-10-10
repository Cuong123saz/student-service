import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import {
  assertDrillDatabase,
  assertOwnedContainer,
  assertEmptyTarget,
  createRecoveryBundle,
  verifyRecoveryBundle,
  restoreRecoveryFiles,
  normalizeRecoveryDefinition,
  sourceDatabase,
} from './recovery-bundle.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'student-recovery-bundle-'))
  t.after(async () => {
    assert.ok(isAbsolute(root) && root.startsWith(join(tmpdir(), 'student-recovery-bundle-')))
    await rm(root, { recursive: true, force: true })
  })
  const sourceRoot = join(root, 'source'),
    bundleRoot = join(root, 'bundle'),
    targetRoot = join(root, 'target'),
    key = randomUUID(),
    runId = randomUUID()
  await mkdir(sourceRoot)
  await writeFile(join(sourceRoot, key), 'fake original bytes')
  const args = {
    sourceRoot,
    bundleRoot,
    runId,
    assertQuiescent: async () => {},
    dump: (path) => writeFile(path, 'PGDMP fake unit fixture', { flag: 'wx' }),
  }
  return { root, sourceRoot, bundleRoot, targetRoot, key, runId, args }
}

test('bundle includes every UUID original, publishes manifest last and restores into a new directory', async (t) => {
  const f = await fixture(t),
    extra = randomUUID()
  await writeFile(join(f.sourceRoot, extra), 'fake removed or unlinked bytes')
  let checks = 0
  const manifest = await createRecoveryBundle({
    ...f.args,
    assertQuiescent: async () => {
      checks++
    },
  })
  assert.equal(checks, 2)
  assert.equal(manifest.fakeDataOnly, true)
  assert.equal(manifest.files.length, 2)
  assert.deepEqual(await verifyRecoveryBundle(f.bundleRoot), manifest)
  await restoreRecoveryFiles(f)
  assert.deepEqual((await readdir(f.targetRoot)).sort(), [f.key, extra].sort())
  assert.deepEqual(
    await readFile(join(f.targetRoot, f.key)),
    await readFile(join(f.sourceRoot, f.key)),
  )
  assert.deepEqual(
    await readFile(join(f.targetRoot, extra)),
    await readFile(join(f.sourceRoot, extra)),
  )
})

test('never replaces an existing bundle or restored directory', async (t) => {
  const f = await fixture(t)
  await createRecoveryBundle(f.args)
  const before = await readFile(join(f.bundleRoot, 'manifest.json'))
  await assert.rejects(createRecoveryBundle(f.args), (error) => error.code === 'EEXIST')
  assert.deepEqual(await readFile(join(f.bundleRoot, 'manifest.json')), before)
  await mkdir(f.targetRoot)
  await writeFile(join(f.targetRoot, 'keep'), 'preserve')
  await assert.rejects(restoreRecoveryFiles(f), (error) => error.code === 'EEXIST')
  assert.equal(await readFile(join(f.targetRoot, 'keep'), 'utf8'), 'preserve')
})

test('a failed dump leaves no completion marker and cannot be restored', async (t) => {
  const f = await fixture(t)
  await assert.rejects(
    createRecoveryBundle({
      ...f.args,
      dump: async () => {
        throw new Error('SIMULATED_DUMP_FAILURE')
      },
    }),
    /SIMULATED_DUMP_FAILURE/,
  )
  assert.ok(!(await readdir(f.bundleRoot)).includes('manifest.json'))
  await assert.rejects(restoreRecoveryFiles(f))
  await assert.rejects(readFile(f.targetRoot), (error) => error.code === 'ENOENT')
})

test('rejects a source change during backup and leaves no completed manifest', async (t) => {
  const f = await fixture(t)
  await assert.rejects(
    createRecoveryBundle({
      ...f.args,
      dump: async (path) => {
        await f.args.dump(path)
        await writeFile(join(f.sourceRoot, f.key), 'changed bytes')
      },
    }),
    /SOURCE_STORAGE_CHANGED/,
  )
  assert.ok(!(await readdir(f.bundleRoot)).includes('manifest.json'))
})

test('requires quiescence before reading or publishing any bundle', async (t) => {
  const f = await fixture(t)
  await assert.rejects(
    createRecoveryBundle({
      ...f.args,
      assertQuiescent: async () => {
        throw new Error('WRITER_STILL_RUNNING')
      },
    }),
    /WRITER_STILL_RUNNING/,
  )
  assert.ok(!(await readdir(f.root)).includes('bundle'))
  let calls = 0
  await assert.rejects(
    createRecoveryBundle({
      ...f.args,
      assertQuiescent: async () => {
        if (++calls === 2) throw new Error('WRITER_REAPPEARED')
      },
    }),
    /WRITER_REAPPEARED/,
  )
  assert.ok(!(await readdir(f.bundleRoot)).includes('manifest.json'))
})

for (const type of [
  'missing-file',
  'changed-file',
  'changed-dump',
  'extra-bundle-file',
  'traversal-key',
  'duplicate-key',
  'non-fake-manifest',
]) {
  test('refuses ' + type + ' before creating restore output', async (t) => {
    const f = await fixture(t)
    await createRecoveryBundle(f.args)
    if (type === 'missing-file') await rm(join(f.bundleRoot, 'files', f.key))
    if (type === 'changed-file')
      await writeFile(join(f.bundleRoot, 'files', f.key), 'FAKE original bytes')
    if (type === 'changed-dump')
      await writeFile(join(f.bundleRoot, 'database.dump'), 'PGDMP fake unit FIXTURE')
    if (type === 'extra-bundle-file') await writeFile(join(f.bundleRoot, 'extra'), 'extra')
    if (['traversal-key', 'duplicate-key', 'non-fake-manifest'].includes(type)) {
      const path = join(f.bundleRoot, 'manifest.json'),
        manifest = JSON.parse(await readFile(path, 'utf8'))
      if (type === 'traversal-key') manifest.files[0].key = '../outside'
      if (type === 'duplicate-key') manifest.files.push(manifest.files[0])
      if (type === 'non-fake-manifest') manifest.fakeDataOnly = false
      await writeFile(path, JSON.stringify(manifest))
    }
    await assert.rejects(restoreRecoveryFiles(f))
    assert.ok(!(await readdir(f.root)).includes('target'))
  })
}

test('rejects a junction or directory disguised as an original evidence file', async (t) => {
  const f = await fixture(t),
    outside = join(f.root, 'outside')
  await mkdir(outside)
  await symlink(
    outside,
    join(f.sourceRoot, randomUUID()),
    process.platform === 'win32' ? 'junction' : 'dir',
  )
  await assert.rejects(createRecoveryBundle(f.args), /UNSAFE_OR_OVERSIZED_FILE/)
})

test('ownership check refuses different ID, name, label, image and persistent mounts', () => {
  const runId = randomUUID(),
    id = 'a'.repeat(64)
  const owned = {
    Id: id,
    Name: '/student-service-recovery-' + runId,
    Config: { Image: 'postgres:17-alpine', Labels: { 'student-service.recovery-id': runId } },
    Mounts: [{ Type: 'tmpfs' }],
  }
  assert.doesNotThrow(() => assertOwnedContainer(owned, runId, id))
  for (const bad of [
    { ...owned, Id: 'b'.repeat(64) },
    { ...owned, Name: '/student-service-postgres' },
    { ...owned, Config: { ...owned.Config, Labels: {} } },
    { ...owned, Config: { ...owned.Config, Image: 'other' } },
    { ...owned, Mounts: [{ Type: 'bind' }] },
    { ...owned, Mounts: [{ Type: 'volume' }] },
  ])
    assert.throws(() => assertOwnedContainer(bad, runId, id))
})

test('database guard refuses normal local databases, remote hosts and query overrides', () => {
  assert.doesNotThrow(() =>
    assertDrillDatabase('postgres://test:fake@127.0.0.1:55499/' + sourceDatabase, sourceDatabase),
  )
  for (const url of [
    'postgres://test:fake@127.0.0.1:5433/' + sourceDatabase,
    'postgres://test:fake@127.0.0.1:5434/student_service_test',
    'postgres://test:fake@example.invalid:55499/' + sourceDatabase,
    'postgres://test:fake@127.0.0.1:55499/' + sourceDatabase + '?host=other',
  ])
    assert.throws(() => assertDrillDatabase(url, sourceDatabase), /INVALID_DRILL_DATABASE/)
})

test('empty-target check rejects existing relations, functions, extensions and schemas', async () => {
  const empty = { relations: 0, functions: 0, extensions: 0, schemas: 0 }
  await assertEmptyTarget({ unsafe: async () => [empty] })
  for (const key of Object.keys(empty))
    await assert.rejects(
      assertEmptyTarget({ unsafe: async () => [{ ...empty, [key]: 1 }] }),
      /RESTORE_TARGET_NOT_EMPTY/,
    )
})

const cli = fileURLToPath(new URL('./rehearse-recovery.mjs', import.meta.url))
for (const [name, args, override, message] of [
  ['no flag', [], {}, 'REQUIRES_FAKE_DATA_ONLY_FLAG'],
  [
    'unknown flag',
    ['--fake-data-only', '--target=development'],
    {},
    'REQUIRES_FAKE_DATA_ONLY_FLAG',
  ],
  [
    'inherited database',
    ['--fake-data-only'],
    { DATABASE_URL: 'postgres://fake:secret@localhost:5433/student_service' },
    'EXTERNAL_DATABASE_OR_STORAGE_CONFIG_REFUSED',
  ],
  [
    'inherited storage',
    ['--fake-data-only'],
    { SUBMISSION_STORAGE_ROOT: tmpdir() },
    'EXTERNAL_DATABASE_OR_STORAGE_CONFIG_REFUSED',
  ],
  [
    'production environment',
    ['--fake-data-only'],
    { APP_ENV: 'production' },
    'EXTERNAL_DATABASE_OR_STORAGE_CONFIG_REFUSED',
  ],
]) {
  test('rehearsal refuses ' + name + ' before Docker or filesystem work', () => {
    const env = { ...process.env }
    delete env.DATABASE_URL
    delete env.SUBMISSION_STORAGE_ROOT
    delete env.APP_ENV
    Object.assign(env, override)
    const result = spawnSync(process.execPath, [cli, ...args], {
      env,
      encoding: 'utf8',
      timeout: 10000,
    })
    assert.equal(result.error, undefined)
    assert.equal(result.status, 1)
    assert.equal(result.stdout, '')
    assert.equal(result.stderr.trim(), message)
    assert.ok(!result.stderr.includes('secret'))
  })
}

test('normalizes only PostgreSQL literal varchar array cast formatting and preserves different predicates', () => {
  const before =
    "status = ANY ((ARRAY['ACTIVE'::character varying, 'INACTIVE'::character varying])::text[])"
  const after =
    "status = ANY (ARRAY[('ACTIVE'::character varying)::text, ('INACTIVE'::character varying)::text])"
  assert.equal(normalizeRecoveryDefinition(before), after)
  assert.equal(normalizeRecoveryDefinition(after), after)
  assert.notEqual(normalizeRecoveryDefinition(before.replace('INACTIVE', 'DELETED')), after)
  const expression = 'status = ANY ((ARRAY[custom_function()])::text[])'
  assert.equal(normalizeRecoveryDefinition(expression), expression)
  const escaped = "ANY ((ARRAY['O''Brien, A'::character varying])::text[])"
  assert.equal(
    normalizeRecoveryDefinition(escaped),
    "ANY (ARRAY[('O''Brien, A'::character varying)::text])",
  )
})
