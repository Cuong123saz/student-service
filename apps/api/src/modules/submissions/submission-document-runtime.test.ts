import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  LocalSubmissionDocumentRenderer,
  type SubmissionDocumentRenderer,
} from './submission-document.js'
import { checkSubmissionDocumentRuntime } from './submission-document-runtime.js'
import { SubmissionError } from './submission.types.js'
const fakePdf = Buffer.from('%PDF-1.7\n' + '.'.repeat(120) + '\n%%EOF')
test('runtime probe fills six field types using synthetic data and verifies Word/PDF readiness', async () => {
  const result = await checkSubmissionDocumentRuntime(
    new LocalSubmissionDocumentRenderer({ convert: async () => fakePdf }),
  )
  assert.equal(result.status, 'READY')
  assert.equal(result.fakeDataOnly, true)
  assert.equal(result.word.ready, true)
  assert.equal(result.pdf.ready, true)
  assert.ok(!JSON.stringify(result).includes('Nguyễn Ánh'))
  assert.ok(!JSON.stringify(result).includes('TEST-ONLY'))
})
test('converter failure reports Word only without exposing a command, secret or private path', async () => {
  const result = await checkSubmissionDocumentRuntime(
    new LocalSubmissionDocumentRenderer({
      convert: async () => {
        throw new Error('secret path')
      },
    }),
  )
  assert.equal(result.status, 'WORD_ONLY')
  assert.equal(result.word.ready, true)
  assert.equal(result.pdf.ready, false)
  assert.equal(result.pdf.code, 'DOCUMENT_CHECK_FAILED')
  assert.ok(!JSON.stringify(result).includes('secret path'))
})
test('runtime probe stops before conversion when the template is unavailable', async () => {
  let pairCalls = 0
  const renderer: SubmissionDocumentRenderer = {
    render: async () => {
      throw new SubmissionError(503, 'DOCUMENT_TEMPLATE_UNAVAILABLE', 'private path')
    },
    renderPair: async () => {
      pairCalls++
      throw new Error('unexpected')
    },
  }
  const result = await checkSubmissionDocumentRuntime(renderer)
  assert.equal(result.status, 'UNAVAILABLE')
  assert.equal(result.word.code, 'DOCUMENT_TEMPLATE_UNAVAILABLE')
  assert.equal(pairCalls, 0)
})
test('runtime probe rejects an invalid PDF or a pair converted from a different Word', async () => {
  const local = new LocalSubmissionDocumentRenderer({ convert: async () => fakePdf })
  for (const changed of ['pdf', 'word'] as const) {
    const renderer: SubmissionDocumentRenderer = {
      render: (snapshot, format) => local.render(snapshot, format),
      renderPair: async (snapshot) => {
        const pair = await local.renderPair(snapshot)
        if (changed === 'pdf') pair.pdf = Buffer.from('bad')
        else pair.docx = Buffer.from('changed')
        return pair
      },
    }
    const report = await checkSubmissionDocumentRuntime(renderer)
    assert.equal(report.status, 'WORD_ONLY')
    assert.equal(report.pdf.code, 'DOCUMENT_CHECK_FAILED')
  }
})
