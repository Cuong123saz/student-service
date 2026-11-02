import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { strFromU8, unzipSync } from 'fflate'
import { createTrainingExportBundle } from './training-export.bundle.js'
import type { TrainingExportSnapshot } from './training-export.types.js'

const sample = async () =>
  JSON.parse(
    await readFile(
      new URL('../../../scripts/fixtures/training-export/snapshot.json', import.meta.url),
      'utf8',
    ),
  ) as TrainingExportSnapshot
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
const entries = () => ({
  xlsx: { name: 'a.xlsx', mimeType: 'application/x-xlsx', bytes: Buffer.from('xlsx-bytes') },
  classSheet: { name: 'class.xlsx', mimeType: 'application/x-xlsx', bytes: Buffer.from('class') },
  docx: { name: 'a.docx', mimeType: 'application/x-docx', bytes: Buffer.from('docx-bytes') },
  pdf: { name: 'a.pdf', mimeType: 'application/pdf', bytes: Buffer.from('%PDF-bytes') },
})

test('bundle stores the exact bytes with a manifest of one snapshot and SHA-256 per file', async () => {
  const s = await sample()
  const { bytes, manifest, manifestSha256 } = createTrainingExportBundle(
    s,
    entries(),
    'training-minutes-v3',
  )
  const files = unzipSync(bytes)
  assert.deepEqual(Object.keys(files).sort(), [
    'a.docx',
    'a.pdf',
    'a.xlsx',
    'class.xlsx',
    'manifest.json',
  ])
  for (const [name, entry] of Object.entries(entries()))
    assert.deepEqual(Buffer.from(files[entry.name]!), entry.bytes, name)
  assert.equal(sha(files['manifest.json']!), manifestSha256)
  const parsed = JSON.parse(strFromU8(files['manifest.json']!)) as typeof manifest
  assert.deepEqual(parsed, manifest)
  assert.equal(parsed.snapshotId, s.snapshotId)
  assert.equal(parsed.approvedRows, s.rows.length)
  assert.equal(parsed.pdfSourceDocx, 'a.docx')
  assert.equal(parsed.legalEffect, false)
  assert.equal(parsed.technicalSignatureStatus, 'NOT_VERIFIED')
  assert.deepEqual(
    parsed.files.map((f) => [f.name, f.size, f.sha256]),
    Object.values(entries()).map((e) => [e.name, e.bytes.length, sha(e.bytes)]),
  )
  // Same inputs give the same bundle bytes.
  assert.deepEqual(createTrainingExportBundle(s, entries(), 'training-minutes-v3').bytes, bytes)
})

test('bundle refuses duplicate names or a file that would shadow the manifest', async () => {
  const s = await sample()
  const duplicate = entries()
  duplicate.pdf.name = 'a.docx'
  assert.throws(() => createTrainingExportBundle(s, duplicate, 'v'), /INVALID_EXPORT_BUNDLE/)
  const shadow = entries()
  shadow.xlsx.name = 'manifest.json'
  assert.throws(() => createTrainingExportBundle(s, shadow, 'v'), /INVALID_EXPORT_BUNDLE/)
})
