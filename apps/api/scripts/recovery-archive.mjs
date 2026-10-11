import { lstat, mkdir, readdir, realpath, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileDigest, verifyRecoveryBundle } from './recovery-bundle.mjs'
import { readRecoveryPrivateFile, copyRecoveryPrivateFile } from './recovery-private-file.mjs'
import {
  recoverySubdirectories,
  recoveryFileEntries,
  recoveryEntryMaximum,
} from './recovery-assets.mjs'

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const markerName = 'fake-recovery-archive.json'
const marker =
  JSON.stringify({ version: 1, kind: 'STUDENT_SERVICE_RECOVERY_ARCHIVE', fakeDataOnly: true }) +
  '\n'
const fail = (code) => {
  throw new Error(code)
}
const comparable = (path) => (process.platform === 'win32' ? path.toLowerCase() : path)
const contains = (parent, child) => {
  const part = relative(comparable(resolve(parent)), comparable(resolve(child)))
  return part === '' || (!isAbsolute(part) && part !== '..' && !part.startsWith('..' + sep))
}

async function safeDirectory(root) {
  if (!isAbsolute(root)) fail('ABSOLUTE_PATH_REQUIRED')
  const stat = await lstat(root)
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    comparable(await realpath(root)) !== comparable(resolve(root))
  )
    fail('UNSAFE_ARCHIVE_DIRECTORY')
}
async function location(archiveRoot, projectRoot) {
  if (!isAbsolute(archiveRoot) || !isAbsolute(projectRoot)) fail('ABSOLUTE_PATH_REQUIRED')
  await safeDirectory(projectRoot)
  if (contains(projectRoot, archiveRoot) || contains(archiveRoot, projectRoot))
    fail('ARCHIVE_MUST_BE_OUTSIDE_PROJECT')
  // Only one new directory may be created; the parent must already be real and safe.
  await safeDirectory(dirname(resolve(archiveRoot)))
}
async function ownedArchive(archiveRoot) {
  await safeDirectory(archiveRoot)
  const path = join(archiveRoot, markerName)
  await fileDigest(path, 1024)
  if ((await readRecoveryPrivateFile(path, 1024)).toString('utf8') !== marker)
    fail('UNRECOGNIZED_ARCHIVE')
}
function validDate(value) {
  return (
    typeof value === 'string' &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  )
}

// Preflight is read-only: a failed destination cannot start a rehearsal or create a directory.
export async function validateRecoveryArchiveDestination({ archiveRoot, projectRoot }) {
  await location(archiveRoot, projectRoot)
  try {
    await lstat(archiveRoot)
  } catch (error) {
    if (error.code === 'ENOENT') return { exists: false }
    throw error
  }
  await ownedArchive(archiveRoot)
  return { exists: true }
}

// Only exports a verified fake bundle produced in this project's recovery-drills directory.
// The archive is a dedicated directory, never a general-purpose folder or a deletion target.
export async function exportRecoveryBundle({ bundleRoot, archiveRoot, projectRoot }) {
  const state = await validateRecoveryArchiveDestination({ archiveRoot, projectRoot })
  const manifest = await verifyRecoveryBundle(bundleRoot)
  const expected = resolve(projectRoot, 'run/recovery-drills', manifest.runId, 'bundle')
  if (!isAbsolute(bundleRoot) || comparable(resolve(bundleRoot)) !== comparable(expected))
    fail('SOURCE_MUST_BE_PROJECT_DRILL_BUNDLE')
  if (!validDate(manifest.createdAt) || Date.parse(manifest.createdAt) > Date.now())
    fail('INVALID_BUNDLE_DATE')
  const originalManifestDigest = await fileDigest(join(bundleRoot, 'manifest.json'), 2097152)
  if (!state.exists) {
    await mkdir(archiveRoot)
    await safeDirectory(archiveRoot)
    await writeFile(join(archiveRoot, markerName), marker, { flag: 'wx' })
  }
  await ownedArchive(archiveRoot)
  const destination = join(archiveRoot, manifest.runId)
  await mkdir(destination) // Existing copies, including incomplete ones, are never overwritten.
  for (const directory of recoverySubdirectories(manifest))
    await mkdir(join(destination, directory))
  // Check every copied byte before publishing a manifest; failures leave an incomplete directory.
  for (const entry of recoveryFileEntries(manifest)) {
    const target = join(destination, entry.name)
    await copyRecoveryPrivateFile(
      join(bundleRoot, entry.name),
      target,
      entry.digest,
      recoveryEntryMaximum(entry.name),
    )
    const digest = await fileDigest(target, recoveryEntryMaximum(entry.name))
    if (digest.size !== entry.digest.size || digest.sha256 !== entry.digest.sha256)
      fail(entry.name === 'database.dump' ? 'ARCHIVED_DUMP_MISMATCH' : 'ARCHIVED_FILE_MISMATCH')
  }
  await verifyRecoveryBundle(bundleRoot)
  if (
    JSON.stringify(await fileDigest(join(bundleRoot, 'manifest.json'), 2097152)) !==
    JSON.stringify(originalManifestDigest)
  )
    fail('SOURCE_MANIFEST_CHANGED')
  await copyRecoveryPrivateFile(
    join(bundleRoot, 'manifest.json'),
    join(destination, 'manifest.json'),
    originalManifestDigest,
    2097152,
  )
  const copied = await verifyRecoveryBundle(destination)
  if (JSON.stringify(copied) !== JSON.stringify(manifest)) fail('ARCHIVED_MANIFEST_MISMATCH')
  return {
    version: 1,
    fakeDataOnly: true,
    status: 'VERIFIED',
    runId: manifest.runId,
    bundleRoot: destination,
  }
}

// Read-only proposal. No code in this module deletes or alters a saved bundle.
export async function inspectRecoveryArchive({
  archiveRoot,
  projectRoot,
  policy,
  now = new Date(),
}) {
  const { keepLatest, minAgeDays } = policy || {}
  if (
    !Number.isInteger(keepLatest) ||
    keepLatest < 1 ||
    keepLatest > 10000 ||
    !Number.isInteger(minAgeDays) ||
    minAgeDays < 1 ||
    minAgeDays > 36500 ||
    !(now instanceof Date) ||
    !Number.isFinite(now.getTime())
  )
    fail('INVALID_RETENTION_POLICY')
  await location(archiveRoot, projectRoot)
  await ownedArchive(archiveRoot)
  const names = (await readdir(archiveRoot)).filter((name) => name !== markerName).sort()
  if (names.length > 10000) fail('ARCHIVE_ENTRY_LIMIT_EXCEEDED')
  const entries = []
  for (const name of names) {
    // Avoid echoing unknown directory/file names in an operational report.
    if (!uuid.test(name)) {
      entries.push({ status: 'INVALID', code: 'UNEXPECTED_ARCHIVE_ENTRY' })
      continue
    }
    try {
      const manifest = await verifyRecoveryBundle(join(archiveRoot, name))
      if (manifest.runId !== name) fail('ARCHIVE_RUN_ID_MISMATCH')
      if (!validDate(manifest.createdAt) || Date.parse(manifest.createdAt) > now.getTime())
        fail('INVALID_BUNDLE_DATE')
      entries.push({
        runId: name,
        status: 'VERIFIED',
        createdAt: manifest.createdAt,
        dumpBytes: manifest.database.size,
        files: manifest.files.length,
        fileBytes: manifest.files.reduce((sum, file) => sum + file.size, 0),
        bundleVersion: manifest.version,
        ...(manifest.version === 2
          ? {
              templates: manifest.templates.length,
              documents: manifest.documents.length,
              ...(manifest.assetMetadataSource === 'DATABASE_REGISTRY'
                ? { staging: manifest.staging.length }
                : {}),
              assetMetadataSource: manifest.assetMetadataSource,
            }
          : {}),
      })
    } catch {
      entries.push({ runId: name, status: 'INVALID', code: 'BUNDLE_VERIFICATION_FAILED' })
    }
  }
  const invalid = entries.filter((entry) => entry.status === 'INVALID').length
  const verified = entries
    .filter((entry) => entry.status === 'VERIFIED')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.runId.localeCompare(b.runId))
  for (const [index, entry] of verified.entries()) {
    const oldEnough = now.getTime() - Date.parse(entry.createdAt) >= minAgeDays * 86400000
    entry.proposal = !invalid && index >= keepLatest && oldEnough ? 'CANDIDATE' : 'KEEP'
    entry.reason = invalid
      ? 'ARCHIVE_REQUIRES_ATTENTION'
      : index < keepLatest
        ? 'LATEST_PROTECTED'
        : !oldEnough
          ? 'MINIMUM_AGE_PROTECTED'
          : 'POLICY_EXCEEDED'
  }
  return {
    version: 1,
    fakeDataOnly: true,
    mode: 'READ_ONLY_RETENTION_PROPOSAL',
    status: invalid ? 'ATTENTION' : entries.length ? 'OK' : 'EMPTY',
    inspectedAt: now.toISOString(),
    policy: { keepLatest, minAgeDays },
    deletionPerformed: false,
    restoreTestedByThisInspection: false,
    verified: verified.length,
    invalid,
    candidates: verified.filter((entry) => entry.proposal === 'CANDIDATE').length,
    entries: [...verified, ...entries.filter((entry) => entry.status === 'INVALID')],
  }
}
