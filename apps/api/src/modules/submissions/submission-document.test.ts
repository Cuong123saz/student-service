import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { unzipSync, strFromU8 } from 'fflate'
import {
  documentAnswer,
  fillSubmissionDocument,
  documentTemplatePath,
  LocalSubmissionDocumentRenderer,
  LibreOfficePdfConverter,
  runDocumentConversion,
  type DocumentSnapshot,
} from './submission-document.js'
import { SubmissionService, type SubmissionRepository } from './submission.service.js'
import { SubmissionError, type DraftView } from './submission.types.js'
import type { EvidenceStorage } from './submission.storage.js'
function sample(): DocumentSnapshot {
  const types = ['TEXT', 'TEXTAREA', 'NUMBER', 'DATE', 'SELECT', 'BOOLEAN'] as const
  return {
    id: '11111111-1111-1111-1111-111111111111',
    serviceName: 'Thủ tục giả định',
    procedure: {
      versionId: 'v1',
      versionNumber: 1,
      processingMode: 'ONLINE',
      processingUnitName: 'Đơn vị giả',
      contactInstructions: '',
      maxTotalAttachmentBytes: 1000,
      attachments: [],
      fields: types.map((type, index) => ({
        key: 'f' + index,
        label: 'Trường ' + index,
        type,
        source: 'STUDENT_INPUT',
        profileKey: null,
        required: false,
        maxLength: 2000,
        options: type === 'SELECT' ? [{ value: 'STUDY', label: 'Học tập' }] : [],
      })),
    },
    round: {
      roundNumber: 1,
      submittedAt: '2026-10-11T01:00:00Z',
      studentSnapshot: {
        fullName: 'Nguyễn Minh An',
        studentCode: 'GIA001',
        classCode: 'GIA-LOP',
        facultyCode: 'GIA-KHOA',
      },
      values: {
        f0: 'Tiếng Việt',
        f1: 'Dòng một\nDòng hai',
        f2: 0,
        f3: '2026-10-11',
        f4: 'STUDY',
        f5: false,
      },
      files: [],
      source: 'LIVE',
    },
  }
}
function xml(bytes: Uint8Array) {
  return strFromU8(unzipSync(bytes)['word/document.xml']!)
}
test('all six answer types preserve zero, false, Unicode, date and select labels', () => {
  const input = sample()
  assert.deepEqual(
    input.procedure.fields.map((f) => documentAnswer(f, input.round)),
    ['Tiếng Việt', 'Dòng một\nDòng hai', '0', '11/10/2026', 'Học tập', 'Không'],
  )
  input.round.values.f5 = true
  assert.equal(documentAnswer(input.procedure.fields[5]!, input.round), 'Có')
  input.round.values.f0 = null
  assert.equal(documentAnswer(input.procedure.fields[0]!, input.round), 'Chưa kê khai')
  input.procedure.fields[0] = {
    ...input.procedure.fields[0]!,
    source: 'PROFILE',
    profileKey: 'fullName',
  }
  input.round.values.f0 = 'Tên giả mạo'
  assert.equal(documentAnswer(input.procedure.fields[0], input.round), 'Nguyễn Minh An')
})
test('Word fills every field, metadata, line breaks and preserves untouched package parts', async () => {
  const input = sample(),
    template = await readFile(documentTemplatePath),
    output = fillSubmissionDocument(template, input),
    content = xml(output)
  for (const phrase of [
    'Thủ tục giả định',
    'Nguyễn Minh An',
    'GIA001',
    'Tiếng Việt',
    'Dòng một',
    'Dòng hai',
    '11/10/2026',
    'Học tập',
    'Không',
    '08:00:00',
  ])
    assert.ok(content.includes(phrase), phrase)
  for (let i = 0; i < 6; i++) assert.ok(content.includes('Trường ' + i))
  assert.ok(content.includes('<w:br/>'))
  assert.ok(!content.includes('{{fieldValue}}'))
  const before = unzipSync(template),
    after = unzipSync(output)
  assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort())
  for (const part of Object.keys(before).filter((part) => part !== 'word/document.xml'))
    assert.deepEqual(after[part], before[part], part)
  assert.deepEqual(fillSubmissionDocument(template, input), output)
})
test('template slots and XML cannot be injected through answers or labels', async () => {
  const input = sample()
  input.round.values.f0 = '<w:script> & " \u0001 {{serviceName}}'
  input.procedure.fields[0]!.label = '<nhãn> & thông tin'
  input.serviceName = '{{fieldValue}} & thủ tục'
  const content = xml(fillSubmissionDocument(await readFile(documentTemplatePath), input))
  assert.ok(content.includes('&lt;w:script&gt; &amp; &quot;'))
  assert.ok(content.includes('&lt;nhãn&gt; &amp; thông tin'))
  assert.ok(content.includes('{{serviceName}}'))
  assert.ok(content.includes('{{fieldValue}} &amp; thủ tục'))
  assert.ok(!content.includes('\u0001'))
})
test('fifty configured fields and full long answers are included without truncation', async () => {
  const input = sample(),
    long = 'Dữ liệu giả '.repeat(150)
  input.procedure.fields = Array.from({ length: 50 }, (_, i) => ({
    ...input.procedure.fields[0]!,
    key: 'answer' + i,
    label: 'Nhãn ' + i,
  }))
  input.round.values = Object.fromEntries(input.procedure.fields.map((f) => [f.key, long]))
  const content = xml(fillSubmissionDocument(await readFile(documentTemplatePath), input))
  assert.equal(content.split(long).length - 1, 50)
  assert.ok(content.includes('Nhãn 49'))
})
test('empty field list still produces a usable document', async () => {
  const input = sample()
  input.procedure.fields = []
  assert.ok(
    xml(fillSubmissionDocument(await readFile(documentTemplatePath), input)).includes(
      'Biểu mẫu không có trường kê khai.',
    ),
  )
})
test('export reads the requested frozen round during supplementation, then rechecks access', async () => {
  const input = sample(),
    second = { ...structuredClone(input.round), roundNumber: 2, values: { f0: 'Mới' } }
  let reads = 0,
    rendered: DocumentSnapshot | undefined
  const view = {
    ...input,
    rounds: [input.round, second],
    status: 'NEEDS_SUPPLEMENT',
    values: { f0: 'Đang sửa' },
  } as unknown as DraftView
  const repository = {
    get: () => {
      reads++
      return Promise.resolve(view)
    },
  } as unknown as SubmissionRepository
  const service = new SubmissionService(repository, {} as EvidenceStorage, {
    render: (snapshot) => {
      rendered = snapshot
      return Promise.resolve(Buffer.from('document'))
    },
  })
  const file = await service.documentDownload('owner', input.id, 1, 'docx')
  assert.equal(rendered?.round.values.f0, 'Tiếng Việt')
  assert.equal(reads, 2)
  assert.equal(
    file.mimeType,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  )
  assert.ok(file.name.endsWith('-lan-1.docx'))
  await assert.rejects(
    () => service.documentDownload('owner', input.id, 99, 'docx'),
    (e) => e instanceof SubmissionError && e.statusCode === 404,
  )
})
test('denied access never calls renderer; revoked access after conversion returns no bytes', async () => {
  const input = sample()
  let calls = 0,
    reads = 0
  const forbidden = new SubmissionError(403, 'FORBIDDEN', 'Từ chối')
  const renderer = {
    render: () => {
      calls++
      return Promise.resolve(Buffer.from('private'))
    },
  }
  const denied = new SubmissionService(
    { get: () => Promise.reject(forbidden) } as unknown as SubmissionRepository,
    {} as EvidenceStorage,
    renderer,
  )
  await assert.rejects(() => denied.documentDownload('other', input.id, 1, 'pdf'), forbidden)
  assert.equal(calls, 0)
  const repository = {
    reviewGet: () =>
      ++reads === 1
        ? Promise.resolve({ ...input, rounds: [input.round] })
        : Promise.reject(forbidden),
  } as unknown as SubmissionRepository
  const revoked = new SubmissionService(repository, {} as EvidenceStorage, renderer)
  await assert.rejects(
    () => revoked.documentDownload('reviewer', input.id, 1, 'pdf', true),
    forbidden,
  )
  assert.equal(reads, 2)
  assert.equal(calls, 1)
})
test('Word remains available when the PDF converter is unavailable', async () => {
  const unavailable = new SubmissionError(503, 'DOCUMENT_PDF_UNAVAILABLE', 'Thử lại')
  const renderer = new LocalSubmissionDocumentRenderer({
    convert: () => Promise.reject(unavailable),
  })
  const output = await renderer.render(sample(), 'docx')
  assert.ok(xml(output).includes('Nguyễn Minh An'))
  await assert.rejects(() => renderer.render(sample(), 'pdf'), unavailable)
})
test('PDF conversion has a concurrency bound and releases slots after failure', async () => {
  const converter = new LibreOfficePdfConverter('student-service-no-such-converter-123')
  const first = converter.convert(Buffer.from('fake')).catch((e) => e as unknown),
    second = converter.convert(Buffer.from('fake')).catch((e) => e as unknown)
  await assert.rejects(
    () => converter.convert(Buffer.from('fake')),
    (e) => e instanceof SubmissionError && e.code === 'DOCUMENT_BUSY',
  )
  for (const result of await Promise.all([first, second]))
    assert.ok(result instanceof SubmissionError && result.code === 'DOCUMENT_PDF_UNAVAILABLE')
  await assert.rejects(
    () => converter.convert(Buffer.from('fake')),
    (e) => e instanceof SubmissionError && e.code === 'DOCUMENT_PDF_UNAVAILABLE',
  )
})
test('conversion process timeout terminates the owned process', async () => {
  await assert.rejects(
    () => runDocumentConversion(process.execPath, ['-e', 'setInterval(()=>{},1000)'], 300),
    /DOCUMENT_CONVERSION_TIMEOUT/,
  )
})

test('each exported round lists its own evidence without implying signature validation', async () => {
  const input = sample()
  input.round.files = [
    {
      id: 'file',
      attachmentKey: 'proof',
      name: 'Minh chứng & giả.pdf',
      mimeType: 'application/pdf',
      size: 321,
      sha256: 'a'.repeat(64),
      signatureStatus: 'NOT_CHECKED',
    },
  ]
  const content = xml(fillSubmissionDocument(await readFile(documentTemplatePath), input))
  assert.ok(content.includes('Minh chứng &amp; giả.pdf'))
  assert.ok(content.includes('321 byte'))
  assert.ok(content.includes('Chữ ký chưa được xác minh.'))
  assert.ok(!content.includes('{{evidenceSummary}}'))
})
