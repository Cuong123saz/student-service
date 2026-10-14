import { createHash, randomUUID } from 'node:crypto'

export const mockSignatureNotice = 'DEMO – KHÔNG CÓ GIÁ TRỊ PHÁP LÝ'
const provider = 'MOCK_SIGNATURE_V1' as const
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const hash = /^[a-f0-9]{64}$/
const maximum = 16 * 1024 * 1024
export interface SignatureDocument {
  documentId: string
  submissionId: string
  roundId: string
  format: 'DOCX' | 'PDF'
  size: number
  sha256: string
}
export interface SignatureInput {
  document: SignatureDocument
  actorId: string
  bytes: Buffer
}
export interface MockSignatureReceipt {
  version: 1
  provider: typeof provider
  receiptId: string
  simulatedAt: string
  notice: typeof mockSignatureNotice
  fakeDataOnly: true
  actorId: string
  document: SignatureDocument
}
export interface SignatureVerification {
  outcome: 'SIMULATION_MATCH' | 'SIMULATION_MISMATCH'
  reason:
    | 'MATCH'
    | 'RECEIPT_INVALID'
    | 'RECEIPT_CHANGED'
    | 'DOCUMENT_CHANGED'
    | 'BINDING_CHANGED'
    | 'ACTOR_CHANGED'
  technicalSignatureStatus: 'NOT_VERIFIED'
  legalEffect: false
  notice: typeof mockSignatureNotice
}
export interface SignatureProvider {
  sign(input: SignatureInput): Promise<MockSignatureReceipt>
  verify(
    receipt: unknown,
    input: SignatureInput,
    trustedReceiptSha256: string,
  ): Promise<SignatureVerification>
}
const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')
function object(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype
  )
}
function keys(value: Record<string, unknown>, expected: string[]) {
  return (
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  )
}
function isDocument(value: unknown): value is SignatureDocument {
  return (
    object(value) &&
    keys(value, ['documentId', 'submissionId', 'roundId', 'format', 'size', 'sha256']) &&
    ['documentId', 'submissionId', 'roundId'].every(
      (key) => typeof value[key] === 'string' && uuid.test(value[key]),
    ) &&
    (value.format === 'DOCX' || value.format === 'PDF') &&
    Number.isSafeInteger(value.size) &&
    Number(value.size) > 0 &&
    Number(value.size) <= maximum &&
    typeof value.sha256 === 'string' &&
    hash.test(value.sha256)
  )
}
function binding(document: SignatureDocument): SignatureDocument {
  return {
    documentId: document.documentId,
    submissionId: document.submissionId,
    roundId: document.roundId,
    format: document.format,
    size: document.size,
    sha256: document.sha256,
  }
}
function validInput(input: SignatureInput) {
  if (
    !input ||
    !isDocument(input.document) ||
    typeof input.actorId !== 'string' ||
    !uuid.test(input.actorId) ||
    !Buffer.isBuffer(input.bytes) ||
    input.bytes.length < 1 ||
    input.bytes.length > maximum
  )
    throw new Error('INVALID_MOCK_SIGNATURE_INPUT')
}
function isReceipt(value: unknown): value is MockSignatureReceipt {
  return (
    object(value) &&
    keys(value, [
      'version',
      'provider',
      'receiptId',
      'simulatedAt',
      'notice',
      'fakeDataOnly',
      'actorId',
      'document',
    ]) &&
    value.version === 1 &&
    value.provider === provider &&
    value.notice === mockSignatureNotice &&
    value.fakeDataOnly === true &&
    typeof value.receiptId === 'string' &&
    uuid.test(value.receiptId) &&
    typeof value.actorId === 'string' &&
    uuid.test(value.actorId) &&
    typeof value.simulatedAt === 'string' &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.simulatedAt) &&
    Number.isFinite(Date.parse(value.simulatedAt)) &&
    new Date(value.simulatedAt).toISOString() === value.simulatedAt &&
    isDocument(value.document)
  )
}
// This checksum must be pinned by a trusted caller. It is never a digital signature.
export function mockReceiptSha256(receipt: unknown): string {
  if (!isReceipt(receipt)) throw new Error('INVALID_MOCK_SIGNATURE_RECEIPT')
  return digest(
    JSON.stringify({
      version: receipt.version,
      provider: receipt.provider,
      receiptId: receipt.receiptId,
      simulatedAt: receipt.simulatedAt,
      notice: receipt.notice,
      fakeDataOnly: receipt.fakeDataOnly,
      actorId: receipt.actorId,
      document: binding(receipt.document),
    }),
  )
}
export class MockSignatureProvider implements SignatureProvider {
  constructor(options: { fakeDataOnly: true }) {
    if (options?.fakeDataOnly !== true) throw new Error('MOCK_SIGNATURE_REQUIRES_FAKE_DATA')
  }
  async sign(input: SignatureInput): Promise<MockSignatureReceipt> {
    validInput(input)
    if (input.bytes.length !== input.document.size || digest(input.bytes) !== input.document.sha256)
      throw new Error('MOCK_SIGNATURE_DOCUMENT_CHANGED')
    return Object.freeze({
      version: 1,
      provider,
      receiptId: randomUUID(),
      simulatedAt: new Date().toISOString(),
      notice: mockSignatureNotice,
      fakeDataOnly: true,
      actorId: input.actorId,
      document: Object.freeze(binding(input.document)),
    })
  }
  async verify(
    receipt: unknown,
    input: SignatureInput,
    trustedReceiptSha256: string,
  ): Promise<SignatureVerification> {
    validInput(input)
    if (typeof trustedReceiptSha256 !== 'string' || !hash.test(trustedReceiptSha256))
      throw new Error('INVALID_MOCK_RECEIPT_PIN')
    let reason: SignatureVerification['reason'] = 'MATCH'
    if (!isReceipt(receipt)) reason = 'RECEIPT_INVALID'
    else if (mockReceiptSha256(receipt) !== trustedReceiptSha256) reason = 'RECEIPT_CHANGED'
    else if (input.actorId !== receipt.actorId) reason = 'ACTOR_CHANGED'
    else if (JSON.stringify(binding(input.document)) !== JSON.stringify(binding(receipt.document)))
      reason = 'BINDING_CHANGED'
    else if (
      input.bytes.length !== input.document.size ||
      digest(input.bytes) !== input.document.sha256
    )
      reason = 'DOCUMENT_CHANGED'
    return {
      outcome: reason === 'MATCH' ? 'SIMULATION_MATCH' : 'SIMULATION_MISMATCH',
      reason,
      technicalSignatureStatus: 'NOT_VERIFIED',
      legalEffect: false,
      notice: mockSignatureNotice,
    }
  }
}
