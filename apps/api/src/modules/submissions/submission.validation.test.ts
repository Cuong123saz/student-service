import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import {
  completionIssues,
  inspectEvidence,
  MAX_FILE_BYTES,
  validateAnswers,
} from './submission.validation.js'
import { LocalEvidenceStorage } from './submission.storage.js'
import type { PublicProcedure } from '../procedures/procedure.contract.js'
const base = {
  source: 'STUDENT_INPUT' as const,
  profileKey: null,
  required: true,
  maxLength: 5,
  options: [],
}
const procedure: PublicProcedure = {
  versionId: 'test',
  versionNumber: 1,
  processingMode: 'ONLINE',
  processingUnitName: 'CTSV',
  contactInstructions: '',
  maxTotalAttachmentBytes: 100,
  fields: [
    {
      ...base,
      key: 'fullName',
      label: 'Họ tên',
      type: 'TEXT',
      source: 'PROFILE',
      profileKey: 'fullName',
    },
    { ...base, key: 'text', label: 'Nội dung', type: 'TEXT' },
    { ...base, key: 'number', label: 'Số', type: 'NUMBER' },
    { ...base, key: 'date', label: 'Ngày', type: 'DATE' },
    {
      ...base,
      key: 'choice',
      label: 'Chọn',
      type: 'SELECT',
      options: [{ value: 'a', label: 'A' }],
    },
    { ...base, key: 'flag', label: 'Có?', type: 'BOOLEAN' },
  ],
  attachments: [
    {
      key: 'proof',
      label: 'Minh chứng',
      required: true,
      mimeTypes: ['application/pdf'],
      maxFiles: 1,
      maxBytes: 100,
    },
  ],
}
test('partial drafts allow blanks, false and zero; completion distinguishes missing answers', () => {
  assert.deepEqual(validateAnswers(procedure, { flag: false, number: 0, text: null }), [])
  const issues = completionIssues(
    procedure,
    { fullName: 'An', flag: false, number: 0, text: '  ' },
    [],
  )
  assert.ok(issues.some((i) => i.path === 'values.text'))
  assert.ok(issues.some((i) => i.path === 'attachments.proof'))
  assert.ok(!issues.some((i) => ['values.flag', 'values.number'].includes(i.path)))
})
test('reject profile overrides, unknown keys, wrong types, impossible dates, options and length', () => {
  for (const values of [
    { fullName: 'Fake' },
    { extra: 'x' },
    { number: '3' },
    { number: Infinity },
    { flag: 'false' },
    { date: '2025-02-29' },
    { date: '2026-13-01' },
    { date: '2026-2-01' },
    { choice: 'b' },
    { text: '123456' },
  ])
    assert.equal(validateAnswers(procedure, values).length, 1, JSON.stringify(values))
  assert.deepEqual(validateAnswers(procedure, { date: '2024-02-29', choice: 'a' }), [])
})
test('file bytes, extension and declared media type must agree; filenames never become paths', () => {
  const bytes = Buffer.from('%PDF-1.4\nexample')
  const meta = inspectEvidence(bytes, '..\\folder/giấy.pdf', 'application/pdf')
  assert.equal(meta.name, 'giấy.pdf')
  assert.equal(meta.sha256.length, 64)
  assert.throws(() => inspectEvidence(Buffer.from('<html>'), 'proof.pdf', 'application/pdf'))
  assert.throws(() => inspectEvidence(bytes, 'proof.png', 'image/png'))
  assert.throws(() => inspectEvidence(bytes, 'proof.pdf', 'image/png'))
  assert.throws(() => inspectEvidence(Buffer.alloc(0), 'proof.pdf', 'application/pdf'))
  assert.throws(() =>
    inspectEvidence(Buffer.alloc(MAX_FILE_BYTES + 1), 'proof.pdf', 'application/pdf'),
  )
})
test('private storage generates separate keys, preserves bytes and rejects traversal', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'student-evidence-'))
  t.after(() => {
    assert.equal(dirname(root), resolve(tmpdir()))
    assert.ok(root.startsWith(join(resolve(tmpdir()), 'student-evidence-')))
    return rm(root, { recursive: true, force: true })
  })
  const storage = new LocalEvidenceStorage(root)
  const bytes = Buffer.from('original bytes')
  const first = await storage.put(bytes),
    second = await storage.put(bytes)
  assert.notEqual(first, second)
  assert.deepEqual(await storage.read(first), bytes)
  await assert.rejects(async () => storage.read('../secret'))
  await storage.remove(first)
  assert.deepEqual(await readdir(root), [second])
})
test('trusted profile values still obey field type and length limits during final submission validation', () => {
  assert.deepEqual(validateAnswers(procedure, { fullName: 'An' }, true), [])
  assert.equal(
    validateAnswers(procedure, { fullName: 'Too long' }, true)[0]?.path,
    'values.fullName',
  )
  assert.equal(validateAnswers(procedure, { fullName: 42 }, true)[0]?.path, 'values.fullName')
  assert.equal(validateAnswers(procedure, { fullName: 'An' })[0]?.path, 'values.fullName')
})
