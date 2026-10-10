import { createHash } from 'node:crypto'
import type { DrizzleSubmissionRepository } from './submission.repository.js'
import type { EvidenceStorage } from './submission.storage.js'
import {
  SubmissionError,
  integrityFailure,
  type SubmissionActor,
  type DraftValues,
  type StoredFileIntegrity,
} from './submission.types.js'
import { inspectEvidence } from './submission.validation.js'
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
>
export class SubmissionService {
  constructor(
    private readonly repository: SubmissionRepository,
    private readonly storage: EvidenceStorage,
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
  reviewList(userId: string, status?: 'SUBMITTED' | 'IN_REVIEW') {
    return this.repository.reviewList(userId, status)
  }
  reviewGet(userId: string, id: string) {
    return this.repository.reviewGet(userId, id)
  }
  claim(actor: SubmissionActor, id: string, revision: number) {
    return this.repository.claim(actor, id, revision)
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
  async reviewDownload(userId: string, id: string, fileId: string) {
    const file = await this.repository.reviewFile(userId, id, fileId)
    const bytes = await this.readVerified(file)
    await this.repository.reviewFile(userId, id, fileId)
    return { bytes, name: file.name, mimeType: file.mimeType }
  }
}
