// Recovery v2 distinguishes historical technical fixtures from actual database-registry assets.
// These checks prove internal consistency and byte preservation, never authenticity/signatures.
import { isDeepStrictEqual } from 'node:util'
import { isAbsolute, relative, resolve, sep } from 'node:path'

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const hash = /^[a-f0-9]{64}$/
const templateId = /^submission-summary-v[1-9][0-9]*$/
const fail = () => {
  throw new Error('INVALID_DOCUMENT_ASSETS')
}
const string = (value, pattern) => typeof value === 'string' && pattern.test(value)
const digest = (value, maximum) =>
  value &&
  Number.isInteger(value.size) &&
  value.size > 0 &&
  value.size <= maximum &&
  string(value.sha256, hash)
const version = (value) =>
  typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._+:/ -]{0,199}$/.test(value)
const keys = (value, expected) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === [...expected].sort().join(',')
const sameTemplate = (a, b) => ['id', 'sha256', 'bindingSource'].every((key) => a[key] === b[key])

export function validateRecoveryAssets(manifest) {
  if (manifest.version === 1) {
    if (
      ['templates', 'documents', 'staging', 'registrySnapshotSha256', 'assetMetadataSource'].some(
        (key) => Object.hasOwn(manifest, key),
      )
    )
      fail()
    return manifest
  }
  if (
    manifest.version !== 2 ||
    !['TECHNICAL_FIXTURE', 'DATABASE_REGISTRY'].includes(manifest.assetMetadataSource) ||
    !Array.isArray(manifest.templates) ||
    manifest.templates.length < 1 ||
    manifest.templates.length > 32 ||
    !Array.isArray(manifest.documents) ||
    manifest.documents.length > 5000
  )
    fail()
  const registry = manifest.assetMetadataSource === 'DATABASE_REGISTRY'
  if (
    registry
      ? !Array.isArray(manifest.staging) ||
        manifest.staging.length > 5000 ||
        !string(manifest.registrySnapshotSha256, hash)
      : Object.hasOwn(manifest, 'staging') || Object.hasOwn(manifest, 'registrySnapshotSha256')
  )
    fail()
  const templates = new Map(),
    objects = new Set(),
    sets = new Map(),
    rounds = new Set()
  for (const item of manifest.templates) {
    if (
      !keys(item, ['id', 'key', 'size', 'sha256']) ||
      !string(item.id, templateId) ||
      item.key !== item.id + '.docx' ||
      !digest(item, 1048576) ||
      templates.has(item.id)
    )
      fail()
    templates.set(item.id, item)
  }
  for (const item of manifest.documents) {
    if (
      !keys(item, [
        'key',
        'setId',
        'roundId',
        'submissionId',
        'roundNumber',
        'format',
        'size',
        'sha256',
        'template',
        'rendererVersion',
        'converterVersion',
        'sourceDocxSha256',
        'kind',
        'status',
        ...(registry ? ['documentId', 'attemptId', 'renderer', 'converter'] : []),
      ]) ||
      !['key', 'setId', 'roundId', 'submissionId'].every((key) => string(item[key], uuid)) ||
      !Number.isInteger(item.roundNumber) ||
      item.roundNumber < 1 ||
      item.roundNumber > 2147483647 ||
      !['DOCX', 'PDF'].includes(item.format) ||
      !digest(item, 16777216) ||
      item.kind !== 'DECLARATION' ||
      item.status !== 'UNSIGNED_DECLARATION' ||
      !version(item.rendererVersion) ||
      objects.has(item.key) ||
      !keys(item.template, ['id', 'sha256', 'bindingSource']) ||
      !['SUBMITTED', 'LEGACY_V1'].includes(item.template.bindingSource)
    )
      fail()
    if (
      registry &&
      (!string(item.documentId, uuid) ||
        !string(item.attemptId, uuid) ||
        item.key !== item.attemptId ||
        !keys(item.renderer, ['version', 'buildSha256', 'nodeVersion', 'icuVersion']) ||
        item.rendererVersion !== item.renderer.version ||
        !version(item.renderer.version) ||
        !string(item.renderer.buildSha256, hash) ||
        ![item.renderer.nodeVersion, item.renderer.icuVersion].every(
          (value) => typeof value === 'string' && value.length > 0 && value.length <= 40,
        ) ||
        (item.format === 'DOCX'
          ? item.converter !== null
          : !keys(item.converter, ['version', 'binarySha256']) ||
            item.converterVersion !== item.converter.version ||
            !version(item.converter.version) ||
            !string(item.converter.binarySha256, hash)))
    )
      fail()
    const template = templates.get(item.template.id)
    if (!template || template.sha256 !== item.template.sha256) fail()
    if (
      item.format === 'DOCX'
        ? item.sourceDocxSha256 !== null || item.converterVersion !== null
        : !string(item.sourceDocxSha256, hash) || !version(item.converterVersion)
    )
      fail()
    objects.add(item.key)
    let set = sets.get(item.setId)
    if (!set) {
      if (rounds.has(item.roundId) || rounds.has(item.submissionId + ':' + item.roundNumber)) fail()
      rounds.add(item.roundId)
      rounds.add(item.submissionId + ':' + item.roundNumber)
      set = { first: item, formats: new Map() }
      sets.set(item.setId, set)
    }
    if (
      set.formats.has(item.format) ||
      ['roundId', 'submissionId', 'roundNumber', 'rendererVersion'].some(
        (key) => set.first[key] !== item[key],
      ) ||
      !sameTemplate(set.first.template, item.template) ||
      (registry && !isDeepStrictEqual(set.first.renderer, item.renderer))
    )
      fail()
    set.formats.set(item.format, item)
  }
  for (const set of sets.values()) {
    const word = set.formats.get('DOCX'),
      pdf = set.formats.get('PDF')
    if (!word || (pdf && pdf.sourceDocxSha256 !== word.sha256)) fail()
  }
  if (registry) {
    const documentIds = new Set(manifest.documents.map((item) => item.documentId))
    if (documentIds.size !== manifest.documents.length) fail()
    const staged = new Set()
    for (const entry of manifest.staging) {
      const document = manifest.documents.find((item) => item.key === entry.key)
      if (
        !keys(entry, ['key', 'documentId', 'size', 'sha256']) ||
        !document ||
        entry.documentId !== document.documentId ||
        !digest(entry, 16777216) ||
        entry.size !== document.size ||
        entry.sha256 !== document.sha256 ||
        staged.has(entry.key)
      )
        fail()
      staged.add(entry.key)
    }
  }
  return manifest
}

export function recoverySubdirectories(manifest) {
  return manifest.version === 2
    ? [
        'files',
        'templates',
        'documents',
        ...(manifest.assetMetadataSource === 'DATABASE_REGISTRY' ? ['staging'] : []),
      ]
    : ['files']
}

export function recoveryEntryMaximum(name) {
  if (name === 'database.dump') return 536870912
  if (typeof name !== 'string') fail()
  if (name.startsWith('files/') && string(name.slice(6), uuid)) return 5242880
  if (name.startsWith('staging/') && string(name.slice(8), uuid)) return 16777216
  if (name.startsWith('documents/') && string(name.slice(10), uuid)) return 16777216
  if (/^templates\/submission-summary-v[1-9][0-9]*\.docx$/.test(name)) return 1048576
  fail()
}

export function recoveryFileEntries(manifest) {
  return [
    { name: 'database.dump', digest: manifest.database },
    ...manifest.files.map((item) => ({
      name: 'files/' + item.key,
      digest: { size: item.size, sha256: item.sha256 },
    })),
    ...(manifest.version === 2
      ? recoverySubdirectories(manifest)
          .filter((directory) => directory !== 'files')
          .flatMap((directory) =>
            manifest[directory].map((item) => ({
              name: directory + '/' + item.key,
              digest: { size: item.size, sha256: item.sha256 },
            })),
          )
      : []),
  ]
}

export function assertDisjointRecoveryRoots(roots) {
  const paths = roots.map((root) => {
    if (typeof root !== 'string' || !isAbsolute(root)) fail()
    const path = resolve(root)
    return process.platform === 'win32' ? path.toLowerCase() : path
  })
  for (let i = 0; i < paths.length; i++)
    for (let j = 0; j < paths.length; j++) {
      if (i === j) continue
      const part = relative(paths[i], paths[j])
      if (part === '' || (!isAbsolute(part) && part !== '..' && !part.startsWith('..' + sep)))
        fail()
    }
}

// Legacy v1 and fixture-v2 must fail closed rather than omit actual registry/vault bytes.
// Only the explicit DATABASE_REGISTRY path reads and compares a complete registry inventory.
export async function assertNoDocumentRegistryRows(sql) {
  const [schema] = await sql.unsafe(`SELECT
    to_regclass('public.submission_document_sets') IS NOT NULL AS sets,
    to_regclass('public.submission_documents') IS NOT NULL AS documents,
    to_regclass('public.submission_document_jobs') IS NOT NULL AS jobs`)
  if (!schema || Object.values(schema).some((value) => typeof value !== 'boolean'))
    throw new Error('DOCUMENT_REGISTRY_SCHEMA_UNAVAILABLE')
  if (Object.values(schema).every((value) => value === false)) return 'ABSENT'
  if (!Object.values(schema).every((value) => value === true))
    throw new Error('DOCUMENT_REGISTRY_SCHEMA_INCOMPLETE')
  const [counts] = await sql.unsafe(`SELECT
    (SELECT count(*)::int FROM public.submission_document_sets) AS sets,
    (SELECT count(*)::int FROM public.submission_documents) AS documents,
    (SELECT count(*)::int FROM public.submission_document_jobs) AS jobs`)
  if (!counts || Object.values(counts).some((value) => value !== 0))
    throw new Error('DOCUMENT_REGISTRY_RECOVERY_REQUIRED')
  return 'EMPTY'
}
