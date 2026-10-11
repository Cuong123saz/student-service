import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { unzipSync, strFromU8 } from 'fflate'
import {
  LocalSubmissionDocumentRenderer,
  documentTemplatePath,
  submissionDocumentTemplate,
  type DocumentSnapshot,
  type SubmissionDocumentRenderer,
} from './submission-document.js'
import { SubmissionService, type SubmissionRepository } from './submission.service.js'
import { SubmissionError, type DraftView } from './submission.types.js'
import type { EvidenceStorage } from './submission.storage.js'
import {
  bundleLimits,
  validateBundleEvidence,
  type SubmissionBundleManifest,
} from './submission-bundle.js'
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const fakePdf = Buffer.from('%PDF-1.7\n' + '.'.repeat(120) + '\n%%EOF')
function fixture() {
  const fileId = randomUUID(),
    bytes = Buffer.from('%PDF-fake original evidence'),
    key = randomUUID()
  const input: DocumentSnapshot = {
    id: randomUUID(),
    serviceName: 'Dịch vụ giả',
    procedure: {
      versionId: randomUUID(),
      versionNumber: 2,
      processingMode: 'HYBRID',
      processingUnitName: 'Đơn vị giả',
      contactInstructions: '',
      fields: [],
      attachments: [],
      maxTotalAttachmentBytes: bundleLimits.evidenceBytes,
    },
    round: {
      roundNumber: 1,
      submittedAt: '2026-10-11T01:00:00Z',
      source: 'LIVE',
      studentSnapshot: {
        fullName: 'Nguyễn An',
        studentCode: 'GIA001',
        classCode: 'GIA-01',
        facultyCode: 'GIA',
      },
      values: { test: 0, agreed: false },
      files: [
        {
          id: fileId,
          attachmentKey: 'proof',
          name: '../../Tên gốc & giả.pdf',
          mimeType: 'application/pdf',
          size: bytes.length,
          sha256: sha(bytes),
          signatureStatus: 'NOT_CHECKED',
        },
      ],
    },
  }
  const view = {
    ...input,
    rounds: [input.round],
    values: { test: 'đang sửa' },
    files: [],
  } as unknown as DraftView
  const stored = {
    key,
    name: input.round.files[0]!.name,
    mimeType: 'application/pdf',
    size: bytes.length,
    sha256: sha(bytes),
  }
  let reads = 0,
    storageReads = 0,
    fileReads = 0,
    pairCalls = 0
  const repository = {
    get: async () => {
      reads++
      return view
    },
    reviewGet: async () => {
      reads++
      return view
    },
    roundFile: async (_userId: string, _id: string, round: number, id: string) => {
      fileReads++
      assert.equal(round, 1)
      assert.equal(id, fileId)
      return stored
    },
    reviewRoundFile: async (_userId: string, _id: string, round: number, id: string) => {
      fileReads++
      assert.equal(round, 1)
      assert.equal(id, fileId)
      return stored
    },
  } as unknown as SubmissionRepository
  const storage = {
    read: async (requested: string) => {
      storageReads++
      assert.equal(requested, key)
      return bytes
    },
  } as EvidenceStorage
  const local = new LocalSubmissionDocumentRenderer({ convert: async () => fakePdf })
  const renderer: SubmissionDocumentRenderer = {
    render: (snapshot, format) => local.render(snapshot, format),
    renderPair: (snapshot) => {
      pairCalls++
      return local.renderPair(snapshot)
    },
  }
  const service = new SubmissionService(repository, storage, renderer)
  return {
    input,
    view,
    stored,
    bytes,
    key,
    repository,
    storage,
    renderer,
    service,
    counts: () => ({ reads, storageReads, fileReads, pairCalls }),
  }
}
function manifest(parts: Record<string, Uint8Array>) {
  return JSON.parse(strFromU8(parts['manifest.json']!)) as SubmissionBundleManifest
}

test('bundle includes the exact Word converted to PDF, original evidence and complete checksums', async () => {
  const f = fixture()
  let converted: Buffer | undefined
  const renderer = new LocalSubmissionDocumentRenderer({
    convert: async (word) => {
      converted = word
      return fakePdf
    },
  })
  const result = await new SubmissionService(f.repository, f.storage, renderer).bundleDownload(
    'owner',
    f.input.id,
    1,
  )
  assert.equal(result.name, 'goi-ho-so-' + f.input.id + '-lan-1.zip')
  assert.equal(result.mimeType, 'application/zip')
  const parts = unzipSync(result.bytes),
    info = manifest(parts)
  assert.equal(info.schema, 'student-service.submission-bundle')
  assert.equal(info.version, 1)
  assert.equal(info.documentStatus, 'UNSIGNED_DECLARATION')
  assert.equal(info.signatureStatus, 'NOT_CHECKED')
  assert.deepEqual(info.template, submissionDocumentTemplate)
  assert.equal(info.roundNumber, 1)
  assert.equal(info.procedureVersionId, f.input.procedure.versionId)
  assert.deepEqual(Buffer.from(parts['phieu-ho-so.docx']!), converted)
  assert.deepEqual(Buffer.from(parts['phieu-ho-so.pdf']!), fakePdf)
  assert.equal(info.files.length, Object.keys(parts).length - 1)
  for (const item of info.files) {
    assert.equal(parts[item.path]!.length, item.size)
    assert.equal(sha(parts[item.path]!), item.sha256)
  }
  const evidence = info.files.find((item) => item.kind === 'EVIDENCE')
  assert.ok(evidence)
  assert.equal(evidence.originalName, f.input.round.files[0]!.name)
  assert.match(evidence.path, /^minh-chung\/001-[a-f0-9-]+\.pdf$/)
  assert.deepEqual(Buffer.from(parts[evidence.path]!), f.bytes)
  assert.equal(evidence.signatureStatus, 'NOT_CHECKED')
  assert.equal(strFromU8(parts['HUONG-DAN.txt']!).includes('không xác minh người ký'), true)
  const serial = JSON.stringify(info)
  assert.ok(!serial.includes(f.key))
  assert.ok(!serial.includes('đang sửa'))
  assert.deepEqual(f.counts(), { reads: 2, storageReads: 1, fileReads: 1, pairCalls: 0 })
})

test('bundle uses only the selected frozen round even while a supplement is being edited', async () => {
  const f = fixture()
  f.view.rounds.push({
    ...structuredClone(f.input.round),
    roundNumber: 2,
    files: [],
    values: { test: 'new submitted' },
  })
  f.view.values = { test: 'new working' }
  const first = manifest(unzipSync((await f.service.bundleDownload('owner', f.input.id, 1)).bytes))
  const second = manifest(unzipSync((await f.service.bundleDownload('owner', f.input.id, 2)).bytes))
  assert.equal(first.files.filter((x: { kind: string }) => x.kind === 'EVIDENCE').length, 1)
  assert.equal(second.files.filter((x: { kind: string }) => x.kind === 'EVIDENCE').length, 0)
  assert.equal(second.roundNumber, 2)
  assert.equal(f.counts().storageReads, 1)
  await assert.rejects(
    () => f.service.bundleDownload('owner', f.input.id, 3),
    (e) => e instanceof SubmissionError && e.statusCode === 404,
  )
})

test('denied bundle never reads files; revocation after conversion returns no package', async () => {
  const f = fixture(),
    denied = new SubmissionError(403, 'FORBIDDEN', 'Mất quyền')
  f.repository.get = async () => {
    throw denied
  }
  await assert.rejects(() => f.service.bundleDownload('other', f.input.id, 1), denied)
  assert.equal(f.counts().storageReads, 0)
  assert.equal(f.counts().pairCalls, 0)
  let reads = 0
  f.repository.reviewGet = async () => {
    if (++reads > 1) throw denied
    return f.view as never
  }
  await assert.rejects(() => f.service.bundleDownload('reviewer', f.input.id, 1, true), denied)
  assert.equal(reads, 2)
  assert.equal(f.counts().storageReads, 1)
  assert.equal(f.counts().pairCalls, 1)
})

test('missing, altered or mismatched evidence refuses the entire bundle before PDF conversion', async () => {
  for (const mode of ['missing', 'same-size-altered', 'short', 'metadata'] as const) {
    const f = fixture()
    if (mode === 'missing')
      f.storage.read = async () => {
        throw new Error('missing')
      }
    if (mode === 'same-size-altered') f.storage.read = async () => Buffer.alloc(f.bytes.length, 65)
    if (mode === 'short') f.storage.read = async () => Buffer.from('x')
    if (mode === 'metadata') f.stored.sha256 = '0'.repeat(64)
    await assert.rejects(
      () => f.service.bundleDownload('owner', f.input.id, 1),
      (e) => e instanceof SubmissionError && e.code === 'FILE_INTEGRITY',
      mode,
    )
    assert.equal(f.counts().pairCalls, 0)
  }
})

test('bundle metadata limits reject duplicates, unsupported MIME and over-limit bytes before storage', async () => {
  const f = fixture(),
    file = f.input.round.files[0]!
  for (const files of [
    [{ ...file, id: '../unsafe' }],
    [file, file],
    [{ ...file, mimeType: 'text/html' }],
    [{ ...file, mimeType: '__proto__' }],
    [{ ...file, mimeType: 'constructor' }],
    [{ ...file, size: -1 }],
    [{ ...file, size: 5 * 1024 * 1024 + 1 }],
    Array.from({ length: 5 }, () => ({ ...file, id: randomUUID(), size: 5 * 1024 * 1024 })),
    [{ ...file, sha256: 'bad' }],
  ])
    assert.throws(
      () => validateBundleEvidence(files),
      (e) => e instanceof SubmissionError && e.code === 'FILE_INTEGRITY',
    )
  f.input.round.files = [{ ...file, mimeType: 'application/javascript' }]
  await assert.rejects(
    () => f.service.bundleDownload('owner', f.input.id, 1),
    (e) => e instanceof SubmissionError && e.code === 'FILE_INTEGRITY',
  )
  assert.equal(f.counts().storageReads, 0)
})

test('bundle capacity is bounded and is released after converter failure', async () => {
  const f = fixture(),
    gate = Promise.withResolvers<never>()
  f.renderer.renderPair = () => gate.promise
  const first = f.service.bundleDownload('owner', f.input.id, 1).catch((e: unknown) => e),
    second = f.service.bundleDownload('owner', f.input.id, 1).catch((e: unknown) => e)
  await new Promise((resolve) => setTimeout(resolve, 0))
  await assert.rejects(
    () => f.service.bundleDownload('owner', f.input.id, 1),
    (e) => e instanceof SubmissionError && e.code === 'BUNDLE_BUSY',
  )
  const unavailable = new SubmissionError(503, 'DOCUMENT_PDF_UNAVAILABLE', 'Tải Word')
  gate.reject(unavailable)
  assert.deepEqual(await Promise.all([first, second]), [unavailable, unavailable])
  f.renderer.renderPair = async () => {
    throw unavailable
  }
  await assert.rejects(() => f.service.bundleDownload('owner', f.input.id, 1), unavailable)
  assert.ok((await f.service.documentDownload('owner', f.input.id, 1, 'docx')).bytes.length > 100)
})

test('changed or missing v1 template is refused, including when producing a pair', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'student-service-template-test-'))
  try {
    const template = join(directory, 'changed.docx')
    const original = await readFile(documentTemplatePath)
    assert.equal(sha(original), submissionDocumentTemplate.sha256)
    await writeFile(template, Buffer.concat([original, Buffer.from('tampered')]))
    let conversions = 0
    const renderer = new LocalSubmissionDocumentRenderer(
      {
        convert: async () => {
          conversions++
          return fakePdf
        },
      },
      template,
    )
    await assert.rejects(
      () => renderer.render(fixture().input, 'docx'),
      (e) => e instanceof SubmissionError && e.code === 'DOCUMENT_TEMPLATE_UNAVAILABLE',
    )
    await assert.rejects(
      () => renderer.renderPair(fixture().input),
      (e) => e instanceof SubmissionError && e.code === 'DOCUMENT_TEMPLATE_UNAVAILABLE',
    )
    assert.equal(conversions, 0)
    const missing = new LocalSubmissionDocumentRenderer(undefined, join(directory, 'missing.docx'))
    await assert.rejects(
      () => missing.renderPair(fixture().input),
      (e) => e instanceof SubmissionError && e.code === 'DOCUMENT_TEMPLATE_UNAVAILABLE',
    )
  } finally {
    // The sole target was generated by mkdtemp under this task-specific prefix.
    assert.ok(directory.startsWith(join(tmpdir(), 'student-service-template-test-')))
    await rm(directory, { recursive: true, force: true })
  }
})
