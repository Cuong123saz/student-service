import { createHash } from 'node:crypto'
import type { DrizzleSubmissionRepository } from './submission.repository.js'
import type { EvidenceStorage } from './submission.storage.js'
import {
  SubmissionError,
  integrityFailure,
  type SubmissionActor,
  type DraftValues,
  type StoredFileIntegrity,
  type ReviewQueueQuery,
  type ResolutionAction,
} from './submission.types.js'
import {
  LocalSubmissionDocumentRenderer,
  documentMimeTypes,
  type SubmissionDocumentRenderer,
  type DocumentFormat,
} from './submission-document.js'
import { inspectEvidence } from './submission.validation.js'
import { buildSubmissionBundle, validateBundleEvidence } from './submission-bundle.js'
export type SubmissionRepository = Pick<
  DrizzleSubmissionRepository,
  | 'list'
  | 'get'
  | 'create'
  | 'save'
  | 'addFile'
  | 'removeFile'
  | 'file'
  | 'hasStoredFile'
  | 'submit'
  | 'reviewList'
  | 'reviewGet'
  | 'claim'
  | 'reviewFile'
  | 'resolve'
  | 'assignees'
  | 'reassign'
  | 'roundFile'
  | 'reviewRoundFile'
>
export class SubmissionService {
  private activeBundles = 0
  constructor(
    private readonly repository: SubmissionRepository,
    private readonly storage: EvidenceStorage,
    private readonly documents: SubmissionDocumentRenderer = new LocalSubmissionDocumentRenderer(),
  ) {}
  list(userId: string) {
    return this.repository.list(userId)
  }
  get(userId: string, id: string) {
    return this.repository.get(userId, id)
  }
  create(actor: SubmissionActor, serviceId: number, versionId: string) {
    return this.repository.create(actor, serviceId, versionId)
  }
  save(actor: SubmissionActor, id: string, revision: number, values: DraftValues) {
    return this.repository.save(actor, id, revision, values)
  }
  remove(actor: SubmissionActor, id: string, revision: number, fileId: string) {
    return this.repository.removeFile(actor, id, revision, fileId)
  }
  submit(actor: SubmissionActor, id: string, revision: number) {
    // The repository calls this before committing, while holding service/draft locks.
    return this.repository.submit(actor, id, revision, async (files) => {
      for (const file of files) await this.readVerified(file)
    })
  }
  reviewList(userId: string, query: ReviewQueueQuery = {}) {
    return this.repository.reviewList(userId, query)
  }
  reviewGet(userId: string, id: string) {
    return this.repository.reviewGet(userId, id)
  }
  claim(actor: SubmissionActor, id: string, revision: number) {
    return this.repository.claim(actor, id, revision)
  }
  resolve(
    actor: SubmissionActor,
    id: string,
    revision: number,
    action: ResolutionAction,
    note: string,
  ) {
    return this.repository.resolve(actor, id, revision, action, note)
  }
  assignees(userId: string, id: string) {
    return this.repository.assignees(userId, id)
  }
  reassign(
    actor: SubmissionActor,
    id: string,
    revision: number,
    reviewerUserId: string,
    note: unknown,
  ) {
    return this.repository.reassign(actor, id, revision, reviewerUserId, note)
  }
  async documentDownload(
    userId: string,
    id: string,
    roundNumber: number,
    format: DocumentFormat,
    review = false,
  ) {
    const read = () =>
      review ? this.repository.reviewGet(userId, id) : this.repository.get(userId, id)
    const view = await read()
    const round = view.rounds.find((item) => item.roundNumber === roundNumber)
    if (!round) throw new SubmissionError(404, 'NOT_FOUND', 'Không tìm thấy lần gửi hồ sơ.')
    const bytes = await this.documents.render(
      { id, serviceName: view.serviceName, procedure: view.procedure, round },
      format,
    )
    // Conversion may be slow. Check current ownership/role/scope again before returning private data.
    await read()
    return {
      bytes,
      name: 'phieu-ho-so-' + id + '-lan-' + roundNumber + '.' + format,
      mimeType: documentMimeTypes[format],
    }
  }
  async bundleDownload(userId: string, id: string, roundNumber: number, review = false) {
    const read = () =>
      review ? this.repository.reviewGet(userId, id) : this.repository.get(userId, id)
    // Deny inaccessible requests before reserving capacity or reading private bytes.
    const view = await read()
    const round = view.rounds.find((item) => item.roundNumber === roundNumber)
    if (!round) throw new SubmissionError(404, 'NOT_FOUND', 'Không tìm thấy lần gửi hồ sơ.')
    validateBundleEvidence(round.files)
    if (this.activeBundles >= 2)
      throw new SubmissionError(
        503,
        'BUNDLE_BUSY',
        'Máy chủ đang chuẩn bị nhiều gói hồ sơ. Vui lòng thử lại sau.',
      )
    this.activeBundles++
    try {
      const evidence = []
      for (const file of round.files) {
        const stored = review
          ? await this.repository.reviewRoundFile(userId, id, roundNumber, file.id)
          : await this.repository.roundFile(userId, id, roundNumber, file.id)
        if (
          stored.size !== file.size ||
          stored.sha256 !== file.sha256 ||
          stored.mimeType !== file.mimeType
        )
          throw integrityFailure()
        evidence.push({ file, bytes: await this.readVerified(stored) })
      }
      const snapshot = { id, serviceName: view.serviceName, procedure: view.procedure, round }
      // PDF is converted from the exact Word included in this package.
      const documents = await this.documents.renderPair(snapshot)
      const bytes = buildSubmissionBundle(snapshot, documents, evidence)
      // Scope can be revoked during conversion; return no bytes in that case.
      await read()
      return {
        bytes,
        name: 'goi-ho-so-' + id + '-lan-' + roundNumber + '.zip',
        mimeType: 'application/zip',
      }
    } finally {
      this.activeBundles--
    }
  }
  async upload(
    actor: SubmissionActor,
    id: string,
    revision: number,
    attachmentKey: string,
    bytes: Buffer,
    name: string,
    mime: string,
  ) {
    const metadata = inspectEvidence(bytes, name, mime)
    const key = await this.storage.put(bytes)
    try {
      return await this.repository.addFile(actor, id, revision, attachmentKey, { ...metadata, key })
    } catch (error) {
      try {
        if (await this.repository.hasStoredFile(key)) {
          throw new Error('Upload committed but its response was lost', { cause: error })
        }
        await this.storage.remove(key)
      } catch {
        // Preserve original bytes if the database cannot prove that the object is unlinked.
        throw new SubmissionError(
          503,
          'STORAGE_RECONCILIATION',
          'Chưa xác định được kết quả lưu minh chứng. Hãy tải lại hồ sơ để kiểm tra trước khi tải tệp lần nữa.',
        )
      }
      throw error
    }
  }
  private async readVerified(file: StoredFileIntegrity) {
    let bytes: Buffer
    try {
      bytes = await this.storage.read(file.key)
    } catch {
      throw integrityFailure()
    }
    if (
      bytes.length !== file.size ||
      createHash('sha256').update(bytes).digest('hex') !== file.sha256
    )
      throw integrityFailure()
    return bytes
  }
  async download(userId: string, id: string, fileId: string) {
    const file = await this.repository.file(userId, id, fileId)
    const bytes = await this.readVerified(file)
    // Storage may be slow: eligibility or linkage can change before bytes are returned.
    await this.repository.file(userId, id, fileId)
    return { bytes, name: file.name, mimeType: file.mimeType }
  }
  async roundDownload(userId: string, id: string, roundNumber: number, fileId: string) {
    const file = await this.repository.roundFile(userId, id, roundNumber, fileId)
    const bytes = await this.readVerified(file)
    await this.repository.roundFile(userId, id, roundNumber, fileId)
    return { bytes, name: file.name, mimeType: file.mimeType }
  }
  async reviewRoundDownload(userId: string, id: string, roundNumber: number, fileId: string) {
    const file = await this.repository.reviewRoundFile(userId, id, roundNumber, fileId)
    const bytes = await this.readVerified(file)
    await this.repository.reviewRoundFile(userId, id, roundNumber, fileId)
    return { bytes, name: file.name, mimeType: file.mimeType }
  }
  async reviewDownload(userId: string, id: string, fileId: string) {
    const file = await this.repository.reviewFile(userId, id, fileId)
    const bytes = await this.readVerified(file)
    await this.repository.reviewFile(userId, id, fileId)
    return { bytes, name: file.name, mimeType: file.mimeType }
  }
}
