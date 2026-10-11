import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import {
  createRecoveryBundle,
  verifyRecoveryBundle,
  restoreRecoveryFiles,
} from './recovery-bundle.mjs'
import {
  validateRecoveryAssets,
  recoveryFileEntries,
  recoveryEntryMaximum,
} from './recovery-assets.mjs'
import { exportRecoveryBundle, inspectRecoveryArchive } from './recovery-archive.mjs'
import {
  createRecoveryKey,
  encryptRecoveryBundle,
  verifyEncryptedRecoveryBundle,
  decryptRecoveryBundle,
  inspectEncryptedRecoveryArchive,
} from './encrypted-recovery.mjs'

const digest = (bytes) => ({
  size: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
})
async function fixture(t, wordOnly = false) {
  const root = await mkdtemp(join(tmpdir(), 'student-recovery-assets-'))
  t.after(async () => {
    assert.equal(dirname(root), resolve(tmpdir()))
    assert.ok(root.startsWith(join(tmpdir(), 'student-recovery-assets-')))
    await rm(root, { recursive: true, force: true })
  })
  const projectRoot = join(root, 'project'),
    runId = randomUUID()
  const runRoot = join(projectRoot, 'run/recovery-drills', runId)
  await mkdir(runRoot, { recursive: true })
  const sourceRoot = join(runRoot, 'source-files'),
    templateRoot = join(runRoot, 'source-templates'),
    documentRoot = join(runRoot, 'source-documents'),
    bundleRoot = join(runRoot, 'bundle')
  for (const path of [sourceRoot, templateRoot, documentRoot]) await mkdir(path)
  const id = 'submission-summary-v1',
    templateBytes = Buffer.from('fake template for byte-preservation tests')
  const templates = [{ id, key: id + '.docx', ...digest(templateBytes) }]
  await writeFile(join(templateRoot, templates[0].key), templateBytes)
  const word = Buffer.from('fake Word bytes; no document-format claim'),
    pdf = Buffer.from('fake PDF bytes derived for contract test')
  const common = {
    setId: randomUUID(),
    roundId: randomUUID(),
    submissionId: randomUUID(),
    roundNumber: 1,
    template: { id, sha256: templates[0].sha256, bindingSource: 'SUBMITTED' },
    rendererVersion: 'test-renderer-v1',
    kind: 'DECLARATION',
    status: 'UNSIGNED_DECLARATION',
  }
  const documents = [
    {
      ...common,
      key: randomUUID(),
      format: 'DOCX',
      ...digest(word),
      converterVersion: null,
      sourceDocxSha256: null,
    },
  ]
  await writeFile(join(documentRoot, documents[0].key), word)
  if (!wordOnly) {
    documents.push({
      ...common,
      key: randomUUID(),
      format: 'PDF',
      ...digest(pdf),
      converterVersion: 'test-only',
      sourceDocxSha256: digest(word).sha256,
    })
    await writeFile(join(documentRoot, documents[1].key), pdf)
  }
  const documentAssets = { templateRoot, documentRoot, templates, documents }
  const args = {
    sourceRoot,
    bundleRoot,
    runId,
    documentAssets,
    assertQuiescent: async () => {},
    dump: (path) => writeFile(path, 'PGDMP fake test bytes', { flag: 'wx' }),
  }
  const targets = {
    targetRoot: join(runRoot, 'restored-files'),
    targetTemplateRoot: join(runRoot, 'restored-templates'),
    targetDocumentRoot: join(runRoot, 'restored-documents'),
  }
  return {
    root,
    projectRoot,
    runRoot,
    runId,
    sourceRoot,
    templateRoot,
    documentRoot,
    bundleRoot,
    documentAssets,
    args,
    targets,
    metadata: { version: 2, assetMetadataSource: 'TECHNICAL_FIXTURE', templates, documents },
  }
}

for (const wordOnly of [false, true])
  test(
    'v2 preserves templates and ' +
      (wordOnly ? 'Word while PDF is pending' : 'both exact document bytes'),
    async (t) => {
      const f = await fixture(t, wordOnly)
      const manifest = await createRecoveryBundle(f.args)
      assert.equal(manifest.version, 2)
      assert.equal(manifest.assetMetadataSource, 'TECHNICAL_FIXTURE')
      assert.deepEqual(await verifyRecoveryBundle(f.bundleRoot), manifest)
      await restoreRecoveryFiles({ bundleRoot: f.bundleRoot, ...f.targets })
      for (const item of manifest.documents)
        assert.deepEqual(
          await readFile(join(f.targets.targetDocumentRoot, item.key)),
          await readFile(join(f.documentRoot, item.key)),
        )
      assert.deepEqual(
        await readFile(join(f.targets.targetTemplateRoot, manifest.templates[0].key)),
        await readFile(join(f.templateRoot, manifest.templates[0].key)),
      )
      assert.deepEqual(await readdir(f.targets.targetRoot), [])
    },
  )

for (const [label, change] of [
  [
    'duplicate key',
    (m) => {
      m.documents[1].key = m.documents[0].key
    },
  ],
  [
    'duplicate format',
    (m) => {
      m.documents.push(structuredClone(m.documents[0]))
      m.documents[2].key = randomUUID()
    },
  ],
  [
    'wrong source Word',
    (m) => {
      m.documents[1].sourceDocxSha256 = '0'.repeat(64)
    },
  ],
  [
    'PDF without Word',
    (m) => {
      m.documents.shift()
    },
  ],
  [
    'unknown template',
    (m) => {
      m.documents[0].template.id = 'submission-summary-v99'
    },
  ],
  [
    'template mismatch',
    (m) => {
      m.templates[0].sha256 = '0'.repeat(64)
    },
  ],
  [
    'template traversal',
    (m) => {
      m.templates[0].key = '../template.docx'
    },
  ],
  [
    'document traversal',
    (m) => {
      m.documents[0].key = '../outside'
    },
  ],
  [
    'oversize document',
    (m) => {
      m.documents[0].size = 16777217
    },
  ],
  [
    'oversize template',
    (m) => {
      m.templates[0].size = 1048577
    },
  ],
  [
    'empty document',
    (m) => {
      m.documents[0].size = 0
    },
  ],
  [
    'signature claim',
    (m) => {
      m.documents[0].status = 'SIGNED'
    },
  ],
  [
    'issued claim',
    (m) => {
      m.documents[0].kind = 'ISSUED_RESULT'
    },
  ],
  [
    'missing converter provenance',
    (m) => {
      m.documents[1].converterVersion = null
    },
  ],
  [
    'Word with converter provenance',
    (m) => {
      m.documents[0].converterVersion = 'pretend'
    },
  ],
  [
    'mixed round',
    (m) => {
      m.documents[1].roundId = randomUUID()
    },
  ],
  [
    'mixed renderer',
    (m) => {
      m.documents[1].rendererVersion = 'v2'
    },
  ],
  [
    'duplicate set for round',
    (m) => {
      const d = structuredClone(m.documents[0])
      d.key = randomUUID()
      d.setId = randomUUID()
      m.documents.push(d)
    },
  ],
  [
    'pretend DB registry verification',
    (m) => {
      m.assetMetadataSource = 'DATABASE_REGISTRY_VERIFIED'
    },
  ],
  [
    'v1 silently omits assets',
    (m) => {
      m.version = 1
    },
  ],
  [
    'unknown metadata',
    (m) => {
      m.documents[0].answers = { private: 'must not be in manifest' }
    },
  ],
])
  test('v2 metadata refuses ' + label, async (t) => {
    const f = await fixture(t),
      metadata = structuredClone(f.metadata)
    change(metadata)
    assert.throws(() => validateRecoveryAssets(metadata), /INVALID_DOCUMENT_ASSETS/)
  })

test('metadata does not depend on JSON property order', async (t) => {
  const f = await fixture(t)
  const d = f.metadata.documents[1]
  d.template = {
    sha256: d.template.sha256,
    bindingSource: d.template.bindingSource,
    id: d.template.id,
  }
  assert.doesNotThrow(() => validateRecoveryAssets(f.metadata))
})

for (const label of [
  'missing template',
  'changed document',
  'extra document',
  'missing destination',
  'existing document target',
])
  test('refuses ' + label + ' before creating any restore roots', async (t) => {
    const f = await fixture(t)
    await createRecoveryBundle(f.args)
    if (label === 'missing template')
      await rm(join(f.bundleRoot, 'templates', f.metadata.templates[0].key))
    if (label === 'changed document')
      await writeFile(join(f.bundleRoot, 'documents', f.metadata.documents[0].key), 'corrupt')
    if (label === 'extra document')
      await writeFile(join(f.bundleRoot, 'documents', randomUUID()), 'orphan')
    if (label === 'existing document target') await mkdir(f.targets.targetDocumentRoot)
    const targets = { ...f.targets }
    if (label === 'missing destination') delete targets.targetTemplateRoot
    await assert.rejects(restoreRecoveryFiles({ bundleRoot: f.bundleRoot, ...targets }))
    assert.ok(!(await readdir(f.runRoot)).includes('restored-files'))
  })

for (const label of [
  'output changes during dump',
  'orphan source',
  'source root overlap',
  'junction in templates',
])
  test('backup refuses ' + label + ' without completion marker', async (t) => {
    const f = await fixture(t)
    if (label === 'output changes during dump')
      f.args.dump = async (path) => {
        await writeFile(path, 'PGDMP fake test bytes', { flag: 'wx' })
        await writeFile(join(f.documentRoot, f.metadata.documents[0].key), 'changed')
      }
    if (label === 'orphan source') await writeFile(join(f.documentRoot, randomUUID()), 'orphan')
    if (label === 'source root overlap') f.args.documentAssets.documentRoot = f.sourceRoot
    if (label === 'junction in templates') {
      const other = join(f.runRoot, 'other')
      await mkdir(other)
      await rm(join(f.templateRoot, f.metadata.templates[0].key))
      await symlink(
        other,
        join(f.templateRoot, f.metadata.templates[0].key),
        process.platform === 'win32' ? 'junction' : 'dir',
      )
    }
    await assert.rejects(createRecoveryBundle(f.args))
    await assert.rejects(
      readFile(join(f.bundleRoot, 'manifest.json')),
      (error) => error.code === 'ENOENT',
    )
  })

test('v2 plain and encrypted archives preserve every namespace and restore independently', async (t) => {
  const f = await fixture(t)
  const manifest = await createRecoveryBundle(f.args)
  const plain = await exportRecoveryBundle({
    bundleRoot: f.bundleRoot,
    archiveRoot: join(f.root, 'plain'),
    projectRoot: f.projectRoot,
  })
  assert.deepEqual(await verifyRecoveryBundle(plain.bundleRoot), manifest)
  await mkdir(join(f.root, 'keys'))
  const keyPath = join(f.root, 'keys', 'fake-key.json')
  await createRecoveryKey({ keyPath, projectRoot: f.projectRoot })
  const encrypted = await encryptRecoveryBundle({
    bundleRoot: f.bundleRoot,
    archiveRoot: join(f.root, 'encrypted'),
    keyPath,
    projectRoot: f.projectRoot,
  })
  const verifyArgs = { packageRoot: encrypted.bundleRoot, keyPath, projectRoot: f.projectRoot }
  assert.deepEqual((await verifyEncryptedRecoveryBundle(verifyArgs)).manifest, manifest)
  const inspection = {
    projectRoot: f.projectRoot,
    policy: { keepLatest: 2, minAgeDays: 30 },
    now: new Date(Date.now() + 1000),
  }
  for (const report of [
    await inspectRecoveryArchive({ ...inspection, archiveRoot: join(f.root, 'plain') }),
    await inspectEncryptedRecoveryArchive({
      ...inspection,
      archiveRoot: join(f.root, 'encrypted'),
      keyPath,
    }),
  ]) {
    assert.equal(report.entries[0].documents, 2)
    assert.equal(report.entries[0].templates, 1)
    assert.equal(report.entries[0].assetMetadataSource, 'TECHNICAL_FIXTURE')
  }
  const targetRoot = join(f.runRoot, 'decrypted-bundle')
  await decryptRecoveryBundle({ ...verifyArgs, targetRoot })
  assert.deepEqual(await verifyRecoveryBundle(targetRoot), manifest)
  for (const item of recoveryFileEntries(manifest))
    assert.deepEqual(
      await readFile(join(targetRoot, item.name)),
      await readFile(join(f.bundleRoot, item.name)),
    )
  const victim = join(encrypted.bundleRoot, 'documents', manifest.documents[0].key + '.enc')
  const bytes = await readFile(victim)
  bytes[0] ^= 1
  await writeFile(victim, bytes)
  await assert.rejects(verifyEncryptedRecoveryBundle(verifyArgs))
  assert.deepEqual(await verifyRecoveryBundle(plain.bundleRoot), manifest)
})

test('namespace bounds never accept user paths or unknown entry types', () => {
  for (const name of [
    '../database.dump',
    'templates/../x.docx',
    'documents/../x',
    'files/x',
    'templates/submission-summary-v0.docx',
    'documents/' + randomUUID() + '.pdf',
    '__proto__',
  ])
    assert.throws(() => recoveryEntryMaximum(name), /INVALID_DOCUMENT_ASSETS/)
  assert.equal(recoveryEntryMaximum('documents/' + randomUUID()), 16777216)
  assert.equal(recoveryEntryMaximum('templates/submission-summary-v123.docx'), 1048576)
})

test('16 MiB output is preserved; oversized physical output is refused before backup publication', async (t) => {
  const f = await fixture(t, true),
    item = f.documentAssets.documents[0],
    bytes = Buffer.alloc(16777216, 65)
  await writeFile(join(f.documentRoot, item.key), bytes)
  Object.assign(item, digest(bytes))
  const manifest = await createRecoveryBundle(f.args)
  assert.equal(manifest.documents[0].size, 16777216)
  await restoreRecoveryFiles({ bundleRoot: f.bundleRoot, ...f.targets })
  assert.deepEqual(await readFile(join(f.targets.targetDocumentRoot, item.key)), bytes)
  await writeFile(join(f.documentRoot, item.key), Buffer.alloc(16777217, 65))
  const second = join(f.runRoot, 'oversize-backup')
  await assert.rejects(
    createRecoveryBundle({ ...f.args, bundleRoot: second }),
    /UNSAFE_OR_OVERSIZED_FILE/,
  )
  assert.ok(!(await readdir(f.runRoot)).includes('oversize-backup'))
})

test('document rehearsal flag is explicit, composable and cannot be repeated', async () => {
  const { parseRehearsalOptions } = await import('./recovery-bundle.mjs')
  assert.deepEqual(parseRehearsalOptions(['--fake-data-only', '--document-assets'], {}), {
    documentAssets: true,
  })
  assert.deepEqual(
    parseRehearsalOptions(
      ['--fake-data-only', '--document-assets', '--archive-root', tmpdir()],
      {},
    ),
    { documentAssets: true, archiveRoot: resolve(tmpdir()) },
  )
  assert.throws(
    () => parseRehearsalOptions(['--fake-data-only', '--document-assets', '--document-assets'], {}),
    /INVALID_REHEARSAL_OPTIONS/,
  )
})

test('bounded metadata reader preserves exact bytes and refuses oversize/empty/junction before allocating', async (t) => {
  const { readRecoveryPrivateFile } = await import('./recovery-private-file.mjs')
  const f = await fixture(t),
    path = join(f.runRoot, 'metadata.json')
  await writeFile(path, Buffer.alloc(1024, 65))
  assert.deepEqual(await readRecoveryPrivateFile(path, 1024), Buffer.alloc(1024, 65))
  await writeFile(path, Buffer.alloc(1025, 65))
  await assert.rejects(readRecoveryPrivateFile(path, 1024), /UNSAFE_OR_OVERSIZED_FILE/)
  await writeFile(path, '')
  await assert.rejects(readRecoveryPrivateFile(path, 1024), /UNSAFE_OR_OVERSIZED_FILE/)
  await assert.rejects(readRecoveryPrivateFile(path, 4194305), /INVALID_METADATA_READ_LIMIT/)
  const link = join(f.runRoot, 'linked-metadata')
  await symlink(f.templateRoot, link, process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(readRecoveryPrivateFile(link, 1024), /UNSAFE_OR_OVERSIZED_FILE/)
})

test('bounded copy writes exact bytes, refuses an existing destination and retains incomplete output on a hash fault', async (t) => {
  const { copyRecoveryPrivateFile } = await import('./recovery-private-file.mjs')
  const f = await fixture(t),
    source = join(f.runRoot, 'copy-source'),
    destination = join(f.runRoot, 'copy-target')
  const bytes = Buffer.alloc(131073, 65)
  await writeFile(source, bytes)
  await copyRecoveryPrivateFile(source, destination, digest(bytes), bytes.length)
  assert.deepEqual(await readFile(destination), bytes)
  await assert.rejects(
    copyRecoveryPrivateFile(source, destination, digest(bytes), bytes.length),
    (error) => error.code === 'EEXIST',
  )
  assert.deepEqual(await readFile(destination), bytes)
  const incomplete = join(f.runRoot, 'copy-incomplete')
  await assert.rejects(
    copyRecoveryPrivateFile(
      source,
      incomplete,
      { size: bytes.length, sha256: '0'.repeat(64) },
      bytes.length,
    ),
    /COPY_SOURCE_CHANGED/,
  )
  assert.equal((await readFile(incomplete)).length, bytes.length)
  const overflow = join(f.runRoot, 'copy-overflow')
  await writeFile(source, Buffer.alloc(bytes.length + 1, 65))
  await assert.rejects(
    copyRecoveryPrivateFile(source, overflow, digest(bytes), bytes.length),
    /UNSAFE_OR_CHANGED_COPY_SOURCE/,
  )
  await assert.rejects(readFile(overflow), (error) => error.code === 'ENOENT')
})

for (const [label, schema, counts, expected] of [
  ['old schema', { sets: false, documents: false, jobs: false }, null, 'ABSENT'],
  [
    'empty registry',
    { sets: true, documents: true, jobs: true },
    { sets: 0, documents: 0, jobs: 0 },
    'EMPTY',
  ],
  [
    'published output',
    { sets: true, documents: true, jobs: true },
    { sets: 1, documents: 1, jobs: 1 },
    'DOCUMENT_REGISTRY_RECOVERY_REQUIRED',
  ],
  [
    'pending job',
    { sets: true, documents: true, jobs: true },
    { sets: 1, documents: 0, jobs: 1 },
    'DOCUMENT_REGISTRY_RECOVERY_REQUIRED',
  ],
  [
    'partial schema',
    { sets: true, documents: false, jobs: false },
    null,
    'DOCUMENT_REGISTRY_SCHEMA_INCOMPLETE',
  ],
])
  test('fixture recovery preflight handles ' + label, async () => {
    const { assertNoDocumentRegistryRows } = await import('./recovery-assets.mjs')
    let calls = 0
    const sql = { unsafe: async () => [calls++ === 0 ? schema : counts] }
    if (expected === 'EMPTY' || expected === 'ABSENT')
      assert.equal(await assertNoDocumentRegistryRows(sql), expected)
    else await assert.rejects(assertNoDocumentRegistryRows(sql), new RegExp(expected))
  })
