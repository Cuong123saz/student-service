// Internal/read-only inventory. A coherent backup additionally requires all writers stopped.
import { createHash } from 'node:crypto'
import { lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { assertDisjointRecoveryRoots, validateRecoveryAssets } from './recovery-assets.mjs'
import { assertRecoveryDirectory, fileDigest } from './recovery-bundle.mjs'
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const fail = (code) => {
  throw new Error(code)
}
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object' && !(value instanceof Date)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value
export const registrySnapshotDigest = (snapshot) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(snapshot)))
    .digest('hex')
export async function readDocumentRegistrySnapshot(sql) {
  const [schema] = await sql.unsafe(
    `SELECT to_regclass('public.submission_document_retries') IS NOT NULL AS "hasRetries", EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='submission_document_jobs' AND column_name='retry_allowance') AS "hasAllowance"`,
  )
  if (typeof schema?.hasRetries !== 'boolean' || schema.hasRetries !== schema.hasAllowance)
    fail('INVALID_REGISTRY_SCHEMA')
  const result = {}
  const queries = [
    [
      'rounds',
      `SELECT id,submission_id AS "submissionId",round_number AS "roundNumber",declaration_template AS template FROM submission_rounds ORDER BY id LIMIT 5001`,
    ],
    [
      'sets',
      `SELECT id,submission_id AS "submissionId",round_id AS "roundId",kind,template,created_at AS "createdAt" FROM submission_document_sets ORDER BY id LIMIT 5001`,
    ],
    [
      'documents',
      `SELECT id AS "documentId",set_id AS "setId",format,storage_key AS key,attempt_id AS "attemptId",size,sha256,template,renderer,converter,source_docx_sha256 AS "sourceDocxSha256",status,created_at AS "createdAt" FROM submission_documents ORDER BY id LIMIT 5001`,
    ],
    [
      'jobs',
      `SELECT id,set_id AS "setId",format,state,attempts,${schema.hasRetries ? 'retry_allowance AS "retryAllowance",' : ''}attempt_id AS "attemptId",lease_until AS "leaseUntil",next_attempt_at AS "nextAttemptAt",error_code AS "errorCode",published_document_id AS "publishedDocumentId",created_at AS "createdAt",updated_at AS "updatedAt" FROM submission_document_jobs ORDER BY id LIMIT 10001`,
    ],
  ]
  if (schema.hasRetries)
    queries.push([
      'retries',
      `SELECT id,job_id AS "jobId",attempt_id AS "attemptId",attempts,allowance,actor_user_id AS "actorUserId",reason_code AS "reasonCode",created_at AS "createdAt" FROM submission_document_retries ORDER BY id LIMIT 30001`,
    ])
  for (const [key, query] of queries) {
    result[key] = [...(await sql.unsafe(query))]
    if (result[key].length > (key === 'jobs' ? 10000 : key === 'retries' ? 30000 : 5000))
      fail('DOCUMENT_REGISTRY_LIMIT_EXCEEDED')
  }
  return result
}
function unique(rows, key, code) {
  const map = new Map()
  for (const row of rows) {
    if (!uuid.test(row[key] || '') || map.has(row[key])) fail(code)
    map.set(row[key], row)
  }
  return map
}
function validateSnapshot(snapshot) {
  const rounds = unique(snapshot.rounds, 'id', 'INVALID_REGISTRY_ROUND'),
    sets = unique(snapshot.sets, 'id', 'INVALID_REGISTRY_SET'),
    documents = unique(snapshot.documents, 'documentId', 'INVALID_REGISTRY_DOCUMENT')
  const roundSets = new Set(),
    formats = new Set(),
    jobFormats = new Set()
  const jobs = unique(snapshot.jobs, 'id', 'INVALID_REGISTRY_JOB')
  const retries = unique(snapshot.retries ?? [], 'id', 'INVALID_REGISTRY_RETRY')
  const retrySlots = new Set(),
    retryTokens = new Set()
  for (const retry of retries.values()) {
    const job = jobs.get(retry.jobId),
      slot = retry.jobId + ':' + retry.allowance,
      token = retry.jobId + ':' + retry.attemptId
    if (
      !job ||
      !uuid.test(retry.actorUserId || '') ||
      !uuid.test(retry.attemptId || '') ||
      !Number.isInteger(retry.allowance) ||
      retry.allowance < 1 ||
      retry.allowance > 3 ||
      retry.attempts !== 2 + retry.allowance ||
      retry.allowance > (job.retryAllowance ?? 0) ||
      retry.attempts > job.attempts ||
      retrySlots.has(slot) ||
      retryTokens.has(token) ||
      !['RENDERER_FIXED', 'CONVERTER_FIXED', 'STORAGE_FIXED', 'WORKER_RESTARTED'].includes(
        retry.reasonCode,
      ) ||
      (job.attempts === retry.attempts
        ? job.attemptId !== retry.attemptId
        : job.attemptId === retry.attemptId)
    )
      fail('INVALID_REGISTRY_RETRY')
    retrySlots.add(slot)
    retryTokens.add(token)
  }
  for (const set of sets.values()) {
    const round = rounds.get(set.roundId)
    if (
      !round ||
      set.kind !== 'DECLARATION' ||
      set.submissionId !== round.submissionId ||
      !isDeepStrictEqual(set.template, round.template) ||
      roundSets.has(set.roundId)
    )
      fail('REGISTRY_ROUND_BINDING_MISMATCH')
    roundSets.add(set.roundId)
  }
  for (const item of documents.values()) {
    const set = sets.get(item.setId)
    if (
      !set ||
      !isDeepStrictEqual(set.template, item.template) ||
      formats.has(item.setId + ':' + item.format)
    )
      fail('REGISTRY_DOCUMENT_BINDING_MISMATCH')
    formats.add(item.setId + ':' + item.format)
  }
  for (const job of snapshot.jobs) {
    const document = documents.get(job.publishedDocumentId),
      key = job.setId + ':' + job.format
    if (
      !sets.has(job.setId) ||
      !['DOCX', 'PDF'].includes(job.format) ||
      jobFormats.has(key) ||
      !Number.isInteger(job.attempts) ||
      job.attempts < 0 ||
      !Number.isInteger(job.retryAllowance ?? 0) ||
      (job.retryAllowance ?? 0) < 0 ||
      (job.retryAllowance ?? 0) > 3 ||
      (snapshot.retries && !Object.hasOwn(job, 'retryAllowance')) ||
      job.attempts > 3 + (job.retryAllowance ?? 0) ||
      !['PENDING', 'RUNNING', 'RETRYABLE', 'COMPLETE'].includes(job.state)
    )
      fail('INVALID_REGISTRY_JOB')
    for (let allowance = 1; allowance <= (job.retryAllowance ?? 0); allowance++)
      if (!retrySlots.has(job.id + ':' + allowance)) fail('REGISTRY_RETRY_HISTORY_MISSING')
    jobFormats.add(key)
    if (job.state === 'COMPLETE') {
      if (
        !document ||
        document.setId !== job.setId ||
        document.format !== job.format ||
        document.attemptId !== job.attemptId ||
        job.leaseUntil !== null ||
        job.errorCode !== null ||
        job.attempts < 1
      )
        fail('REGISTRY_COMPLETE_JOB_MISMATCH')
    } else if (
      job.publishedDocumentId !== null ||
      formats.has(key) ||
      (job.state === 'PENDING'
        ? job.attempts !== 0 ||
          job.attemptId !== null ||
          job.leaseUntil !== null ||
          job.errorCode !== null
        : job.attempts < 1 ||
          !uuid.test(job.attemptId || '') ||
          (job.state === 'RUNNING'
            ? job.leaseUntil === null || job.errorCode !== null
            : job.leaseUntil !== null ||
              !['RENDER_FAILED', 'CONVERT_FAILED', 'STORAGE_FAILED', 'LEASE_EXPIRED'].includes(
                job.errorCode,
              )))
    )
      fail('REGISTRY_PENDING_JOB_MISMATCH')
  }
  for (const key of formats) if (!jobFormats.has(key)) fail('REGISTRY_DOCUMENT_JOB_MISSING')
  return { rounds, sets }
}
async function inventory(root, maximum, keyPattern) {
  await assertRecoveryDirectory(root)
  const before = await lstat(root, { bigint: true }),
    names = (await readdir(root)).sort(),
    result = []
  if (names.length > 5000) fail('DOCUMENT_INVENTORY_LIMIT_EXCEEDED')
  for (const key of names) {
    if (!keyPattern.test(key)) fail('UNEXPECTED_DOCUMENT_ENTRY')
    result.push({ key, ...(await fileDigest(join(root, key), maximum)) })
  }
  const after = await lstat(root, { bigint: true })
  if (
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.mtimeNs !== after.mtimeNs ||
    before.ctimeNs !== after.ctimeNs ||
    !isDeepStrictEqual(names, (await readdir(root)).sort())
  )
    fail('DOCUMENT_INVENTORY_CHANGED')
  return result
}
export async function collectDocumentRegistryAssets({
  sql,
  templateRoot,
  documentRoot,
  stagingRoot,
}) {
  assertDisjointRecoveryRoots([templateRoot, documentRoot, stagingRoot])
  const snapshot = await readDocumentRegistrySnapshot(sql),
    { rounds, sets } = validateSnapshot(snapshot)
  const templates = (
    await inventory(templateRoot, 1048576, /^submission-summary-v[1-9][0-9]*\.docx$/)
  ).map((item) => ({ ...item, id: item.key.slice(0, -5) }))
  for (const round of rounds.values())
    if (
      !templates.some(
        (item) => item.id === round.template?.id && item.sha256 === round.template?.sha256,
      )
    )
      fail('REGISTRY_TEMPLATE_MISSING')
  const documents = snapshot.documents.map((item) => {
    const set = sets.get(item.setId),
      round = rounds.get(set.roundId)
    const { createdAt: _createdAt, ...document } = item
    return {
      ...document,
      roundId: round.id,
      submissionId: round.submissionId,
      roundNumber: round.roundNumber,
      kind: set.kind,
      rendererVersion: item.renderer?.version,
      converterVersion: item.converter?.version ?? null,
    }
  })
  const final = await inventory(documentRoot, 16777216, uuid)
  if (
    final.length !== documents.length ||
    final.some(
      (file) =>
        !documents.some(
          (item) => item.key === file.key && item.size === file.size && item.sha256 === file.sha256,
        ),
    )
  )
    fail('REGISTRY_FINAL_INVENTORY_MISMATCH')
  const staging = (await inventory(stagingRoot, 16777216, uuid)).map((file) => {
    const document = documents.find((item) => item.key === file.key)
    if (!document || document.size !== file.size || document.sha256 !== file.sha256)
      fail('UNRECONCILED_DOCUMENT_STAGE')
    return { ...file, documentId: document.documentId }
  })
  const metadata = {
    version: 2,
    assetMetadataSource: 'DATABASE_REGISTRY',
    registrySnapshotSha256: registrySnapshotDigest(snapshot),
    templates,
    documents,
    staging,
  }
  validateRecoveryAssets(metadata)
  if (
    registrySnapshotDigest(await readDocumentRegistrySnapshot(sql)) !==
    metadata.registrySnapshotSha256
  )
    fail('DOCUMENT_REGISTRY_CHANGED')
  return metadata
}
export async function auditDocumentRegistry(options) {
  try {
    const assets = await collectDocumentRegistryAssets(options)
    return {
      version: 1,
      mode: 'OBSERVATIONAL_READ_ONLY',
      status: 'OK',
      consistentBackup: false,
      signaturesChecked: false,
      registrySnapshotSha256: assets.registrySnapshotSha256,
      counts: {
        templates: assets.templates.length,
        documents: assets.documents.length,
        reconciledStages: assets.staging.length,
      },
      assets,
    }
  } catch (error) {
    const code = /^[A-Z_]+$/.test(error.message) ? error.message : 'DOCUMENT_INVENTORY_INCOMPLETE'
    return {
      version: 1,
      mode: 'OBSERVATIONAL_READ_ONLY',
      status: 'ISSUES',
      consistentBackup: false,
      signaturesChecked: false,
      code,
    }
  }
}
