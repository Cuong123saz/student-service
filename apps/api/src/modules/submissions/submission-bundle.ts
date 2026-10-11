import type { DeclarationTemplateBinding } from './submission-document-template.js'
import { createHash } from 'node:crypto'
import { zipSync, strToU8 } from 'fflate'
import type { DocumentSnapshot, RenderedSubmissionDocuments } from './submission-document.js'
import { documentMimeTypes } from './submission-document.js'
import { SubmissionError, integrityFailure, type EvidenceView } from './submission.types.js'

export const bundleLimits = {
  evidenceBytes: 20 * 1024 * 1024,
  totalBytes: 40 * 1024 * 1024,
  files: 150,
}
export const evidenceExtensions: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
}
export interface BundleEntry {
  path: string
  kind: 'DECLARATION_WORD' | 'DECLARATION_PDF' | 'EVIDENCE' | 'INSTRUCTIONS'
  mimeType: string
  size: number
  sha256: string
  fileId?: string
  attachmentKey?: string
  originalName?: string
  signatureStatus?: 'NOT_CHECKED'
}
export interface SubmissionBundleManifest {
  schema: 'student-service.submission-bundle'
  version: 1
  generatedAt: string
  submissionId: string
  roundNumber: number
  submittedAt: string
  roundSource: 'LIVE' | 'MIGRATION'
  procedureVersionId: string
  procedureVersionNumber: number
  template: {
    id: string
    sha256: string
    bindingSource?: DeclarationTemplateBinding['bindingSource']
  }
  documentStatus: 'UNSIGNED_DECLARATION'
  signatureStatus: 'NOT_CHECKED'
  integrityAlgorithm: 'SHA-256'
  files: BundleEntry[]
}
export function validateBundleEvidence(files: EvidenceView[]) {
  let total = 0
  const ids = new Set<string>()
  if (files.length > bundleLimits.files) throw integrityFailure()
  for (const file of files) {
    if (
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(file.id) ||
      ids.has(file.id) ||
      !Object.hasOwn(evidenceExtensions, file.mimeType) ||
      !Number.isSafeInteger(file.size) ||
      file.size < 1 ||
      file.size > 5 * 1024 * 1024 ||
      !/^[a-f0-9]{64}$/.test(file.sha256)
    )
      throw integrityFailure()
    ids.add(file.id)
    total += file.size
  }
  if (total > bundleLimits.evidenceBytes) throw integrityFailure()
}
export function buildSubmissionBundle(
  snapshot: DocumentSnapshot,
  documents: RenderedSubmissionDocuments,
  evidence: { file: EvidenceView; bytes: Buffer }[],
) {
  if (
    documents.template.id !== snapshot.round.declarationTemplate.id ||
    documents.template.sha256 !== snapshot.round.declarationTemplate.sha256 ||
    documents.template.bindingSource !== snapshot.round.declarationTemplate.bindingSource
  )
    throw new SubmissionError(
      503,
      'DOCUMENT_TEMPLATE_UNAVAILABLE',
      'Phiên bản mẫu của phiếu không khớp lần gửi đã chọn.',
    )
  const parts: Record<string, Uint8Array> = {},
    entries: BundleEntry[] = []
  let total = 0
  function add(
    path: string,
    bytes: Uint8Array,
    entry: Omit<BundleEntry, 'path' | 'size' | 'sha256'>,
  ) {
    total += bytes.length
    if (total > bundleLimits.totalBytes)
      throw new SubmissionError(
        503,
        'BUNDLE_TOO_LARGE',
        'Gói hồ sơ vượt giới hạn tải. Vui lòng tải Word, PDF và minh chứng riêng.',
      )
    parts[path] = bytes
    entries.push({
      ...entry,
      path,
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    })
  }
  add('phieu-ho-so.docx', documents.docx, {
    kind: 'DECLARATION_WORD',
    mimeType: documentMimeTypes.docx,
  })
  add('phieu-ho-so.pdf', documents.pdf, {
    kind: 'DECLARATION_PDF',
    mimeType: documentMimeTypes.pdf,
  })
  evidence.forEach(({ file, bytes }, index) => {
    add(
      'minh-chung/' +
        String(index + 1).padStart(3, '0') +
        '-' +
        file.id +
        '.' +
        evidenceExtensions[file.mimeType],
      bytes,
      {
        kind: 'EVIDENCE',
        mimeType: file.mimeType,
        fileId: file.id,
        attachmentKey: file.attachmentKey,
        originalName: file.name,
        signatureStatus: 'NOT_CHECKED',
      },
    )
  })
  add(
    'HUONG-DAN.txt',
    strToU8(
      [
        'GÓI HỒ SƠ - LẦN GỬI ' + snapshot.round.roundNumber,
        'Mã hồ sơ: ' + snapshot.id,
        'Word và PDF là bản kê khai chưa ký, chưa phải văn bản được cấp.',
        'Minh chứng được giữ nguyên byte của lần gửi. Tên gốc được ghi trong manifest.json.',
        'manifest.json liệt kê kích thước và SHA-256 của các tệp trong gói.',
        'SHA-256 giúp phát hiện thay đổi so với danh sách này; không xác minh người ký, nguồn phát hành hoặc hiệu lực pháp lý.',
        'Nếu cả tệp và manifest cùng bị thay đổi, mã kiểm tra trong gói không chứng minh được nguồn gốc.',
        'Chữ ký của minh chứng chưa được xác minh. Không coi ảnh dấu đỏ/chữ ký là kết quả xác minh.',
        'Gói chỉ chứa lần gửi đã chọn, không gồm bản đang sửa, quyết định xử lý hoặc thông tin của lần gửi khác.',
        '',
      ].join('\r\n'),
    ),
    { kind: 'INSTRUCTIONS', mimeType: 'text/plain; charset=utf-8' },
  )
  const manifest: SubmissionBundleManifest = {
    schema: 'student-service.submission-bundle',
    version: 1,
    generatedAt: new Date().toISOString(),
    submissionId: snapshot.id,
    roundNumber: snapshot.round.roundNumber,
    submittedAt: snapshot.round.submittedAt,
    roundSource: snapshot.round.source,
    procedureVersionId: snapshot.procedure.versionId,
    procedureVersionNumber: snapshot.procedure.versionNumber,
    template: documents.template,
    documentStatus: 'UNSIGNED_DECLARATION',
    signatureStatus: 'NOT_CHECKED',
    integrityAlgorithm: 'SHA-256',
    files: entries,
  }
  parts['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2) + '\n')
  // Evidence and Office/PDF files are already compressed. Store without recompression.
  return Buffer.from(zipSync(parts, { level: 0, mtime: new Date('1980-01-01T00:00:00Z') }))
}
