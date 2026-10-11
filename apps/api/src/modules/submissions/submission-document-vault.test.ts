import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import {
  appendFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test, type TestContext } from 'node:test'
import {
  LocalDocumentVault,
  documentDigest,
  disjointDocumentRoots,
  maximumDocumentBytes,
  type DocumentVaultOptions,
} from './submission-document-vault.js'
import { SubmissionError } from './submission.types.js'
async function fixture(t: TestContext, hooks: Pick<DocumentVaultOptions, 'onDurableWrite'> = {}) {
  const parent = resolve(tmpdir()),
    root = await mkdtemp(join(parent, 'student-document-vault-'))
  t.after(async () => {
    assert.equal(dirname(root), parent)
    assert.ok(root.startsWith(join(parent, 'student-document-vault-')))
    await rm(root, { recursive: true, force: true })
  })
  const options = {
    outputRoot: join(root, 'output'),
    stagingRoot: join(root, 'staging'),
    protectedRoots: [
      join(root, 'deployment'),
      join(root, 'deployment', 'templates'),
      join(root, 'evidence'),
    ],
    ...hooks,
  }
  return { root, options, vault: await LocalDocumentVault.create(options) }
}
const integrity = (error: unknown) =>
  error instanceof SubmissionError &&
  error.code === 'DOCUMENT_INTEGRITY' &&
  !error.message.includes(tmpdir())
test('vault stores exact binary bytes, keeps both durable artifacts, and reads by digest', async (t) => {
  const f = await fixture(t),
    key = randomUUID(),
    bytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i))
  const metadata = await f.vault.put(key, bytes)
  assert.deepEqual(metadata, documentDigest(bytes))
  assert.deepEqual(await f.vault.read(key, metadata), bytes)
  for (const root of [f.options.outputRoot, f.options.stagingRoot]) {
    assert.deepEqual(await readFile(join(root, key)), bytes)
    assert.ok((await lstat(join(root, key))).isFile())
  }
})
test('vault rejects relative, equal, parent and protected root overlaps before creating files', async (t) => {
  const f = await fixture(t)
  for (const roots of [
    ['relative', f.options.outputRoot],
    [f.options.outputRoot, f.options.outputRoot],
    [f.root, f.options.outputRoot],
    [f.options.outputRoot, join(f.options.outputRoot, 'nested')],
  ])
    assert.throws(() => disjointDocumentRoots(roots))
  await assert.rejects(
    LocalDocumentVault.create({ ...f.options, outputRoot: join(f.root, 'deployment', 'output') }),
    /OVERLAP/,
  )
  await assert.rejects(
    LocalDocumentVault.create({ ...f.options, protectedRoots: [] }),
    /PROTECTED_ROOTS_REQUIRED/,
  )
})
test('vault never overwrites an existing stage or final entry', async (t) => {
  const f = await fixture(t),
    key = randomUUID(),
    bytes = Buffer.from('first durable content')
  await f.vault.put(key, bytes)
  await assert.rejects(f.vault.put(key, Buffer.from('different')), /EEXIST/)
  assert.deepEqual(await f.vault.read(key, documentDigest(bytes)), bytes)
  const another = randomUUID()
  await writeFile(join(f.options.outputRoot, another), bytes)
  await assert.rejects(f.vault.put(another, Buffer.from('replacement')), /EEXIST/)
  assert.deepEqual(await readFile(join(f.options.outputRoot, another)), bytes)
  assert.deepEqual(await readFile(join(f.options.stagingRoot, another)), Buffer.from('replacement'))
})
test('vault captures input before asynchronous I/O and ignores caller buffer mutation', async (t) => {
  const f = await fixture(t),
    key = randomUUID(),
    bytes = Buffer.from('original'),
    expected = Buffer.from(bytes)
  const writing = f.vault.put(key, bytes)
  bytes.fill(0)
  assert.deepEqual(await f.vault.read(key, await writing), expected)
})
test('vault accepts exactly 16 MiB and rejects empty/oversized content before writing', async (t) => {
  const f = await fixture(t),
    key = randomUUID(),
    bytes = Buffer.alloc(maximumDocumentBytes, 42)
  const metadata = await f.vault.put(key, bytes)
  assert.deepEqual(await f.vault.read(key, metadata), bytes)
  for (const invalid of [Buffer.alloc(0), Buffer.alloc(maximumDocumentBytes + 1)])
    await assert.rejects(f.vault.put(randomUUID(), invalid), /INVALID_DOCUMENT_SIZE/)
})
test('vault refuses paths disguised as keys and invalid digest bounds', async (t) => {
  const f = await fixture(t)
  for (const key of ['../secret', '', 'A'.repeat(36), 'abc.docx', randomUUID() + ':stream'])
    await assert.rejects(f.vault.put(key, Buffer.from('x')), /INVALID_DOCUMENT_STORAGE_KEY/)
  for (const metadata of [
    { size: 0, sha256: 'a'.repeat(64) },
    { size: maximumDocumentBytes + 1, sha256: 'a'.repeat(64) },
    { size: 1, sha256: '../x' },
  ])
    await assert.rejects(f.vault.read(randomUUID(), metadata), /INVALID_DOCUMENT_DIGEST/)
})
test('vault refuses changed, grown, truncated, deleted and directory output without regeneration', async (t) => {
  const f = await fixture(t),
    bytes = Buffer.from('durable original')
  for (const mutate of [
    async (path: string) => writeFile(path, Buffer.from('changed original')),
    async (path: string) => appendFile(path, 'x'),
    async (path: string) => writeFile(path, Buffer.from('x')),
    async (path: string) => unlink(path),
    async (path: string) => {
      await unlink(path)
      await mkdir(path)
    },
  ]) {
    const key = randomUUID(),
      metadata = await f.vault.put(key, bytes)
    await mutate(join(f.options.outputRoot, key))
    await assert.rejects(f.vault.read(key, metadata), integrity)
  }
})
test('vault rejects a junction root and an ancestor junction', async (t) => {
  const f = await fixture(t),
    target = join(f.root, 'target'),
    link = join(f.root, 'junction')
  await mkdir(target)
  await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir')
  for (const outputRoot of [link, join(link, 'nested')])
    await assert.rejects(
      LocalDocumentVault.create({ ...f.options, outputRoot }),
      /UNSAFE_DOCUMENT_DIRECTORY/,
    )
})
test('vault detects replacement of a configured root by a junction after initialization', async (t) => {
  const f = await fixture(t),
    moved = join(f.root, 'moved')
  await rename(f.options.outputRoot, moved)
  await symlink(moved, f.options.outputRoot, process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(f.vault.put(randomUUID(), Buffer.from('x')), /UNSAFE_DOCUMENT_DIRECTORY/)
})
test('stage fault preserves staging but creates no final file', async (t) => {
  const f = await fixture(t, {
      onDurableWrite: async (phase) => {
        if (phase === 'STAGED') throw new Error('injected interruption')
      },
    }),
    key = randomUUID(),
    bytes = Buffer.from('staged only')
  await assert.rejects(f.vault.put(key, bytes), /injected interruption/)
  assert.deepEqual(await readFile(join(f.options.stagingRoot, key)), bytes)
  await assert.rejects(lstat(join(f.options.outputRoot, key)), { code: 'ENOENT' })
})
test('final fault preserves the complete final file for uncertain publication reconciliation', async (t) => {
  const f = await fixture(t, {
      onDurableWrite: async (phase) => {
        if (phase === 'FINAL') throw new Error('injected interruption')
      },
    }),
    key = randomUUID(),
    bytes = Buffer.from('final only')
  await assert.rejects(f.vault.put(key, bytes), /injected interruption/)
  assert.deepEqual(await f.vault.read(key, documentDigest(bytes)), bytes)
})
