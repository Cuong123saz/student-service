import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { test } from 'node:test'
import {
  MockSignatureProvider,
  mockReceiptSha256,
  mockSignatureNotice,
  type SignatureInput,
} from './signature-provider.js'
const provider = new MockSignatureProvider({ fakeDataOnly: true })
function input(format: 'DOCX' | 'PDF' = 'PDF'): SignatureInput {
  const bytes = Buffer.from(format === 'PDF' ? '%PDF-1.7 fake only' : 'PK fake only')
  return {
    bytes,
    actorId: randomUUID(),
    document: {
      documentId: randomUUID(),
      submissionId: randomUUID(),
      roundId: randomUUID(),
      format,
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
  }
}
test('mock adapter refuses absent or false fake-data opt-in', () => {
  for (const options of [undefined, {}, { fakeDataOnly: false }, { fakeDataOnly: 'true' }])
    assert.throws(() => Reflect.construct(MockSignatureProvider, [options]), /REQUIRES_FAKE_DATA/)
})
for (const format of ['DOCX', 'PDF'] as const)
  test(
    format + ' simulation preserves bytes and never reports a valid digital signature',
    async () => {
      const value = input(format),
        before = Buffer.from(value.bytes),
        receipt = await provider.sign(value)
      const result = await provider.verify(receipt, value, mockReceiptSha256(receipt))
      assert.equal(result.outcome, 'SIMULATION_MATCH')
      assert.equal(result.technicalSignatureStatus, 'NOT_VERIFIED')
      assert.equal(result.legalEffect, false)
      assert.equal(receipt.notice, mockSignatureNotice)
      assert.equal(Object.isFrozen(receipt.document), true)
      assert.deepEqual(value.bytes, before)
      assert.equal('signature' in receipt, false)
    },
  )
test('changed bytes or size refuse signing, and verification identifies document change', async () => {
  const value = input(),
    receipt = await provider.sign(value),
    pin = mockReceiptSha256(receipt)
  const changed = { ...value, bytes: Buffer.from(value.bytes) }
  changed.bytes[0] = 0
  await assert.rejects(provider.sign(changed), /DOCUMENT_CHANGED/)
  assert.equal((await provider.verify(receipt, changed, pin)).reason, 'DOCUMENT_CHANGED')
  await assert.rejects(
    provider.sign({ ...value, bytes: Buffer.concat([value.bytes, Buffer.from('x')]) }),
    /DOCUMENT_CHANGED/,
  )
})
test('round, submission, document and format cannot be substituted even with the same bytes', async () => {
  const value = input(),
    receipt = await provider.sign(value),
    pin = mockReceiptSha256(receipt)
  for (const change of [
    { roundId: randomUUID() },
    { submissionId: randomUUID() },
    { documentId: randomUUID() },
    { format: 'DOCX' as const },
  ]) {
    const result = await provider.verify(
      receipt,
      { ...value, document: { ...value.document, ...change } },
      pin,
    )
    assert.equal(result.outcome, 'SIMULATION_MISMATCH')
    assert.equal(result.reason, 'BINDING_CHANGED')
  }
})
test('a different actor cannot reuse another actor receipt', async () => {
  const value = input(),
    receipt = await provider.sign(value)
  assert.equal(
    (
      await provider.verify(
        receipt,
        { ...value, actorId: randomUUID() },
        mockReceiptSha256(receipt),
      )
    ).reason,
    'ACTOR_CHANGED',
  )
})
test('receipt metadata tamper is detected against the caller pinned receipt', async () => {
  const value = input(),
    receipt = await provider.sign(value),
    pin = mockReceiptSha256(receipt)
  for (const changed of [
    { ...receipt, actorId: randomUUID() },
    { ...receipt, receiptId: randomUUID() },
    { ...receipt, simulatedAt: '2026-01-01T00:00:00.000Z' },
  ])
    assert.equal((await provider.verify(changed, value, pin)).reason, 'RECEIPT_CHANGED')
})
test('unsupported receipts, hidden warnings and purported validity cannot pass', async () => {
  const value = input(),
    receipt = await provider.sign(value),
    pin = mockReceiptSha256(receipt)
  for (const changed of [
    null,
    [],
    {},
    { ...receipt, notice: '' },
    { ...receipt, fakeDataOnly: false },
    { ...receipt, legalEffect: true },
    { ...receipt, provider: 'REMOTE' },
    { ...receipt, document: { ...receipt.document, format: { toString: () => 'PDF' } } },
    { ...receipt, simulatedAt: '2026-02-30T00:00:00.000Z' },
    { ...receipt, document: { ...receipt.document, extra: true } },
  ]) {
    assert.equal((await provider.verify(changed, value, pin)).reason, 'RECEIPT_INVALID')
    assert.throws(() => mockReceiptSha256(changed), /INVALID_MOCK_SIGNATURE_RECEIPT/)
  }
})
test('receipt JSON field order does not alter the pinned representation', async () => {
  const value = input(),
    receipt = await provider.sign(value)
  const reordered: unknown = JSON.parse(
    JSON.stringify(Object.fromEntries(Object.entries(receipt).reverse())),
  )
  assert.equal(
    (await provider.verify(reordered, value, mockReceiptSha256(receipt))).outcome,
    'SIMULATION_MATCH',
  )
})
test('invalid bindings, actor and bounded inputs fail before creating a receipt', async () => {
  const value = input()
  for (const changed of [
    { ...value, actorId: 'ADMIN' },
    { ...value, bytes: Buffer.alloc(0) },
    { ...value, bytes: Buffer.alloc(16 * 1024 * 1024 + 1) },
    { ...value, document: { ...value.document, size: 0 } },
    { ...value, document: { ...value.document, sha256: 'f'.repeat(63) } },
    { ...value, document: { ...value.document, roundId: '../outside' } },
  ])
    await assert.rejects(provider.sign(changed), /INVALID_MOCK_SIGNATURE_INPUT/)
})
test('missing trusted receipt pin is rejected rather than trusting the submitted receipt', async () => {
  const value = input(),
    receipt = await provider.sign(value)
  for (const pin of ['', 'checksum', 'a'.repeat(65)])
    await assert.rejects(provider.verify(receipt, value, pin), /INVALID_MOCK_RECEIPT_PIN/)
})
