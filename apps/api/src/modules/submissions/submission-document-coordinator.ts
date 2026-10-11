import { unzipSync, strFromU8 } from 'fflate'
import { isDeepStrictEqual } from 'node:util'
import type {
  DrizzleSubmissionDocumentRegistry,
  DocumentFailure,
  DocumentLease,
  PublishDocument,
  RegisteredDocument,
} from './submission-document-registry.repository.js'
import type {
  ConverterProvenance,
  RegistryFormat,
  RendererProvenance,
} from './submission-document-registry.schema.js'
import {
  type DocumentFormat,
  type DocumentSnapshot,
  type PdfConverter,
  type RenderedSubmissionDocuments,
  type SubmissionDocumentRenderer,
} from './submission-document.js'
import {
  type DocumentVault,
  documentDigest,
  maximumDocumentBytes,
} from './submission-document-vault.js'
import { SubmissionError } from './submission.types.js'

export type DocumentRegistry = Pick<
  DrizzleSubmissionDocumentRegistry,
  'ensureSet' | 'get' | 'claim' | 'publish' | 'fail'
>
export interface DocumentProvenance {
  renderer(): Promise<RendererProvenance>
  converter(): Promise<ConverterProvenance>
}
function unavailable(code = 'DOCUMENT_GENERATION_UNAVAILABLE') {
  return new SubmissionError(
    503,
    code,
    'Chưa tạo được phiếu. Bạn có thể thử lại sau; hồ sơ đã gửi vẫn được giữ nguyên.',
  )
}
function claimFailure(state: string) {
  return state === 'EXHAUSTED'
    ? new SubmissionError(
        503,
        'DOCUMENT_RETRY_EXHAUSTED',
        'Tạo phiếu đã hết lượt thử tự động. Cần cán bộ kiểm tra tác vụ; hồ sơ không cần gửi lại.',
      )
    : unavailable(state === 'BUSY' ? 'DOCUMENT_BUSY' : 'DOCUMENT_RETRY_LATER')
}
function sameBinding(
  a: DocumentSnapshot['round']['declarationTemplate'],
  b: DocumentSnapshot['round']['declarationTemplate'],
) {
  return a.id === b.id && a.sha256 === b.sha256 && a.bindingSource === b.bindingSource
}
function validateGeneratedWord(bytes: Buffer) {
  if (bytes.length < 1 || bytes.length > maximumDocumentBytes)
    throw new Error('INVALID_DOCUMENT_SIZE')
  let count = 0,
    expanded = 0
  const names = new Set<string>()
  const parts = unzipSync(bytes, {
    filter: (entry) => {
      if (
        ++count > 200 ||
        names.has(entry.name) ||
        !Number.isSafeInteger(entry.originalSize) ||
        entry.originalSize < 0 ||
        (expanded += entry.originalSize) > 32 * 1024 * 1024
      )
        throw new Error('INVALID_GENERATED_WORD')
      names.add(entry.name)
      return ['[Content_Types].xml', '_rels/.rels', 'word/document.xml'].includes(entry.name)
    },
  })
  if (
    !parts['[Content_Types].xml'] ||
    !parts['_rels/.rels'] ||
    !parts['word/document.xml'] ||
    !strFromU8(parts['word/document.xml']).includes('<w:document')
  )
    throw new Error('INVALID_GENERATED_WORD')
}
export class StoredSubmissionDocumentRenderer implements SubmissionDocumentRenderer {
  constructor(
    private readonly registry: DocumentRegistry,
    private readonly vault: DocumentVault,
    private readonly wordRenderer: Pick<SubmissionDocumentRenderer, 'render'>,
    private readonly pdfConverter: PdfConverter,
    private readonly provenance: DocumentProvenance,
  ) {}
  private async read(document: RegisteredDocument) {
    return this.vault.read(document.storageKey, { size: document.size, sha256: document.sha256 })
  }
  private async published(lease: DocumentLease, metadata: PublishDocument) {
    try {
      return await this.registry.publish(lease, metadata)
    } catch {
      // COMMIT may have succeeded. Only a matching registry row resolves uncertainty.
      let found: RegisteredDocument | undefined
      try {
        found = await this.registry.get(lease.setId, lease.format)
      } catch {
        throw unavailable('DOCUMENT_PUBLICATION_UNCERTAIN')
      }
      if (
        found &&
        found.attemptId === lease.attemptId &&
        found.storageKey === lease.attemptId &&
        found.sha256 === metadata.sha256 &&
        found.size === metadata.size &&
        sameBinding(found.template, metadata.template) &&
        isDeepStrictEqual(found.renderer, metadata.renderer) &&
        isDeepStrictEqual(found.converter, metadata.converter) &&
        found.sourceDocxSha256 === metadata.sourceDocxSha256
      )
        return found
      // No deletion and no retry here, even if another worker has already won.
      throw unavailable('DOCUMENT_PUBLICATION_UNCERTAIN')
    }
  }
  private async ensure(
    snapshot: DocumentSnapshot,
    setId: string,
    format: RegistryFormat,
    source?: RegisteredDocument,
  ): Promise<RegisteredDocument> {
    const result = await this.registry.claim(setId, format)
    if (result.state === 'READY') return result.document
    if (result.state !== 'CLAIMED') throw claimFailure(result.state)
    const lease = result.lease
    let failure: DocumentFailure = format === 'DOCX' ? 'RENDER_FAILED' : 'CONVERT_FAILED'
    let metadata: PublishDocument
    try {
      let bytes: Buffer,
        renderer: RendererProvenance,
        converter: ConverterProvenance | null = null
      if (format === 'DOCX') {
        renderer = await this.provenance.renderer()
        bytes = await this.wordRenderer.render(snapshot, 'docx')
        validateGeneratedWord(bytes)
        // Deployment mutation during rendering fails closed, rather than mislabeling loaded code.
        if (!isDeepStrictEqual(await this.provenance.renderer(), renderer))
          throw new Error('DOCUMENT_RUNTIME_CHANGED')
      } else {
        if (!source || source.setId !== setId || source.format !== 'DOCX')
          throw new Error('DOCUMENT_WORD_REQUIRED')
        const word = await this.read(source)
        renderer = structuredClone(source.renderer)
        converter = await this.provenance.converter()
        bytes = await this.pdfConverter.convert(word)
        // Recheck the committed source after the slow converter, before publishing its derivative.
        await this.read(source)
        if (!isDeepStrictEqual(await this.provenance.converter(), converter))
          throw new Error('DOCUMENT_RUNTIME_CHANGED')
        if (
          bytes.length < 100 ||
          bytes.subarray(0, 5).toString('ascii') !== '%PDF-' ||
          !bytes.subarray(-1024).includes(Buffer.from('%%EOF'))
        )
          throw new Error('INVALID_CONVERTED_PDF')
      }
      if (!bytes.length || bytes.length > maximumDocumentBytes)
        throw new Error('INVALID_DOCUMENT_SIZE')
      failure = 'STORAGE_FAILED'
      const digest = documentDigest(bytes),
        stored = await this.vault.put(lease.attemptId, bytes)
      if (stored.size !== digest.size || stored.sha256 !== digest.sha256)
        throw new Error('DOCUMENT_STORAGE_CHANGED')
      await this.vault.read(lease.attemptId, digest)
      metadata = {
        ...digest,
        template: { ...snapshot.round.declarationTemplate },
        renderer,
        converter,
        sourceDocxSha256: source?.sha256 ?? null,
      }
    } catch (error) {
      await this.registry.fail(lease, failure).catch(() => false)
      if (error instanceof SubmissionError) throw error
      throw unavailable(
        format === 'PDF' ? 'DOCUMENT_PDF_UNAVAILABLE' : 'DOCUMENT_GENERATION_UNAVAILABLE',
      )
    }
    // Publication uncertainty must never be turned into an ordinary failed/retryable job.
    return this.published(lease, metadata)
  }
  private async documents(snapshot: DocumentSnapshot, pdf: boolean) {
    // Freeze request data across await boundaries; the database supplies the binding.
    const frozen = structuredClone(snapshot)
    const set = await this.registry.ensureSet(frozen.id, frozen.round.roundNumber)
    if (!sameBinding(set.template, frozen.round.declarationTemplate))
      throw unavailable('DOCUMENT_TEMPLATE_UNAVAILABLE')
    const word = await this.ensure(frozen, set.id, 'DOCX')
    // Verify Word even if PDF is already registered. Never conceal corrupt source bytes.
    const docx = await this.read(word)
    if (!pdf) return { docx, template: { ...set.template } }
    const document = await this.ensure(frozen, set.id, 'PDF', word)
    if (
      document.sourceDocxSha256 !== word.sha256 ||
      !sameBinding(document.template, word.template) ||
      !isDeepStrictEqual(document.renderer, word.renderer)
    )
      throw unavailable('DOCUMENT_INTEGRITY')
    return { docx, pdf: await this.read(document), template: { ...set.template } }
  }
  async render(snapshot: DocumentSnapshot, format: DocumentFormat): Promise<Buffer> {
    const documents = await this.documents(snapshot, format === 'pdf')
    return format === 'docx' ? documents.docx : documents.pdf!
  }
  async renderPair(snapshot: DocumentSnapshot): Promise<RenderedSubmissionDocuments> {
    const documents = await this.documents(snapshot, true)
    return { ...documents, pdf: documents.pdf! }
  }
}
