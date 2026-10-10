import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  randomUUID,
} from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  createRecoveryBundle,
  fileDigest,
  parseRehearsalOptions,
  verifyRecoveryBundle,
} from './recovery-bundle.mjs'
import {
  createRecoveryKey,
  encryptRecoveryBundle,
  decryptRecoveryBundle,
  verifyEncryptedRecoveryBundle,
  validateEncryptedArchiveDestination,
} from './encrypted-recovery.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'student-encrypted-recovery-'))
  t.after(async () => {
    assert.ok(isAbsolute(root) && root.startsWith(join(tmpdir(), 'student-encrypted-recovery-')))
    await rm(root, { recursive: true, force: true })
  })
  const projectRoot = join(root, 'project'),
    keyRoot = join(root, 'keys'),
    archiveRoot = join(root, 'encrypted')
  await mkdir(projectRoot)
  await mkdir(keyRoot)
  const keyPath = join(keyRoot, 'fake-key.json'),
    runId = randomUUID()
  const runRoot = join(projectRoot, 'run/recovery-drills', runId)
  await mkdir(runRoot, { recursive: true })
  const sourceRoot = join(runRoot, 'source-files'),
    bundleRoot = join(runRoot, 'bundle'),
    targetRoot = join(runRoot, 'decrypted-bundle')
  await mkdir(sourceRoot)
  const keys = [randomUUID(), randomUUID()]
  for (const key of keys)
    await writeFile(join(sourceRoot, key), Buffer.from('%PDF-1.4 original fake evidence ' + key))
  const manifest = await createRecoveryBundle({
    sourceRoot,
    bundleRoot,
    runId,
    assertQuiescent: async () => {},
    dump: (path) =>
      writeFile(path, Buffer.from('PGDMP fake database bytes\u0000\u00ff'), { flag: 'wx' }),
  })
  const keyInfo = await createRecoveryKey({ keyPath, projectRoot })
  const args = { bundleRoot, archiveRoot, keyPath, projectRoot }
  return {
    root,
    runId,
    runRoot,
    keys,
    manifest,
    keyInfo,
    targetRoot,
    ...args,
    encrypt: () => encryptRecoveryBundle(args),
    verify: (packageRoot) => verifyEncryptedRecoveryBundle({ packageRoot, keyPath, projectRoot }),
    decrypt: (packageRoot) =>
      decryptRecoveryBundle({ packageRoot, keyPath, projectRoot, targetRoot }),
  }
}
async function envelope(root) {
  return JSON.parse(await readFile(join(root, 'envelope.json'), 'utf8'))
}
async function rewritePayload(f, packageRoot, modify) {
  const outer = await envelope(packageRoot),
    rawKey = JSON.parse(await readFile(f.keyPath, 'utf8'))
  const header = {
    version: outer.version,
    fakeDataOnly: outer.fakeDataOnly,
    algorithm: outer.algorithm,
    packageId: outer.packageId,
    runId: outer.runId,
    keyId: outer.keyId,
  }
  const key = Buffer.from(
    hkdfSync(
      'sha256',
      Buffer.from(rawKey.keyHex, 'hex'),
      Buffer.from(header.packageId),
      Buffer.from('student-service-fake-recovery-v1'),
      32,
    ),
  )
  const aad = Buffer.from(JSON.stringify({ ...header, entry: 'manifest' }))
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(outer.manifest.iv, 'hex'), {
    authTagLength: 16,
  })
  decipher.setAAD(aad)
  decipher.setAuthTag(Buffer.from(outer.manifest.tag, 'hex'))
  const payload = JSON.parse(
    Buffer.concat([
      decipher.update(await readFile(join(packageRoot, 'manifest.enc'))),
      decipher.final(),
    ]).toString('utf8'),
  )
  await modify(payload)
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 })
  cipher.setAAD(aad)
  const bytes = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(payload))), cipher.final()])
  await writeFile(join(packageRoot, 'manifest.enc'), bytes)
  outer.manifest = {
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
  await writeFile(join(packageRoot, 'envelope.json'), JSON.stringify(outer))
  key.fill(0)
}
async function absent(path) {
  await assert.rejects(readFile(path), (error) => error.code === 'ENOENT')
}

test('encrypts all originals and authenticates/decrypts exact bytes with no plaintext manifest or dump in archive', async (t) => {
  const f = await fixture(t),
    original = await fileDigest(join(f.bundleRoot, 'manifest.json'))
  const result = await f.encrypt()
  assert.equal(result.encrypted, true)
  assert.equal(result.keyId, f.keyInfo.keyId)
  assert.deepEqual((await f.verify(result.bundleRoot)).manifest, f.manifest)
  assert.deepEqual(await readdir(result.bundleRoot), [
    'database.enc',
    'envelope.json',
    'files',
    'manifest.enc',
  ])
  const ciphertext = await readFile(join(result.bundleRoot, 'database.enc'))
  assert.ok(!ciphertext.includes(Buffer.from('PGDMP fake database bytes')))
  assert.ok(
    !(await readFile(join(result.bundleRoot, 'manifest.enc'))).includes(
      Buffer.from('CONTROLLED_SOURCE_STOPPED'),
    ),
  )
  await f.decrypt(result.bundleRoot)
  assert.deepEqual(await verifyRecoveryBundle(f.targetRoot), f.manifest)
  for (const path of ['database.dump', ...f.keys.map((key) => 'files/' + key)])
    assert.deepEqual(
      await readFile(join(f.targetRoot, path)),
      await readFile(join(f.bundleRoot, path)),
    )
  assert.deepEqual(await fileDigest(join(f.bundleRoot, 'manifest.json')), original)
  assert.equal((await envelope(result.bundleRoot)).manifest.tag.length, 32)
})

test('does not overwrite keys, existing packages, or existing decrypt targets', async (t) => {
  const f = await fixture(t),
    result = await f.encrypt(),
    before = await readFile(f.keyPath)
  await assert.rejects(createRecoveryKey(f), (error) => error.code === 'EEXIST')
  assert.deepEqual(await readFile(f.keyPath), before)
  await assert.rejects(f.encrypt(), (error) => error.code === 'EEXIST')
  await mkdir(f.targetRoot)
  await writeFile(join(f.targetRoot, 'keep'), 'preserve')
  await assert.rejects(f.decrypt(result.bundleRoot), (error) => error.code === 'EEXIST')
  assert.equal(await readFile(join(f.targetRoot, 'keep'), 'utf8'), 'preserve')
})

test('a different random key is rejected before any plaintext destination is created', async (t) => {
  const f = await fixture(t),
    result = await f.encrypt(),
    otherPath = join(f.root, 'keys', 'other-key.json')
  await createRecoveryKey({ keyPath: otherPath, projectRoot: f.projectRoot })
  await assert.rejects(
    decryptRecoveryBundle({ ...f, packageRoot: result.bundleRoot, keyPath: otherPath }),
    /RECOVERY_KEY_ID_MISMATCH/,
  )
  await absent(f.targetRoot)
})

test('matching key ID with wrong secret still fails authentication before output', async (t) => {
  const f = await fixture(t),
    result = await f.encrypt()
  const key = JSON.parse(await readFile(f.keyPath, 'utf8'))
  key.keyHex = randomBytes(32).toString('hex')
  await writeFile(f.keyPath, JSON.stringify(key), { mode: 0o600 })
  await assert.rejects(f.decrypt(result.bundleRoot), /CIPHER_AUTHENTICATION_FAILED/)
  await absent(f.targetRoot)
})

for (const type of [
  'missing-file',
  'changed-file',
  'truncated-dump',
  'changed-manifest',
  'short-tag',
  'changed-header',
  'extra-entry',
  'junction',
]) {
  test('rejects ' + type + ' before producing plaintext', async (t) => {
    const f = await fixture(t),
      result = await f.encrypt(),
      packageRoot = result.bundleRoot
    if (type === 'missing-file') await rm(join(packageRoot, 'files', f.keys[0] + '.enc'))
    if (type === 'changed-file') {
      const path = join(packageRoot, 'files', f.keys[0] + '.enc'),
        bytes = await readFile(path)
      bytes[0] ^= 1
      await writeFile(path, bytes)
    }
    if (type === 'truncated-dump') await writeFile(join(packageRoot, 'database.enc'), 'truncated')
    if (type === 'changed-manifest') {
      const path = join(packageRoot, 'manifest.enc'),
        bytes = await readFile(path)
      bytes[0] ^= 1
      await writeFile(path, bytes)
    }
    if (['short-tag', 'changed-header'].includes(type)) {
      const outer = await envelope(packageRoot)
      if (type === 'short-tag') outer.manifest.tag = 'a'.repeat(8)
      else outer.packageId = randomUUID()
      await writeFile(join(packageRoot, 'envelope.json'), JSON.stringify(outer))
    }
    if (type === 'extra-entry') await writeFile(join(packageRoot, 'unrelated'), 'leave untouched')
    if (type === 'junction') {
      await rm(join(packageRoot, 'files', f.keys[0] + '.enc'))
      await symlink(
        f.projectRoot,
        join(packageRoot, 'files', f.keys[0] + '.enc'),
        process.platform === 'win32' ? 'junction' : 'dir',
      )
    }
    await assert.rejects(f.decrypt(packageRoot))
    await absent(f.targetRoot)
  })
}

test('modified ciphertext with a recomputed hash is still rejected by AES-GCM authentication', async (t) => {
  const f = await fixture(t),
    result = await f.encrypt(),
    path = join(result.bundleRoot, 'database.enc')
  const bytes = await readFile(path)
  bytes[0] ^= 1
  await writeFile(path, bytes)
  await rewritePayload(f, result.bundleRoot, (payload) => {
    payload.entries.find((entry) => entry.name === 'database.dump').cipher.sha256 = createHash(
      'sha256',
    )
      .update(bytes)
      .digest('hex')
  })
  await assert.rejects(f.decrypt(result.bundleRoot), /CIPHER_AUTHENTICATION_FAILED/)
  await absent(f.targetRoot)
})

test('swapping encrypted file bytes is rejected', async (t) => {
  const f = await fixture(t),
    result = await f.encrypt()
  const a = join(result.bundleRoot, 'files', f.keys[0] + '.enc'),
    b = join(result.bundleRoot, 'files', f.keys[1] + '.enc')
  const bytes = await readFile(a)
  await writeFile(a, await readFile(b))
  await writeFile(b, bytes)
  await assert.rejects(f.decrypt(result.bundleRoot))
  await absent(f.targetRoot)
})

for (const type of ['traversal', 'duplicate-entry', 'reused-iv', 'non-fake', 'invalid-date']) {
  test('rejects authenticated but invalid inner manifest: ' + type, async (t) => {
    const f = await fixture(t),
      result = await f.encrypt()
    await rewritePayload(f, result.bundleRoot, (payload) => {
      if (type === 'traversal') payload.manifest.files[0].key = '../outside'
      if (type === 'duplicate-entry') payload.entries[1].name = payload.entries[0].name
      if (type === 'reused-iv') payload.entries[1].cipher.iv = payload.entries[0].cipher.iv
      if (type === 'non-fake') payload.manifest.fakeDataOnly = false
      if (type === 'invalid-date') payload.manifest.createdAt = 'invalid'
    })
    await assert.rejects(f.decrypt(result.bundleRoot))
    await absent(f.targetRoot)
  })
}

test('source corruption and an unrelated archive never produce a published encrypted package', async (t) => {
  const f = await fixture(t)
  await writeFile(join(f.bundleRoot, 'database.dump'), 'broken')
  await assert.rejects(f.encrypt())
  await absent(f.archiveRoot)
  await mkdir(f.archiveRoot)
  await writeFile(join(f.archiveRoot, 'keep'), 'preserve')
  await assert.rejects(validateEncryptedArchiveDestination(f))
  assert.equal(await readFile(join(f.archiveRoot, 'keep'), 'utf8'), 'preserve')
})

test('key and archive paths must be separated and outside project with real parent directories', async (t) => {
  const f = await fixture(t)
  await assert.rejects(
    createRecoveryKey({ ...f, keyPath: join(f.projectRoot, 'key.json') }),
    /SECRET_OR_ARCHIVE_MUST_BE_OUTSIDE_PROJECT/,
  )
  await assert.rejects(
    validateEncryptedArchiveDestination({ ...f, archiveRoot: join(f.projectRoot, 'encrypted') }),
    /SECRET_OR_ARCHIVE_MUST_BE_OUTSIDE_PROJECT/,
  )
  await assert.rejects(
    validateEncryptedArchiveDestination({ ...f, archiveRoot: join(f.root, 'keys', 'archive') }),
    /KEY_DIRECTORY_MUST_BE_SEPARATE/,
  )
  const linked = join(f.root, 'linked')
  await symlink(join(f.root, 'keys'), linked, process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(
    createRecoveryKey({ ...f, keyPath: join(linked, 'key.json') }),
    /UNSAFE_DIRECTORY/,
  )
})

test('decryption only writes into the matching fresh drill directory', async (t) => {
  const f = await fixture(t),
    result = await f.encrypt(),
    targetRoot = join(f.root, 'outside')
  await assert.rejects(
    decryptRecoveryBundle({ ...f, packageRoot: result.bundleRoot, targetRoot }),
    /DECRYPT_TARGET_MUST_BE_DRILL_DIRECTORY/,
  )
  await absent(targetRoot)
})

test('encryption options require explicit archive and do not accept duplicate or inherited property flags', () => {
  assert.throws(
    () => parseRehearsalOptions(['--fake-data-only', '--encryption-key', tmpdir()], {}),
    /ENCRYPTION_REQUIRES_EXPLICIT_ARCHIVE/,
  )
  assert.throws(
    () => parseRehearsalOptions(['--fake-data-only', 'toString', tmpdir()], {}),
    /INVALID_REHEARSAL_OPTIONS/,
  )
  assert.deepEqual(
    parseRehearsalOptions(
      ['--fake-data-only', '--encryption-key', tmpdir(), '--archive-root', tmpdir()],
      {},
    ),
    { encryptionKey: tmpdir(), archiveRoot: tmpdir() },
  )
})

const cli = fileURLToPath(new URL('./manage-encrypted-recovery.mjs', import.meta.url))
for (const [name, args, extra] of [
  ['missing flag', [], {}],
  ['unknown action', ['--fake-data-only', 'delete'], {}],
  [
    'inherited database',
    ['--fake-data-only', 'keygen', 'unused'],
    { DATABASE_URL: 'postgres://fake:secret@example.invalid/database' },
  ],
  ['production', ['--fake-data-only', 'keygen', 'unused'], { APP_ENV: 'production' }],
]) {
  test('encrypted CLI refuses ' + name + ' without exposing secrets', () => {
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

test('missing recovery key refuses decryption without creating plaintext output', async (t) => {
  const f = await fixture(t),
    result = await f.encrypt()
  await rm(f.keyPath)
  await assert.rejects(f.decrypt(result.bundleRoot))
  await absent(f.targetRoot)
})

test('malformed or non-fake key is rejected before creating an encrypted archive', async (t) => {
  const f = await fixture(t)
  for (const value of [
    'null',
    '{invalid',
    JSON.stringify({
      version: 1,
      fakeDataOnly: false,
      keyId: randomUUID(),
      keyHex: 'a'.repeat(64),
    }),
  ]) {
    await writeFile(f.keyPath, value, { mode: 0o600 })
    await assert.rejects(f.encrypt())
    await absent(f.archiveRoot)
  }
})

test('rehearsal with a missing encryption key fails before Docker and never falls back to plaintext', async (t) => {
  const f = await fixture(t)
  const env = { ...process.env }
  delete env.DATABASE_URL
  delete env.SUBMISSION_STORAGE_ROOT
  delete env.APP_ENV
  const runner = fileURLToPath(new URL('./rehearse-recovery.mjs', import.meta.url))
  const result = spawnSync(
    process.execPath,
    [
      runner,
      '--fake-data-only',
      '--archive-root',
      f.archiveRoot,
      '--encryption-key',
      join(f.root, 'keys', 'missing.json'),
    ],
    { env, encoding: 'utf8', timeout: 10000 },
  )
  assert.equal(result.error, undefined)
  assert.equal(result.status, 1)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr.trim(), 'ARCHIVE_DESTINATION_UNAVAILABLE')
  await absent(f.archiveRoot)
})

test('encrypted CLI refuses inherited application storage', () => {
  const env = { ...process.env, SUBMISSION_STORAGE_ROOT: tmpdir() }
  delete env.DATABASE_URL
  delete env.APP_ENV
  const result = spawnSync(process.execPath, [cli, '--fake-data-only', 'keygen', 'unused'], {
    env,
    encoding: 'utf8',
    timeout: 10000,
  })
  assert.equal(result.error, undefined)
  assert.equal(result.status, 1)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr.trim(), 'EXTERNAL_DATABASE_OR_STORAGE_CONFIG_REFUSED')
})
