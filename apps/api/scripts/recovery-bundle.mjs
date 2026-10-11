import { createHash } from 'node:crypto'
import { constants, createReadStream } from 'node:fs'
import { lstat, mkdir, readdir, realpath, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'

import { readRecoveryPrivateFile, copyRecoveryPrivateFile } from './recovery-private-file.mjs'
import {
  validateRecoveryAssets,
  recoverySubdirectories,
  recoveryFileEntries,
  recoveryEntryMaximum,
  assertDisjointRecoveryRoots,
} from './recovery-assets.mjs'

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const digestPattern = /^[a-f0-9]{64}$/
export const sourceDatabase = 'student_service_recovery_source'
export const targetDatabase = 'student_service_recovery_target'
const fail = (code) => {
  throw new Error(code)
}

export function assertDrillInvocation(args, env) {
  if (args.length !== 1 || args[0] !== '--fake-data-only') fail('REQUIRES_FAKE_DATA_ONLY_FLAG')
  if (env.DATABASE_URL || env.SUBMISSION_STORAGE_ROOT || env.APP_ENV === 'production')
    fail('EXTERNAL_DATABASE_OR_STORAGE_CONFIG_REFUSED')
}
export function parseRehearsalOptions(args, env) {
  assertDrillInvocation([args[0]], env)
  const options = {}
  for (let index = 1; index < args.length; index++) {
    if (args[index] === '--document-assets') {
      if (options.documentAssets) fail('INVALID_REHEARSAL_OPTIONS')
      options.documentAssets = true
      continue
    }
    const property =
      args[index] === '--archive-root'
        ? 'archiveRoot'
        : args[index] === '--encryption-key'
          ? 'encryptionKey'
          : undefined
    if (!property || Object.hasOwn(options, property) || index + 1 >= args.length)
      fail('INVALID_REHEARSAL_OPTIONS')
    const value = args[++index]
    if (typeof value !== 'string' || !isAbsolute(value)) fail('ABSOLUTE_PATH_REQUIRED')
    options[property] = resolve(value)
  }
  if (options.encryptionKey && !options.archiveRoot) fail('ENCRYPTION_REQUIRES_EXPLICIT_ARCHIVE')
  return options
}
export function assertOwnedContainer(info, runId, containerId) {
  if (
    !uuid.test(runId) ||
    !/^[a-f0-9]{64}$/.test(containerId) ||
    info.Id !== containerId ||
    info.Name !== '/student-service-recovery-' + runId ||
    info.Config?.Labels?.['student-service.recovery-id'] !== runId ||
    info.Config?.Image !== 'postgres:17-alpine'
  )
    fail('CONTAINER_OWNERSHIP_MISMATCH')
  if (info.Mounts?.some((mount) => mount.Type !== 'tmpfs')) fail('PERSISTENT_MOUNT_REFUSED')
}
export function assertDrillDatabase(databaseUrl, expected) {
  let url
  try {
    url = new URL(databaseUrl)
  } catch {
    fail('INVALID_DRILL_DATABASE')
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    ['5433', '5434'].includes(url.port) ||
    url.search ||
    url.hash ||
    ![sourceDatabase, targetDatabase].includes(expected) ||
    url.pathname !== '/' + expected
  )
    fail('INVALID_DRILL_DATABASE')
}
export async function assertEmptyTarget(sql) {
  const [row] = await sql.unsafe(`SELECT
    (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema') AS relations,
    (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema') AS functions,
    (SELECT count(*)::int FROM pg_extension WHERE extname <> 'plpgsql') AS extensions,
    (SELECT count(*)::int FROM pg_namespace WHERE nspname !~ '^pg_'
      AND nspname NOT IN ('information_schema','public')) AS schemas`)
  if (Object.values(row).some((value) => value !== 0)) fail('RESTORE_TARGET_NOT_EMPTY')
}
async function directory(root) {
  if (!isAbsolute(root)) fail('ABSOLUTE_PATH_REQUIRED')
  const before = await lstat(root)
  const actual = await realpath(root)
  const comparable = (path) => (process.platform === 'win32' ? path.toLowerCase() : path)
  if (
    !before.isDirectory() ||
    before.isSymbolicLink() ||
    comparable(actual) !== comparable(resolve(root))
  )
    fail('UNSAFE_DIRECTORY')
}
export async function fileDigest(path, maximum = 536870912) {
  const before = await lstat(path, { bigint: true })
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.size <= 0n ||
    before.size > BigInt(maximum)
  )
    fail('UNSAFE_OR_OVERSIZED_FILE')
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path, {
    flags: constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0),
    end: Number(before.size) - 1,
  }))
    hash.update(chunk)
  const after = await lstat(path, { bigint: true })
  if (
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeNs !== after.mtimeNs ||
    before.ctimeNs !== after.ctimeNs ||
    after.isSymbolicLink()
  )
    fail('FILE_CHANGED_DURING_COPY')
  return { size: Number(after.size), sha256: hash.digest('hex') }
}
async function inventory(root) {
  await directory(root)
  const entries = (await readdir(root)).sort()
  if (entries.length > 5000 || entries.some((key) => !uuid.test(key)))
    fail('INVALID_STORAGE_LAYOUT')
  const files = []
  for (const key of entries) files.push({ key, ...(await fileDigest(join(root, key), 5242880)) })
  return files
}
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b)

export async function verifyRecoveryAssetRoots({ templateRoot, documentRoot, manifest }) {
  validateRecoveryAssets(manifest)
  if (manifest.version !== 2) return
  assertDisjointRecoveryRoots([templateRoot, documentRoot])
  for (const [kind, root] of [
    ['templates', templateRoot],
    ['documents', documentRoot],
  ]) {
    await directory(root)
    const start = await lstat(root, { bigint: true })
    const items = manifest[kind]
    if (!equal((await readdir(root)).sort(), items.map((item) => item.key).sort()))
      fail('ASSET_LAYOUT_MISMATCH')
    for (const item of items) {
      if (
        !equal(
          await fileDigest(join(root, item.key), recoveryEntryMaximum(kind + '/' + item.key)),
          { size: item.size, sha256: item.sha256 },
        )
      )
        fail('ASSET_DIGEST_MISMATCH')
    }
    const end = await lstat(root, { bigint: true })
    if (
      start.dev !== end.dev ||
      start.ino !== end.ino ||
      start.mtimeNs !== end.mtimeNs ||
      start.ctimeNs !== end.ctimeNs ||
      !equal((await readdir(root)).sort(), items.map((item) => item.key).sort())
    )
      fail('ASSET_LAYOUT_CHANGED')
  }
}

// The orchestrator must stop its controlled fake API and freeze its database before calling this.
export async function createRecoveryBundle({
  bundleRoot,
  sourceRoot,
  runId,
  dump,
  assertQuiescent,
  documentAssets,
}) {
  if (!isAbsolute(bundleRoot) || !uuid.test(runId)) fail('INVALID_BUNDLE_CONFIGURATION')
  await assertQuiescent()
  const files = await inventory(sourceRoot)
  const assetMetadata = documentAssets
    ? {
        version: 2,
        assetMetadataSource: 'TECHNICAL_FIXTURE',
        templates: documentAssets.templates,
        documents: documentAssets.documents,
      }
    : { version: 1 }
  validateRecoveryAssets(assetMetadata)
  if (documentAssets) {
    assertDisjointRecoveryRoots([
      sourceRoot,
      bundleRoot,
      documentAssets.templateRoot,
      documentAssets.documentRoot,
    ])
    await verifyRecoveryAssetRoots({ ...documentAssets, manifest: assetMetadata })
  }
  await mkdir(bundleRoot) // Exclusive: an existing bundle is never replaced.
  await directory(bundleRoot)
  await mkdir(join(bundleRoot, 'files'))
  for (const file of files) {
    const destination = join(bundleRoot, 'files', file.key)
    await copyRecoveryPrivateFile(join(sourceRoot, file.key), destination, file, 5242880)
    if (!equal(await fileDigest(destination, 5242880), { size: file.size, sha256: file.sha256 }))
      fail('COPY_DIGEST_MISMATCH')
  }
  if (documentAssets) {
    for (const [kind, root] of [
      ['templates', documentAssets.templateRoot],
      ['documents', documentAssets.documentRoot],
    ]) {
      await mkdir(join(bundleRoot, kind))
      for (const item of assetMetadata[kind])
        await copyRecoveryPrivateFile(
          join(root, item.key),
          join(bundleRoot, kind, item.key),
          item,
          recoveryEntryMaximum(kind + '/' + item.key),
        )
    }
    await verifyRecoveryAssetRoots({
      templateRoot: join(bundleRoot, 'templates'),
      documentRoot: join(bundleRoot, 'documents'),
      manifest: assetMetadata,
    })
  }
  const dumpPath = join(bundleRoot, 'database.dump')
  await dump(dumpPath)
  const database = await fileDigest(dumpPath)
  if (!equal(files, await inventory(sourceRoot))) fail('SOURCE_STORAGE_CHANGED')
  if (documentAssets) await verifyRecoveryAssetRoots({ ...documentAssets, manifest: assetMetadata })
  await assertQuiescent()
  const manifest = {
    ...assetMetadata,
    fakeDataOnly: true,
    runId,
    sourceDatabase,
    createdAt: new Date().toISOString(),
    consistency: 'CONTROLLED_SOURCE_STOPPED',
    database,
    files,
  }
  // Publication marker is written last. A partial bundle cannot pass verification.
  const encoded = Buffer.from(JSON.stringify(manifest, null, 2) + '\n')
  if (encoded.length > 2097152) fail('MANIFEST_TOO_LARGE')
  await writeFile(join(bundleRoot, 'manifest.json'), encoded, {
    flag: 'wx',
  })
  await verifyRecoveryBundle(bundleRoot)
  return manifest
}
export async function verifyRecoveryBundle(bundleRoot) {
  await directory(bundleRoot)
  let manifest
  try {
    manifest = JSON.parse(
      (await readRecoveryPrivateFile(join(bundleRoot, 'manifest.json'), 2097152)).toString('utf8'),
    )
  } catch {
    fail('INVALID_MANIFEST')
  }
  validateRecoveryManifest(manifest)
  if (
    !equal(
      (await readdir(bundleRoot)).sort(),
      ['database.dump', 'manifest.json', ...recoverySubdirectories(manifest)].sort(),
    )
  )
    fail('INVALID_BUNDLE_LAYOUT')
  if (manifest.version === 2)
    await verifyRecoveryAssetRoots({
      templateRoot: join(bundleRoot, 'templates'),
      documentRoot: join(bundleRoot, 'documents'),
      manifest,
    })
  if (!equal(await fileDigest(join(bundleRoot, 'database.dump')), manifest.database))
    fail('DUMP_DIGEST_MISMATCH')
  if (
    !equal(
      await inventory(join(bundleRoot, 'files')),
      [...manifest.files].sort((a, b) => a.key.localeCompare(b.key)),
    )
  )
    fail('FILES_DIGEST_MISMATCH')
  return manifest
}
export async function restoreRecoveryFiles({
  bundleRoot,
  targetRoot,
  targetTemplateRoot,
  targetDocumentRoot,
}) {
  const manifest = await verifyRecoveryBundle(bundleRoot)
  const roots = {
    files: targetRoot,
    ...(manifest.version === 2
      ? {
          templates: targetTemplateRoot,
          documents: targetDocumentRoot,
        }
      : {}),
  }
  assertDisjointRecoveryRoots([bundleRoot, ...Object.values(roots)])
  // Check every destination before creating any, so an existing output cannot partially restore evidence.
  for (const root of Object.values(roots)) {
    await directory(dirname(root))
    try {
      await lstat(root)
      throw Object.assign(new Error('RESTORE_TARGET_EXISTS'), { code: 'EEXIST' })
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  for (const root of Object.values(roots)) {
    await mkdir(root, { mode: 0o700 })
    await directory(root)
  }
  for (const entry of recoveryFileEntries(manifest)) {
    if (entry.name === 'database.dump') continue
    const [kind, key] = entry.name.split('/')
    await copyRecoveryPrivateFile(
      join(bundleRoot, entry.name),
      join(roots[kind], key),
      entry.digest,
      recoveryEntryMaximum(entry.name),
    )
    if (
      !equal(
        await fileDigest(join(roots[kind], key), recoveryEntryMaximum(entry.name)),
        entry.digest,
      )
    )
      fail('RESTORED_FILES_DIGEST_MISMATCH')
  }
  if (
    !equal(
      await inventory(targetRoot),
      [...manifest.files].sort((a, b) => a.key.localeCompare(b.key)),
    )
  )
    fail('RESTORED_FILES_DIGEST_MISMATCH')
  if (manifest.version === 2)
    await verifyRecoveryAssetRoots({
      templateRoot: targetTemplateRoot,
      documentRoot: targetDocumentRoot,
      manifest,
    })
  return manifest
}

// PostgreSQL can deparse a varchar[] -> text[] literal cast differently after restore.
// Normalize only literal lists of this exact type; retain every literal and all other SQL.
export function normalizeRecoveryDefinition(definition) {
  return definition.replace(
    /\(ARRAY\[((?:'(?:[^']|'')*'::character varying)(?:, '(?:[^']|'')*'::character varying)*)\]\)::text\[\]/g,
    (_match, literals) =>
      'ARRAY[' +
      literals
        .match(/'(?:[^']|'')*'::character varying/g)
        .map((literal) => '(' + literal + ')::text')
        .join(', ') +
      ']',
  )
}

export { directory as assertRecoveryDirectory }

export function validateRecoveryManifest(manifest) {
  const validDigest = (item, maximum) =>
    item &&
    Number.isInteger(item.size) &&
    item.size > 0 &&
    item.size <= maximum &&
    typeof item.sha256 === 'string' &&
    digestPattern.test(item.sha256)
  if (
    !manifest ||
    ![1, 2].includes(manifest.version) ||
    manifest.fakeDataOnly !== true ||
    !uuid.test(manifest.runId || '') ||
    manifest.sourceDatabase !== sourceDatabase ||
    manifest.consistency !== 'CONTROLLED_SOURCE_STOPPED' ||
    !validDigest(manifest.database, 536870912) ||
    !Array.isArray(manifest.files) ||
    manifest.files.length > 5000 ||
    manifest.files.some(
      (file) => !file || !uuid.test(file.key || '') || !validDigest(file, 5242880),
    ) ||
    new Set(manifest.files.map((file) => file.key)).size !== manifest.files.length
  )
    fail('INVALID_MANIFEST')
  validateRecoveryAssets(manifest)
  return manifest
}
