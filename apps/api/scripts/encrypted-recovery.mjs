import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  randomUUID,
} from 'node:crypto'
import { constants, createReadStream, createWriteStream } from 'node:fs'
import { lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { Readable, Transform, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import {
  assertRecoveryDirectory,
  fileDigest,
  validateRecoveryManifest,
  verifyRecoveryBundle,
} from './recovery-bundle.mjs'

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const sha = /^[a-f0-9]{64}$/
const markerName = 'fake-encrypted-archive.json'
const marker =
  JSON.stringify({ version: 1, fakeDataOnly: true, kind: 'ENCRYPTED_RECOVERY_ARCHIVE' }) + '\n'
const manifestLimit = 4194304
const fail = (code) => {
  throw new Error(code)
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const comparable = (path) => (process.platform === 'win32' ? path.toLowerCase() : path)
const contains = (parent, child) => {
  const part = relative(comparable(resolve(parent)), comparable(resolve(child)))
  return part === '' || (!isAbsolute(part) && part !== '..' && !part.startsWith('..' + sep))
}
async function outsideProject(path, projectRoot) {
  if (!isAbsolute(path) || !isAbsolute(projectRoot)) fail('ABSOLUTE_PATH_REQUIRED')
  await assertRecoveryDirectory(projectRoot)
  if (contains(projectRoot, path) || contains(path, projectRoot))
    fail('SECRET_OR_ARCHIVE_MUST_BE_OUTSIDE_PROJECT')
  await assertRecoveryDirectory(dirname(resolve(path)))
}
async function readJson(path, maximum) {
  const before = await fileDigest(path, maximum)
  let data
  try {
    data = JSON.parse(await readFile(path, 'utf8'))
  } catch {
    fail('INVALID_ENCRYPTED_METADATA')
  }
  if (!same(before, await fileDigest(path, maximum))) fail('ENCRYPTED_METADATA_CHANGED')
  return data
}
export async function createRecoveryKey({ keyPath, projectRoot }) {
  await outsideProject(keyPath, projectRoot)
  const keyId = randomUUID(),
    key = randomBytes(32)
  try {
    await writeFile(
      keyPath,
      JSON.stringify({ version: 1, fakeDataOnly: true, keyId, keyHex: key.toString('hex') }) + '\n',
      { flag: 'wx', mode: 0o600 },
    )
    return { version: 1, fakeDataOnly: true, keyId, status: 'CREATED' }
  } finally {
    key.fill(0)
  }
}
async function readKey(keyPath, projectRoot) {
  await outsideProject(keyPath, projectRoot)
  const stat = await lstat(keyPath)
  if (process.platform !== 'win32' && stat.mode & 0o077) fail('KEY_PERMISSIONS_TOO_BROAD')
  const data = await readJson(keyPath, 1024)
  if (
    !data ||
    data.version !== 1 ||
    data.fakeDataOnly !== true ||
    !uuid.test(data.keyId || '') ||
    !sha.test(data.keyHex || '')
  )
    fail('INVALID_RECOVERY_KEY')
  return { keyId: data.keyId, key: Buffer.from(data.keyHex, 'hex') }
}
export async function validateEncryptedArchiveDestination({ archiveRoot, keyPath, projectRoot }) {
  await outsideProject(archiveRoot, projectRoot)
  await outsideProject(keyPath, projectRoot)
  if (contains(archiveRoot, dirname(keyPath)) || contains(dirname(keyPath), archiveRoot))
    fail('KEY_DIRECTORY_MUST_BE_SEPARATE')
  const loaded = await readKey(keyPath, projectRoot)
  loaded.key.fill(0)
  let exists = true
  try {
    await lstat(archiveRoot)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    exists = false
  }
  if (exists) {
    await assertRecoveryDirectory(archiveRoot)
    if ((await readFileChecked(join(archiveRoot, markerName), 1024)) !== marker)
      fail('UNRECOGNIZED_ENCRYPTED_ARCHIVE')
  }
  return { exists, keyId: loaded.keyId }
}
async function readFileChecked(path, maximum) {
  const before = await fileDigest(path, maximum)
  const bytes = await readFile(path)
  if (bytes.length !== before.size || !same(before, await fileDigest(path, maximum)))
    fail('ENCRYPTED_METADATA_CHANGED')
  return bytes.toString('utf8')
}
function headerOf(envelope) {
  const header = {
    version: envelope?.version,
    fakeDataOnly: envelope?.fakeDataOnly,
    algorithm: envelope?.algorithm,
    packageId: envelope?.packageId,
    runId: envelope?.runId,
    keyId: envelope?.keyId,
  }
  if (
    header.version !== 1 ||
    header.fakeDataOnly !== true ||
    header.algorithm !== 'AES-256-GCM' ||
    ![header.packageId, header.runId, header.keyId].every(
      (value) => typeof value === 'string' && uuid.test(value),
    )
  )
    fail('INVALID_ENCRYPTED_ENVELOPE')
  return header
}
const aad = (header, name) => Buffer.from(JSON.stringify({ ...header, entry: name }))
const derivedKey = (key, header) =>
  Buffer.from(
    hkdfSync(
      'sha256',
      key,
      Buffer.from(header.packageId),
      Buffer.from('student-service-fake-recovery-v1'),
      32,
    ),
  )
function descriptor(item, maximum) {
  if (
    !item ||
    !Number.isInteger(item.size) ||
    item.size <= 0 ||
    item.size > maximum ||
    typeof item.iv !== 'string' ||
    !/^[a-f0-9]{24}$/.test(item.iv) ||
    typeof item.tag !== 'string' ||
    !/^[a-f0-9]{32}$/.test(item.tag) ||
    typeof item.sha256 !== 'string' ||
    !sha.test(item.sha256)
  )
    fail('INVALID_CIPHER_DESCRIPTOR')
  return item
}
function cipherPath(root, name) {
  if (name === 'database.dump') return join(root, 'database.enc')
  if (name === 'manifest') return join(root, 'manifest.enc')
  if (!name.startsWith('files/') || !uuid.test(name.slice(6))) fail('INVALID_ENCRYPTED_ENTRY')
  return join(root, 'files', name.slice(6) + '.enc')
}
function boundedInput(path, size) {
  return createReadStream(path, {
    flags: constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0),
    end: size - 1,
  })
}
async function encrypt(input, path, key, header, name, usedIvs) {
  let iv
  do {
    iv = randomBytes(12)
  } while (usedIvs.has(iv.toString('hex')))
  usedIvs.add(iv.toString('hex'))
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 })
  cipher.setAAD(aad(header, name))
  await pipeline(input, cipher, createWriteStream(path, { flags: 'wx', mode: 0o600 }))
  const digest = await fileDigest(path, name === 'manifest' ? manifestLimit : 536870912)
  return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), ...digest }
}
async function decrypt(path, item, key, header, name, createSink) {
  const maximum =
    name === 'manifest' ? manifestLimit : name === 'database.dump' ? 536870912 : 5242880
  descriptor(item, maximum)
  const expected = { size: item.size, sha256: item.sha256 }
  if (!same(await fileDigest(path, maximum), expected)) fail('CIPHERTEXT_DIGEST_MISMATCH')
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(item.iv, 'hex'), {
    authTagLength: 16,
  })
  decipher.setAAD(aad(header, name))
  decipher.setAuthTag(Buffer.from(item.tag, 'hex'))
  const hash = createHash('sha256')
  let size = 0
  const monitor = new Transform({
    transform(chunk, _encoding, callback) {
      size += chunk.length
      if (size > item.size) return callback(new Error('DECRYPTED_SIZE_EXCEEDED'))
      hash.update(chunk)
      callback(null, chunk)
    },
  })
  try {
    await pipeline(boundedInput(path, item.size), decipher, monitor, createSink())
  } catch {
    fail('CIPHER_AUTHENTICATION_FAILED')
  }
  if (size !== item.size || !same(await fileDigest(path, maximum), expected))
    fail('CIPHERTEXT_CHANGED')
  return { size, sha256: hash.digest('hex') }
}
const discard = () =>
  new Writable({
    write(_chunk, _encoding, callback) {
      callback()
    },
  })
async function inspectPackage(packageRoot, keyPath, projectRoot, consume) {
  await assertRecoveryDirectory(packageRoot)
  if (contains(dirname(keyPath), packageRoot) || contains(packageRoot, dirname(keyPath)))
    fail('KEY_DIRECTORY_MUST_BE_SEPARATE')
  const loaded = await readKey(keyPath, projectRoot)
  let key
  try {
    const envelope = await readJson(join(packageRoot, 'envelope.json'), 4096)
    const header = headerOf(envelope)
    if (loaded.keyId !== header.keyId) fail('RECOVERY_KEY_ID_MISMATCH')
    key = derivedKey(loaded.key, header)
    const chunks = []
    await decrypt(
      cipherPath(packageRoot, 'manifest'),
      envelope.manifest,
      key,
      header,
      'manifest',
      () =>
        new Writable({
          write(chunk, _encoding, callback) {
            chunks.push(chunk)
            callback()
          },
        }),
    )
    let payload
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      fail('INVALID_ENCRYPTED_METADATA')
    }
    if (!payload || payload.version !== 1) fail('INVALID_ENCRYPTED_METADATA')
    const manifest = validateRecoveryManifest(payload.manifest)
    if (manifest.runId !== header.runId) fail('ENCRYPTED_RUN_ID_MISMATCH')
    if (
      typeof manifest.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(manifest.createdAt)) ||
      new Date(manifest.createdAt).toISOString() !== manifest.createdAt ||
      Date.parse(manifest.createdAt) > Date.now()
    )
      fail('INVALID_BUNDLE_DATE')
    const expected = [
      { name: 'database.dump', digest: manifest.database },
      ...manifest.files.map((file) => ({
        name: 'files/' + file.key,
        digest: { size: file.size, sha256: file.sha256 },
      })),
    ]
    if (!Array.isArray(payload.entries) || payload.entries.length !== expected.length)
      fail('INVALID_ENCRYPTED_ENTRIES')
    const entries = new Map(),
      ivs = new Set([envelope.manifest.iv])
    for (const entry of payload.entries) {
      if (!entry || typeof entry.name !== 'string' || entries.has(entry.name))
        fail('INVALID_ENCRYPTED_ENTRIES')
      descriptor(entry.cipher, entry.name === 'database.dump' ? 536870912 : 5242880)
      if (ivs.has(entry.cipher.iv)) fail('REUSED_ENCRYPTION_IV')
      ivs.add(entry.cipher.iv)
      entries.set(entry.name, entry.cipher)
    }
    if (
      !same((await readdir(packageRoot)).sort(), [
        'database.enc',
        'envelope.json',
        'files',
        'manifest.enc',
      ])
    )
      fail('INVALID_ENCRYPTED_LAYOUT')
    await assertRecoveryDirectory(join(packageRoot, 'files'))
    if (
      !same(
        (await readdir(join(packageRoot, 'files'))).sort(),
        manifest.files.map((file) => file.key + '.enc').sort(),
      )
    )
      fail('INVALID_ENCRYPTED_LAYOUT')
    for (const item of expected) {
      const encrypted = entries.get(item.name)
      if (!encrypted || encrypted.size !== item.digest.size) fail('INVALID_ENCRYPTED_ENTRIES')
      const digest = await decrypt(
        cipherPath(packageRoot, item.name),
        encrypted,
        key,
        header,
        item.name,
        consume ? () => consume(item.name) : discard,
      )
      if (!same(digest, item.digest)) fail('DECRYPTED_DIGEST_MISMATCH')
    }
    return { header, manifest }
  } finally {
    loaded.key.fill(0)
    key?.fill(0)
  }
}
export async function verifyEncryptedRecoveryBundle({ packageRoot, keyPath, projectRoot }) {
  return inspectPackage(packageRoot, keyPath, projectRoot)
}
export async function encryptRecoveryBundle({ bundleRoot, archiveRoot, keyPath, projectRoot }) {
  const state = await validateEncryptedArchiveDestination({ archiveRoot, keyPath, projectRoot })
  const manifest = await verifyRecoveryBundle(bundleRoot)
  if (
    comparable(resolve(bundleRoot)) !==
    comparable(resolve(projectRoot, 'run/recovery-drills', manifest.runId, 'bundle'))
  )
    fail('SOURCE_MUST_BE_PROJECT_DRILL_BUNDLE')
  const originalManifestDigest = await fileDigest(join(bundleRoot, 'manifest.json'), 2097152)
  const loaded = await readKey(keyPath, projectRoot)
  let key
  try {
    if (!state.exists) {
      await mkdir(archiveRoot)
      await assertRecoveryDirectory(archiveRoot)
      await writeFile(join(archiveRoot, markerName), marker, { flag: 'wx' })
    }
    // Recheck ownership before writing even if the folder existed during preflight.
    await assertRecoveryDirectory(archiveRoot)
    if ((await readFileChecked(join(archiveRoot, markerName), 1024)) !== marker)
      fail('UNRECOGNIZED_ENCRYPTED_ARCHIVE')
    const packageRoot = join(archiveRoot, manifest.runId)
    await mkdir(packageRoot)
    await mkdir(join(packageRoot, 'files'))
    const header = headerOf({
      version: 1,
      fakeDataOnly: true,
      algorithm: 'AES-256-GCM',
      packageId: randomUUID(),
      runId: manifest.runId,
      keyId: loaded.keyId,
    })
    key = derivedKey(loaded.key, header)
    const entries = [],
      usedIvs = new Set()
    const sources = [
      { name: 'database.dump', digest: manifest.database },
      ...manifest.files.map((file) => ({
        name: 'files/' + file.key,
        digest: { size: file.size, sha256: file.sha256 },
      })),
    ]
    for (const item of sources) {
      const path = join(bundleRoot, item.name)
      const cipher = await encrypt(
        boundedInput(path, item.digest.size),
        cipherPath(packageRoot, item.name),
        key,
        header,
        item.name,
        usedIvs,
      )
      if (cipher.size !== item.digest.size || !same(await fileDigest(path), item.digest))
        fail('SOURCE_CHANGED_DURING_ENCRYPTION')
      entries.push({ name: item.name, cipher })
    }
    await verifyRecoveryBundle(bundleRoot)
    if (!same(await fileDigest(join(bundleRoot, 'manifest.json'), 2097152), originalManifestDigest))
      fail('SOURCE_MANIFEST_CHANGED')
    const plaintext = Buffer.from(JSON.stringify({ version: 1, manifest, entries }))
    if (plaintext.length > manifestLimit) fail('ENCRYPTED_MANIFEST_TOO_LARGE')
    const encryptedManifest = await encrypt(
      Readable.from([plaintext]),
      cipherPath(packageRoot, 'manifest'),
      key,
      header,
      'manifest',
      usedIvs,
    )
    plaintext.fill(0)
    await writeFile(
      join(packageRoot, 'envelope.json'),
      JSON.stringify({ ...header, manifest: encryptedManifest }) + '\n',
      { flag: 'wx' },
    )
    await verifyEncryptedRecoveryBundle({ packageRoot, keyPath, projectRoot })
    return {
      version: 1,
      fakeDataOnly: true,
      status: 'VERIFIED',
      bundleRoot: packageRoot,
      runId: manifest.runId,
      keyId: loaded.keyId,
      encrypted: true,
    }
  } finally {
    loaded.key.fill(0)
    key?.fill(0)
  }
}
export async function decryptRecoveryBundle({ packageRoot, keyPath, targetRoot, projectRoot }) {
  // Authenticate every entry to a discard sink before creating any plaintext output.
  const verified = await verifyEncryptedRecoveryBundle({ packageRoot, keyPath, projectRoot })
  const expected = resolve(
    projectRoot,
    'run/recovery-drills',
    verified.manifest.runId,
    'decrypted-bundle',
  )
  if (!isAbsolute(targetRoot) || comparable(resolve(targetRoot)) !== comparable(expected))
    fail('DECRYPT_TARGET_MUST_BE_DRILL_DIRECTORY')
  await assertRecoveryDirectory(dirname(targetRoot))
  let created = false
  try {
    await mkdir(targetRoot, { mode: 0o700 })
    created = true
    await assertRecoveryDirectory(targetRoot)
    await mkdir(join(targetRoot, 'files'), { mode: 0o700 })
    const decoded = await inspectPackage(packageRoot, keyPath, projectRoot, (name) =>
      createWriteStream(join(targetRoot, name), { flags: 'wx', mode: 0o600 }),
    )
    if (!same(decoded, verified)) fail('ENCRYPTED_PACKAGE_CHANGED')
    await writeFile(join(targetRoot, 'manifest.json'), JSON.stringify(decoded.manifest) + '\n', {
      flag: 'wx',
      mode: 0o600,
    })
    await verifyRecoveryBundle(targetRoot)
    return decoded.manifest
  } catch (error) {
    if (created) {
      // This exact new directory belongs to this invocation and is bounded by the verified drill parent.
      if (isAbsolute(targetRoot) && comparable(resolve(targetRoot)) === comparable(expected))
        await rm(targetRoot, { recursive: true, force: true })
    }
    throw error
  }
}
