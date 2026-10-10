import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, opendir, realpath } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const hash = /^[a-f0-9]{64}$/
const fingerprint = (value) => createHash('sha256').update(String(value)).digest('hex')
const sameFile = (a, b) =>
  a.dev === b.dev &&
  a.ino === b.ino &&
  a.size === b.size &&
  a.mtimeNs === b.mtimeNs &&
  a.ctimeNs === b.ctimeNs

// Only these local databases are supported by this initial operational tool.
export function auditConfiguration(env) {
  let url
  try {
    url = new URL(env.DATABASE_URL)
  } catch {
    throw new Error('INVALID_DATABASE_CONFIG')
  }
  const expected =
    env.APP_ENV === 'development'
      ? ['5433', '/student_service']
      : env.APP_ENV === 'test'
        ? ['5434', '/student_service_test']
        : null
  if (
    !expected ||
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.port !== expected[0] ||
    url.pathname !== expected[1] ||
    url.search ||
    url.hash
  )
    throw new Error('REQUIRES_KNOWN_LOCAL_DATABASE')
  if (!env.SUBMISSION_STORAGE_ROOT || !isAbsolute(env.SUBMISSION_STORAGE_ROOT))
    throw new Error('REQUIRES_ABSOLUTE_STORAGE_ROOT')
  return { databaseUrl: env.DATABASE_URL, root: resolve(env.SUBMISSION_STORAGE_ROOT) }
}

// pg_temp is used only by the SQL contract test; the CLI always uses public.
export async function* readEvidenceReferences(tx, schema = 'public') {
  if (!['public', 'pg_temp'].includes(schema)) throw new Error('INVALID_SCHEMA')
  for await (const rows of tx
    .unsafe(
      `
    SELECT id AS "fileId", submission_id AS "submissionId", storage_key AS key,
      size, sha256, removed_at IS NOT NULL AS removed
    FROM ${schema}.submission_files ORDER BY id
  `,
    )
    .cursor(256)) {
    for (const row of rows) yield { kind: 'CURRENT', ...row }
  }
  for await (const rows of tx
    .unsafe(
      `
    SELECT r.id AS "roundId", r.submission_id AS "submissionId",
      CASE WHEN jsonb_typeof(r.files) = 'array' THEN
        coalesce((SELECT jsonb_agg(jsonb_build_object(
          'fileId', f->>'id', 'key', f->>'storageKey',
          'size', f->'size', 'sha256', f->>'sha256'
        )) FROM jsonb_array_elements(r.files) AS f), '[]'::jsonb)
      ELSE NULL END AS files
    FROM ${schema}.submission_rounds r ORDER BY r.id
  `,
    )
    .cursor(256)) {
    for (const row of rows) {
      if (!Array.isArray(row.files)) yield { kind: 'INVALID_ROUND', roundId: row.roundId }
      else
        for (const file of row.files)
          yield { kind: 'HISTORY', submissionId: row.submissionId, roundId: row.roundId, ...file }
    }
  }
}

async function rootStat(root) {
  const stat = await lstat(root, { bigint: true })
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('UNSAFE_STORAGE_ROOT')
  const actual = await realpath(root)
  const comparable = (path) => (process.platform === 'win32' ? path.toLowerCase() : path)
  if (comparable(actual) !== comparable(resolve(root))) throw new Error('UNSAFE_STORAGE_ROOT')
  return stat
}

async function inspectFile(path, expected) {
  let handle
  try {
    const before = await lstat(path, { bigint: true })
    if (!before.isFile() || before.isSymbolicLink()) return 'UNSAFE_ENTRY'
    handle = await open(
      path,
      constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0),
    )
    const opened = await handle.stat({ bigint: true })
    if (!opened.isFile() || !sameFile(before, opened)) return 'CHANGED_DURING_SCAN'
    // Bound the read even when an unexpected large file or concurrent writer is present.
    if (opened.size !== BigInt(expected.size)) return 'SIZE_MISMATCH'
    const digest = createHash('sha256')
    for await (const chunk of handle.createReadStream({ autoClose: false, end: expected.size - 1 }))
      digest.update(chunk)
    const after = await handle.stat({ bigint: true })
    const finalPath = await lstat(path, { bigint: true })
    if (!sameFile(opened, after) || !sameFile(after, finalPath) || finalPath.isSymbolicLink())
      return 'CHANGED_DURING_SCAN'
    return digest.digest('hex') === expected.sha256 ? null : 'HASH_MISMATCH'
  } catch (error) {
    return error.code === 'ENOENT' ? 'MISSING_FILE' : 'UNREADABLE_FILE'
  } finally {
    await handle?.close()
  }
}

// No writes, deletes, repairs or automatic classification of signature validity.
export async function auditEvidence({ root, references, detailLimit = 100 }) {
  if (!isAbsolute(root)) throw new Error('REQUIRES_ABSOLUTE_STORAGE_ROOT')
  if (!Number.isInteger(detailLimit) || detailLimit < 0 || detailLimit > 1000)
    throw new Error('INVALID_DETAIL_LIMIT')
  const report = {
    version: 1,
    mode: 'OBSERVATIONAL_READ_ONLY',
    status: 'OK',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    consistentBackup: false,
    signaturesChecked: false,
    malwareScanned: false,
    counts: {
      currentReferences: 0,
      removedReferences: 0,
      historicalReferences: 0,
      uniqueReferencedFiles: 0,
      diskEntries: 0,
      verifiedFiles: 0,
      unreferencedFiles: 0,
    },
    issueCount: 0,
    issuesByCode: {},
    issues: [],
    detailsTruncated: false,
  }
  const issue = (code, ref = {}, key) => {
    report.issueCount++
    report.issuesByCode[code] = (report.issuesByCode[code] || 0) + 1
    if (report.issues.length < detailLimit) {
      const detail = { code }
      for (const field of ['fileId', 'roundId'])
        if (typeof ref[field] === 'string' && uuid.test(ref[field])) detail[field] = ref[field]
      if (key !== undefined) detail.keyFingerprint = fingerprint(key)
      report.issues.push(detail)
    } else report.detailsTruncated = true
  }
  const startRoot = await rootStat(root)
  const current = new Map(),
    history = [],
    expected = new Map(),
    protectedKeys = new Set()
  for await (const ref of references) {
    if (ref.kind === 'INVALID_ROUND') {
      issue('INVALID_ROUND', ref)
      continue
    }
    if (ref.kind === 'CURRENT') {
      report.counts.currentReferences++
      if (ref.removed) report.counts.removedReferences++
    } else if (ref.kind === 'HISTORY') {
      report.counts.historicalReferences++
    } else {
      issue('INVALID_REFERENCE')
      continue
    }
    if (typeof ref.key === 'string' && uuid.test(ref.key)) protectedKeys.add(ref.key)
    if (
      !uuid.test(ref.fileId || '') ||
      !uuid.test(ref.submissionId || '') ||
      !uuid.test(ref.key || '') ||
      !Number.isInteger(ref.size) ||
      ref.size <= 0 ||
      ref.size > 5242880 ||
      !hash.test(ref.sha256 || '')
    ) {
      issue('INVALID_REFERENCE', ref)
      continue
    }
    if (ref.kind === 'CURRENT') {
      if (current.has(ref.fileId)) issue('DUPLICATE_FILE_ID', ref)
      current.set(ref.fileId, ref)
    } else history.push(ref)
    const old = expected.get(ref.key)
    if (old && (old.size !== ref.size || old.sha256 !== ref.sha256))
      issue('CONFLICTING_REFERENCE', ref, ref.key)
    else if (!old) expected.set(ref.key, ref)
  }
  for (const ref of history) {
    const original = current.get(ref.fileId)
    if (
      !original ||
      original.submissionId !== ref.submissionId ||
      original.key !== ref.key ||
      original.size !== ref.size ||
      original.sha256 !== ref.sha256
    )
      issue('HISTORY_METADATA_MISMATCH', ref)
  }
  report.counts.uniqueReferencedFiles = protectedKeys.size
  const seen = new Set()
  for await (const entry of await opendir(root)) {
    report.counts.diskEntries++
    if (!uuid.test(entry.name)) {
      issue('UNEXPECTED_ENTRY', {}, entry.name)
      continue
    }
    seen.add(entry.name)
    if (entry.isSymbolicLink() || !entry.isFile()) {
      issue('UNSAFE_ENTRY', {}, entry.name)
      continue
    }
    if (!protectedKeys.has(entry.name)) {
      report.counts.unreferencedFiles++
      issue('UNREFERENCED_FILE', {}, entry.name)
      continue
    }
    const ref = expected.get(entry.name)
    if (!ref) continue // Invalid metadata was already reported; preserve the bytes.
    const result = await inspectFile(join(root, entry.name), ref)
    if (result) issue(result, ref, entry.name)
    else report.counts.verifiedFiles++
  }
  for (const [key, ref] of expected) if (!seen.has(key)) issue('MISSING_FILE', ref, key)
  const endRoot = await rootStat(root)
  if (!sameFile(startRoot, endRoot)) issue('STORAGE_CHANGED_DURING_SCAN')
  report.status = report.issueCount ? 'ATTENTION' : 'OK'
  report.finishedAt = new Date().toISOString()
  return report
}
