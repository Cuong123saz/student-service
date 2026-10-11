// Recovery v2 is a fake-data technical fixture until the DB registry is implemented.
// These checks prove internal consistency and byte preservation, never authenticity/signatures.
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
      ['templates', 'documents', 'assetMetadataSource'].some((key) => Object.hasOwn(manifest, key))
    )
      fail()
    return manifest
  }
  if (
    manifest.version !== 2 ||
    manifest.assetMetadataSource !== 'TECHNICAL_FIXTURE' ||
    !Array.isArray(manifest.templates) ||
    manifest.templates.length < 1 ||
    manifest.templates.length > 32 ||
    !Array.isArray(manifest.documents) ||
    manifest.documents.length > 5000
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
      !sameTemplate(set.first.template, item.template)
    )
      fail()
    set.formats.set(item.format, item)
  }
  for (const set of sets.values()) {
    const word = set.formats.get('DOCX'),
      pdf = set.formats.get('PDF')
    if (!word || (pdf && pdf.sourceDocxSha256 !== word.sha256)) fail()
  }
  return manifest
}

export function recoverySubdirectories(manifest) {
  return manifest.version === 2 ? ['files', 'templates', 'documents'] : ['files']
}

export function recoveryEntryMaximum(name) {
  if (name === 'database.dump') return 536870912
  if (typeof name !== 'string') fail()
  if (name.startsWith('files/') && string(name.slice(6), uuid)) return 5242880
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
      ? ['templates', 'documents'].flatMap((directory) =>
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
