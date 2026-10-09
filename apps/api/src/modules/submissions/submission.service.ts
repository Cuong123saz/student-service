import { createHash } from 'node:crypto'
import type { DrizzleSubmissionRepository } from './submission.repository.js'
import type { EvidenceStorage } from './submission.storage.js'
import { SubmissionError, type SubmissionActor, type DraftValues } from './submission.types.js'
import { inspectEvidence } from './submission.validation.js'
export type SubmissionRepository = Pick<
  DrizzleSubmissionRepository,
  'list' | 'get' | 'create' | 'save' | 'addFile' | 'removeFile' | 'file' | 'hasStoredFile'
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
          'Chưa xác định được kết quả lưu minh chứng. Hãy tải lại bản nháp để kiểm tra trước khi tải tệp lần nữa.',
        )
      }
      throw error
    }
  }
  async download(userId: string, id: string, fileId: string) {
    const file = await this.repository.file(userId, id, fileId)
    const bytes = await this.storage.read(file.key)
    if (createHash('sha256').update(bytes).digest('hex') !== file.sha256)
      throw new SubmissionError(
        503,
        'FILE_INTEGRITY',
        'Tệp lưu trữ không vượt qua kiểm tra toàn vẹn. Vui lòng liên hệ đơn vị xử lý.',
      )
    return { bytes, name: file.name, mimeType: file.mimeType }
  }
}
