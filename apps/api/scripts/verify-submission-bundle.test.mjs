import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash, randomUUID } from 'node:crypto'
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate'
import { buildSubmissionBundle } from '../src/modules/submissions/submission-bundle.ts'
import { newDeclarationTemplateBinding } from '../src/modules/submissions/submission-document-template.ts'
import { inspectSubmissionBundle } from './verify-submission-bundle.mjs'
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
function fixture() {
  const file = {
      id: randomUUID(),
      attachmentKey: 'proof',
      name: 'Minh chứng giả.pdf',
      mimeType: 'application/pdf',
      signatureStatus: 'NOT_CHECKED',
    },
    bytes = Buffer.from('%PDF-fake evidence')
  file.size = bytes.length
  file.sha256 = sha(bytes)
  const snapshot = {
    id: randomUUID(),
    procedure: { versionId: randomUUID(), versionNumber: 1 },
    round: {
      roundNumber: 1,
      submittedAt: '2026-10-11T01:00:00Z',
      source: 'LIVE',
      declarationTemplate: newDeclarationTemplateBinding(),
    },
  }
  const bundle = buildSubmissionBundle(
    snapshot,
    {
      docx: Buffer.from('fake Word'),
      pdf: Buffer.from('%PDF-fake declaration'),
      template: snapshot.round.declarationTemplate,
    },
    [{ file, bytes }],
  )
  return { snapshot, bundle, parts: unzipSync(bundle) }
}
function pack(parts) {
  return zipSync(parts, { level: 0 })
}
function rewrite(parts, update) {
  const manifest = JSON.parse(strFromU8(parts['manifest.json']))
  update(manifest)
  parts['manifest.json'] = strToU8(JSON.stringify(manifest))
}

test('verifies a production bundle and optionally compares an independently saved hash', () => {
  const f = fixture(),
    result = inspectSubmissionBundle(f.bundle)
  assert.equal(result.result, 'CHECKSUMS_MATCH_UNSIGNED')
  assert.equal(result.fileCount, 4)
  assert.equal(result.submissionId, f.snapshot.id)
  assert.equal(result.signatureStatus, 'NOT_CHECKED')
  assert.equal(result.comparedWithExternalHash, false)
  assert.equal(inspectSubmissionBundle(f.bundle, sha(f.bundle)).comparedWithExternalHash, true)
  assert.throws(() => inspectSubmissionBundle(f.bundle, '0'.repeat(64)))
})
test('rejects altered, missing, duplicated, or unlisted files and inconsistent metadata', () => {
  const updates = [
    (parts) => {
      parts['phieu-ho-so.pdf'][0] ^= 1
    },
    (parts) => {
      delete parts['phieu-ho-so.docx']
    },
    (parts) => {
      parts['minh-chung/001-' + randomUUID() + '.pdf'] = strToU8('extra')
    },
    (parts) =>
      rewrite(parts, (m) => {
        m.files[0].sha256 = 'bad'
      }),
    (parts) =>
      rewrite(parts, (m) => {
        m.files[0].size++
      }),
    (parts) =>
      rewrite(parts, (m) => {
        m.files[0].path = 'manifest.json'
      }),
    (parts) =>
      rewrite(parts, (m) => {
        m.files[1] = m.files[0]
      }),
    (parts) =>
      rewrite(parts, (m) => {
        m.files[0].kind = 'EVIDENCE'
      }),
    (parts) =>
      rewrite(parts, (m) => {
        m.files[2].signatureStatus = 'VALID'
      }),
    (parts) =>
      rewrite(parts, (m) => {
        m.files[2].fileId = '(a+)+'
      }),
    (parts) =>
      rewrite(parts, (m) => {
        m.version = 2
      }),
    (parts) =>
      rewrite(parts, (m) => {
        m.documentStatus = 'ISSUED'
      }),
    (parts) =>
      rewrite(parts, (m) => {
        m.template.id = '../unknown'
      }),
  ]
  for (const update of updates) {
    const f = fixture()
    update(f.parts)
    assert.throws(() => inspectSubmissionBundle(pack(f.parts)))
  }
})
test('rejects traversal, absolute paths, unknown entries and oversized manifest before inflating', () => {
  for (const path of [
    '../escape',
    '/absolute',
    'minh-chung/../escape',
    'C:\\evil.pdf',
    'unknown.txt',
  ]) {
    const f = fixture()
    f.parts[path] = strToU8('unsafe')
    assert.throws(() => inspectSubmissionBundle(pack(f.parts)), path)
  }
  const f = fixture()
  f.parts['manifest.json'] = new Uint8Array(128 * 1024 + 1)
  assert.throws(() => inspectSubmissionBundle(pack(f.parts)))
  assert.throws(() => inspectSubmissionBundle(new Uint8Array(41 * 1024 * 1024 + 1)))
  const bomb = Buffer.from(fixture().bundle)
  // Alter the central-directory uncompressed size without allocating its claimed payload.
  const central = bomb.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  assert.ok(central > 0)
  bomb.writeUInt32LE(100 * 1024 * 1024, central + 24)
  assert.throws(() => inspectSubmissionBundle(bomb))
})
test('self-consistency does not authenticate the source when both manifest and files are replaced', () => {
  const f = fixture(),
    originalHash = sha(f.bundle)
  f.parts['phieu-ho-so.pdf'] = strToU8('%PDF-replaced')
  rewrite(f.parts, (m) => {
    m.files[1].size = f.parts['phieu-ho-so.pdf'].length
    m.files[1].sha256 = sha(f.parts['phieu-ho-so.pdf'])
  })
  const altered = pack(f.parts)
  assert.equal(inspectSubmissionBundle(altered).result, 'CHECKSUMS_MATCH_UNSIGNED')
  assert.throws(() => inspectSubmissionBundle(altered, originalHash))
})

test('rejects duplicate ZIP names instead of trusting the entry that overwrites another', () => {
  const bytes = Buffer.from(fixture().bundle)
  const oldName = Buffer.from('HUONG-DAN.txt'),
    newName = Buffer.from('manifest.json')
  assert.equal(oldName.length, newName.length)
  const first = bytes.indexOf(oldName),
    last = bytes.lastIndexOf(oldName)
  assert.ok(first >= 30 && last > first)
  assert.equal(bytes.readUInt32LE(first - 30), 0x04034b50)
  assert.equal(bytes.readUInt32LE(last - 46), 0x02014b50)
  newName.copy(bytes, first)
  newName.copy(bytes, last)
  assert.throws(() => inspectSubmissionBundle(bytes))
})

test('refuses recompressed entries and stored entries with inconsistent declared lengths', () => {
  const f = fixture()
  assert.throws(() => inspectSubmissionBundle(zipSync(f.parts, { level: 6 })))
  const short = Buffer.from(f.bundle)
  const central = short.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  short.writeUInt32LE(1, central + 24)
  assert.throws(() => inspectSubmissionBundle(short))
})

test('accepts original v1 packages without bindingSource and both explicit sources, rejects invented signature provenance', () => {
  for (const source of [undefined, 'SUBMITTED', 'LEGACY_V1']) {
    const f = fixture()
    rewrite(f.parts, (m) => {
      if (source === undefined) delete m.template.bindingSource
      else m.template.bindingSource = source
    })
    assert.equal(inspectSubmissionBundle(pack(f.parts)).result, 'CHECKSUMS_MATCH_UNSIGNED')
  }
  for (const source of [null, 42, 'ISSUED', 'VALID', '__proto__']) {
    const f = fixture()
    rewrite(f.parts, (m) => {
      m.template.bindingSource = source
    })
    assert.throws(() => inspectSubmissionBundle(pack(f.parts)))
  }
})
