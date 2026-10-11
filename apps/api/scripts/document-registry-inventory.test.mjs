import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  unlink,
  writeFile,
  symlink,
} from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import {
  collectDocumentRegistryAssets,
  auditDocumentRegistry,
  registrySnapshotDigest,
} from './document-registry-inventory.mjs'
import {
  createRecoveryBundle,
  restoreRecoveryFiles,
  verifyRecoveryBundle,
  parseRehearsalOptions,
} from './recovery-bundle.mjs'
import { validateRecoveryAssets, recoverySubdirectories } from './recovery-assets.mjs'
import { exportRecoveryBundle } from './recovery-archive.mjs'
import {
  createRecoveryKey,
  encryptRecoveryBundle,
  decryptRecoveryBundle,
  verifyEncryptedRecoveryBundle,
} from './encrypted-recovery.mjs'
const digest = (bytes) => ({
  size: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
})
async function fixture(t) {
  const parent = resolve(tmpdir()),
    root = await mkdtemp(join(parent, 'student-registry-recovery-'))
  t.after(async () => {
    assert.equal(dirname(root), parent)
    assert.ok(root.startsWith(join(parent, 'student-registry-recovery-')))
    await rm(root, { recursive: true, force: true })
  })
  const roots = {
      templateRoot: join(root, 'templates'),
      documentRoot: join(root, 'documents'),
      stagingRoot: join(root, 'staging'),
    },
    projectRoot = join(root, 'project'),
    sourceRoot = join(root, 'files'),
    runId = randomUUID(),
    bundleRoot = join(projectRoot, 'run/recovery-drills', runId, 'bundle')
  for (const path of [...Object.values(roots), projectRoot, sourceRoot]) await mkdir(path)
  await mkdir(dirname(bundleRoot), { recursive: true })
  const templateBytes = Buffer.from('synthetic template bytes'),
    word = Buffer.from('synthetic Word bytes'),
    pdf = Buffer.from('synthetic PDF bytes')
  const binding = {
      id: 'submission-summary-v1',
      sha256: digest(templateBytes).sha256,
      bindingSource: 'SUBMITTED',
    },
    roundId = randomUUID(),
    submissionId = randomUUID(),
    setId = randomUUID(),
    createdAt = '2026-10-11T00:00:00.000Z'
  await writeFile(join(roots.templateRoot, binding.id + '.docx'), templateBytes)
  const renderer = {
    version: 'TEST-v1',
    buildSha256: 'a'.repeat(64),
    nodeVersion: '22.23.2',
    icuVersion: '78.2',
  }
  const documents = []
  const jobs = []
  for (const [format, bytes] of [
    ['DOCX', word],
    ['PDF', pdf],
  ]) {
    const key = randomUUID(),
      documentId = randomUUID()
    documents.push({
      documentId,
      setId,
      format,
      key,
      attemptId: key,
      ...digest(bytes),
      template: binding,
      renderer: { ...renderer },
      converter: format === 'PDF' ? { version: 'TEST-PDF', binarySha256: 'b'.repeat(64) } : null,
      sourceDocxSha256: format === 'PDF' ? digest(word).sha256 : null,
      status: 'UNSIGNED_DECLARATION',
      createdAt,
    })
    jobs.push({
      id: randomUUID(),
      setId,
      format,
      state: 'COMPLETE',
      attempts: 1,
      attemptId: key,
      leaseUntil: null,
      nextAttemptAt: createdAt,
      errorCode: null,
      publishedDocumentId: documentId,
      createdAt,
      updatedAt: createdAt,
    })
    await writeFile(join(roots.documentRoot, key), bytes)
    await writeFile(join(roots.stagingRoot, key), bytes)
  }
  const snapshot = {
    rounds: [{ id: roundId, submissionId, roundNumber: 1, template: binding }],
    sets: [{ id: setId, submissionId, roundId, kind: 'DECLARATION', template: binding, createdAt }],
    documents,
    jobs,
  }
  const sql = {
    unsafe: async (query) => {
      if (query.includes("to_regclass('public.submission_document_retries')"))
        return [
          {
            hasRetries: Object.hasOwn(snapshot, 'retries'),
            hasAllowance: Object.hasOwn(snapshot, 'retries'),
          },
        ]
      const table =
        /FROM (submission_rounds|submission_document_sets|submission_documents|submission_document_jobs|submission_document_retries) /.exec(
          query,
        )?.[1]
      assert.ok(table)
      return structuredClone(
        snapshot[
          {
            submission_rounds: 'rounds',
            submission_document_sets: 'sets',
            submission_documents: 'documents',
            submission_document_jobs: 'jobs',
            submission_document_retries: 'retries',
          }[table]
        ],
      )
    },
  }
  const options = { sql, ...roots },
    readSnapshot = () => collectDocumentRegistryAssets(options)
  const args = {
    bundleRoot,
    sourceRoot,
    runId,
    registryAssets: { ...roots, readSnapshot },
    assertQuiescent: async () => {},
    dump: (path) => writeFile(path, 'PGDMP synthetic test dump', { flag: 'wx' }),
  }
  const targets = {
    targetRoot: join(root, 'restored-files'),
    targetTemplateRoot: join(root, 'restored-templates'),
    targetDocumentRoot: join(root, 'restored-documents'),
    targetStagingRoot: join(root, 'restored-staging'),
  }
  return {
    root,
    roots,
    projectRoot,
    sourceRoot,
    bundleRoot,
    snapshot,
    sql,
    options,
    args,
    targets,
    word,
    pdf,
    readSnapshot,
  }
}
test('database-registry assets preserve complete provenance, SQL snapshot digest and reconciled stages', async (t) => {
  const f = await fixture(t),
    metadata = await f.readSnapshot()
  assert.equal(metadata.assetMetadataSource, 'DATABASE_REGISTRY')
  assert.equal(metadata.documents.length, 2)
  assert.equal(metadata.staging.length, 2)
  assert.equal(metadata.registrySnapshotSha256, registrySnapshotDigest(f.snapshot))
  assert.deepEqual(recoverySubdirectories(metadata), ['files', 'templates', 'documents', 'staging'])
  assert.deepEqual(validateRecoveryAssets(metadata), metadata)
  const report = await auditDocumentRegistry(f.options)
  assert.equal(report.status, 'OK')
  assert.equal(report.consistentBackup, false)
  assert.equal(report.signaturesChecked, false)
  assert.deepEqual(report.counts, { templates: 1, documents: 2, reconciledStages: 2 })
})
for (const [label, mutate] of [
  [
    'document source',
    (m) => {
      m.documents[1].sourceDocxSha256 = 'f'.repeat(64)
    },
  ],
  [
    'renderer digest',
    (m) => {
      m.documents[1].renderer.buildSha256 = 'f'.repeat(64)
    },
  ],
  [
    'document ID duplicate',
    (m) => {
      m.documents[1].documentId = m.documents[0].documentId
    },
  ],
  [
    'attempt mismatch',
    (m) => {
      m.documents[0].attemptId = randomUUID()
    },
  ],
  [
    'converter missing',
    (m) => {
      m.documents[1].converter = null
    },
  ],
  [
    'snapshot missing',
    (m) => {
      delete m.registrySnapshotSha256
    },
  ],
  [
    'stage duplicate',
    (m) => {
      m.staging.push(m.staging[0])
    },
  ],
  [
    'stage unknown',
    (m) => {
      m.staging[0].key = randomUUID()
    },
  ],
  [
    'stage hash',
    (m) => {
      m.staging[0].sha256 = 'f'.repeat(64)
    },
  ],
  [
    'stage document ID',
    (m) => {
      m.staging[0].documentId = randomUUID()
    },
  ],
  [
    'fixture downgrade',
    (m) => {
      m.assetMetadataSource = 'TECHNICAL_FIXTURE'
    },
  ],
  [
    'v1 downgrade',
    (m) => {
      m.version = 1
    },
  ],
])
  test('registry manifest refuses ' + label, async (t) => {
    const f = await fixture(t),
      m = await f.readSnapshot()
    mutate(m)
    assert.throws(() => validateRecoveryAssets(m), /INVALID_DOCUMENT_ASSETS/)
  })
for (const [label, mutate, code] of [
  [
    'set/round mismatch',
    (f) => {
      f.snapshot.sets[0].roundId = randomUUID()
    },
    'REGISTRY_ROUND_BINDING_MISMATCH',
  ],
  [
    'missing job',
    (f) => {
      f.snapshot.jobs.pop()
    },
    'REGISTRY_DOCUMENT_JOB_MISSING',
  ],
  [
    'wrong COMPLETE token',
    (f) => {
      f.snapshot.jobs[0].attemptId = randomUUID()
    },
    'REGISTRY_COMPLETE_JOB_MISMATCH',
  ],
  [
    'published document with RUNNING job',
    (f) => {
      f.snapshot.jobs[0].state = 'RUNNING'
    },
    'REGISTRY_PENDING_JOB_MISMATCH',
  ],
  [
    'missing final',
    async (f) => unlink(join(f.roots.documentRoot, f.snapshot.documents[0].key)),
    'REGISTRY_FINAL_INVENTORY_MISMATCH',
  ],
  [
    'corrupt final',
    async (f) =>
      writeFile(join(f.roots.documentRoot, f.snapshot.documents[0].key), Buffer.from('changed')),
    'REGISTRY_FINAL_INVENTORY_MISMATCH',
  ],
  [
    'orphan final',
    async (f) => writeFile(join(f.roots.documentRoot, randomUUID()), Buffer.from('orphan')),
    'REGISTRY_FINAL_INVENTORY_MISMATCH',
  ],
  [
    'orphan stage',
    async (f) => writeFile(join(f.roots.stagingRoot, randomUUID()), Buffer.from('staged orphan')),
    'UNRECONCILED_DOCUMENT_STAGE',
  ],
  [
    'corrupt stage',
    async (f) =>
      writeFile(join(f.roots.stagingRoot, f.snapshot.documents[0].key), Buffer.from('changed')),
    'UNRECONCILED_DOCUMENT_STAGE',
  ],
  [
    'missing template',
    async (f) => unlink(join(f.roots.templateRoot, 'submission-summary-v1.docx')),
    'REGISTRY_TEMPLATE_MISSING',
  ],
])
  test('inventory refuses ' + label + ' without repairing or deleting files', async (t) => {
    const f = await fixture(t)
    await mutate(f)
    const before = await readdir(f.roots.documentRoot)
    const report = await auditDocumentRegistry(f.options)
    assert.equal(report.status, 'ISSUES')
    assert.equal(report.code, code)
    assert.deepEqual(await readdir(f.roots.documentRoot), before)
    assert.ok(!JSON.stringify(report).includes(f.root))
  })
test('registry backup and plain archive restore database metadata, final bytes and staging together', async (t) => {
  const f = await fixture(t),
    manifest = await createRecoveryBundle(f.args)
  assert.equal(manifest.assetMetadataSource, 'DATABASE_REGISTRY')
  assert.deepEqual(await verifyRecoveryBundle(f.bundleRoot), manifest)
  const archived = await exportRecoveryBundle({
    bundleRoot: f.bundleRoot,
    archiveRoot: join(f.root, 'archive'),
    projectRoot: f.projectRoot,
  })
  await restoreRecoveryFiles({ bundleRoot: archived.bundleRoot, ...f.targets })
  for (const item of manifest.documents) {
    assert.deepEqual(
      await readFile(join(f.targets.targetDocumentRoot, item.key)),
      await readFile(join(f.roots.documentRoot, item.key)),
    )
    assert.deepEqual(
      await readFile(join(f.targets.targetStagingRoot, item.key)),
      await readFile(join(f.roots.stagingRoot, item.key)),
    )
  }
})
test('registry encrypted archive authenticates staging and restores it after complete preflight', async (t) => {
  const f = await fixture(t)
  await createRecoveryBundle(f.args)
  await mkdir(join(f.root, 'keys'))
  const keyPath = join(f.root, 'keys', 'key.json'),
    archiveRoot = join(f.root, 'encrypted')
  await createRecoveryKey({ keyPath, projectRoot: f.projectRoot, archiveRoot })
  const encrypted = await encryptRecoveryBundle({
    bundleRoot: f.bundleRoot,
    keyPath,
    archiveRoot,
    projectRoot: f.projectRoot,
  })
  const verified = await verifyEncryptedRecoveryBundle({
    packageRoot: encrypted.bundleRoot,
    keyPath,
    projectRoot: f.projectRoot,
  })
  assert.equal(verified.manifest.staging.length, 2)
  const bundleRoot = join(dirname(f.bundleRoot), 'decrypted-bundle')
  await decryptRecoveryBundle({
    packageRoot: encrypted.bundleRoot,
    targetRoot: bundleRoot,
    keyPath,
    projectRoot: f.projectRoot,
  })
  await restoreRecoveryFiles({ bundleRoot, ...f.targets })
  assert.equal((await readdir(f.targets.targetStagingRoot)).length, 2)
})
test('source registry mutation during dump prevents manifest publication', async (t) => {
  const f = await fixture(t)
  const dump = async (path) => {
    await f.args.dump(path)
    f.snapshot.documents[0].createdAt = '2026-10-12T00:00:00.000Z'
  }
  await assert.rejects(createRecoveryBundle({ ...f.args, dump }), /DOCUMENT_REGISTRY_CHANGED/)
  await assert.rejects(readFile(join(f.bundleRoot, 'manifest.json')), { code: 'ENOENT' })
})
test('registry restore checks staging destination before creating any destination', async (t) => {
  const f = await fixture(t)
  await createRecoveryBundle(f.args)
  await mkdir(f.targets.targetStagingRoot)
  await assert.rejects(
    restoreRecoveryFiles({ bundleRoot: f.bundleRoot, ...f.targets }),
    /RESTORE_TARGET_EXISTS/,
  )
  await assert.rejects(readdir(f.targets.targetRoot), { code: 'ENOENT' })
})
test('missing registry provider, conflicting fixture input, relative roots and junctions fail closed', async (t) => {
  const f = await fixture(t)
  await assert.rejects(
    createRecoveryBundle({ ...f.args, registryAssets: { ...f.roots } }),
    /REGISTRY_SNAPSHOT_REQUIRED/,
  )
  await assert.rejects(
    createRecoveryBundle({ ...f.args, documentAssets: {} }),
    /CONFLICTING_DOCUMENT_ASSETS/,
  )
  await assert.rejects(
    collectDocumentRegistryAssets({ ...f.options, documentRoot: 'relative' }),
    /INVALID_DOCUMENT_ASSETS/,
  )
  const link = join(f.root, 'linked-documents')
  await symlink(f.roots.documentRoot, link, process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(
    collectDocumentRegistryAssets({ ...f.options, documentRoot: link }),
    /UNSAFE_DIRECTORY/,
  )
})
test('registry rehearsal is explicit and cannot be confused with technical fixture mode', () => {
  assert.deepEqual(parseRehearsalOptions(['--fake-data-only', '--document-registry'], {}), {
    documentRegistry: true,
  })
  for (const args of [
    ['--fake-data-only', '--document-assets', '--document-registry'],
    ['--fake-data-only', '--document-registry', '--document-assets'],
    ['--fake-data-only', '--document-registry', '--document-registry'],
  ])
    assert.throws(() => parseRehearsalOptions(args, {}), /INVALID_REHEARSAL_OPTIONS/)
})

test('identical final/staging plaintext cannot be exchanged across authenticated encrypted namespaces', async (t) => {
  const f = await fixture(t)
  await createRecoveryBundle(f.args)
  await mkdir(join(f.root, 'keys'))
  const keyPath = join(f.root, 'keys', 'key.json'),
    archiveRoot = join(f.root, 'encrypted')
  await createRecoveryKey({ keyPath, projectRoot: f.projectRoot })
  const encrypted = await encryptRecoveryBundle({
    bundleRoot: f.bundleRoot,
    keyPath,
    archiveRoot,
    projectRoot: f.projectRoot,
  })
  const key = f.snapshot.documents[0].key
  await copyFile(
    join(encrypted.bundleRoot, 'documents', key + '.enc'),
    join(encrypted.bundleRoot, 'staging', key + '.enc'),
  )
  await assert.rejects(
    verifyEncryptedRecoveryBundle({
      packageRoot: encrypted.bundleRoot,
      keyPath,
      projectRoot: f.projectRoot,
    }),
    /CIPHERTEXT_DIGEST_MISMATCH|CIPHER_AUTHENTICATION_FAILED/,
  )
  const targetRoot = join(dirname(f.bundleRoot), 'decrypted-bundle')
  await assert.rejects(
    decryptRecoveryBundle({
      packageRoot: encrypted.bundleRoot,
      keyPath,
      projectRoot: f.projectRoot,
      targetRoot,
    }),
    /CIPHERTEXT_DIGEST_MISMATCH|CIPHER_AUTHENTICATION_FAILED/,
  )
  await assert.rejects(readdir(targetRoot), { code: 'ENOENT' })
})

test('registry snapshot hashing does not depend on JSON property order', async (t) => {
  const f = await fixture(t),
    other = structuredClone(f.snapshot)
  other.documents = other.documents.map((row) => Object.fromEntries(Object.entries(row).reverse()))
  other.documents[0].renderer = Object.fromEntries(
    Object.entries(other.documents[0].renderer).reverse(),
  )
  assert.equal(registrySnapshotDigest(other), registrySnapshotDigest(f.snapshot))
})
test('SQL inventory refuses its row bound instead of backing up a silently truncated registry', async (t) => {
  const f = await fixture(t),
    sql = {
      unsafe: async (query) =>
        query.includes('to_regclass')
          ? [{ hasRetries: false, hasAllowance: false }]
          : Array.from({ length: 5001 }, () => f.snapshot.rounds[0]),
    }
  await assert.rejects(
    collectDocumentRegistryAssets({ ...f.options, sql }),
    /DOCUMENT_REGISTRY_LIMIT_EXCEEDED/,
  )
})
for (const [label, args, extraEnv, expected] of [
  ['missing output roots', [], {}, 'DOCUMENT_AUDIT_NOT_CONFIGURED'],
  ['unexpected arguments', ['--repair'], {}, 'NO_ARGUMENTS_SUPPORTED'],
  ['production configuration', [], { APP_ENV: 'production' }, 'REQUIRES_KNOWN_LOCAL_DATABASE'],
])
  test(
    'read-only audit CLI rejects ' + label + ' without connecting or printing credentials',
    async (t) => {
      const f = await fixture(t),
        marker = 'PRIVATE_TEST_PASSWORD_DO_NOT_PRINT'
      const result = spawnSync(
        process.execPath,
        [fileURLToPath(new URL('./audit-documents.mjs', import.meta.url)), ...args],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            APP_ENV: 'test',
            DATABASE_URL: 'postgres://fake:' + marker + '@127.0.0.1:5434/student_service_test',
            SUBMISSION_STORAGE_ROOT: f.sourceRoot,
            SUBMISSION_DOCUMENT_ROOT: '',
            SUBMISSION_DOCUMENT_TEMPLATE_ROOT: '',
            SUBMISSION_DOCUMENT_STAGING_ROOT: '',
            ...extraEnv,
          },
        },
      )
      assert.equal(result.status, 1)
      assert.equal(result.stdout, '')
      assert.equal(JSON.parse(result.stderr).code, expected)
      assert.ok(!result.stderr.includes(marker))
      assert.ok(!result.stderr.includes(f.root))
    },
  )

test('retry-aware snapshot preserves history and cumulative attempts while old snapshots keep their digest shape', async (t) => {
  const f = await fixture(t),
    oldDigest = registrySnapshotDigest(f.snapshot)
  assert.equal((await f.readSnapshot()).registrySnapshotSha256, oldDigest)
  f.snapshot.retries = []
  for (const job of f.snapshot.jobs) job.retryAllowance = 0
  const job = f.snapshot.jobs[1]
  job.attempts = 4
  job.retryAllowance = 1
  f.snapshot.retries.push({
    id: randomUUID(),
    jobId: job.id,
    attemptId: randomUUID(),
    attempts: 3,
    allowance: 1,
    actorUserId: randomUUID(),
    reasonCode: 'CONVERTER_FIXED',
    createdAt: job.createdAt,
  })
  const metadata = await f.readSnapshot()
  assert.equal(metadata.registrySnapshotSha256, registrySnapshotDigest(f.snapshot))
  assert.notEqual(metadata.registrySnapshotSha256, oldDigest)
  f.snapshot.retries = []
  await assert.rejects(f.readSnapshot(), /REGISTRY_RETRY_HISTORY_MISSING/)
})
for (const [name, change] of [
  [
    'missing allowance',
    (f) => {
      delete f.snapshot.jobs[1].retryAllowance
    },
  ],
  [
    'allowance overflow',
    (f) => {
      f.snapshot.jobs[1].retryAllowance = 4
    },
  ],
  [
    'attempt overflow',
    (f) => {
      f.snapshot.jobs[1].attempts = 5
    },
  ],
  [
    'wrong retry attempts',
    (f) => {
      f.snapshot.retries[0].attempts = 4
    },
  ],
  [
    'current token reused',
    (f) => {
      f.snapshot.retries[0].attemptId = f.snapshot.jobs[1].attemptId
    },
  ],
  [
    'unknown reason',
    (f) => {
      f.snapshot.retries[0].reasonCode = 'IGNORE_FAILURE'
    },
  ],
  [
    'duplicate decision',
    (f) => {
      f.snapshot.retries.push({ ...f.snapshot.retries[0], id: randomUUID() })
    },
  ],
])
  test('registry inventory rejects retry ' + name, async (t) => {
    const f = await fixture(t)
    for (const job of f.snapshot.jobs) job.retryAllowance = 0
    const job = f.snapshot.jobs[1]
    job.attempts = 4
    job.retryAllowance = 1
    f.snapshot.retries = [
      {
        id: randomUUID(),
        jobId: job.id,
        attemptId: randomUUID(),
        attempts: 3,
        allowance: 1,
        actorUserId: randomUUID(),
        reasonCode: 'CONVERTER_FIXED',
        createdAt: job.createdAt,
      },
    ]
    change(f)
    await assert.rejects(f.readSnapshot(), /INVALID_REGISTRY_JOB|INVALID_REGISTRY_RETRY/)
  })
