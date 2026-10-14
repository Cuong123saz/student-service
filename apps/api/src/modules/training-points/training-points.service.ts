import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { LocalEvidenceStorage, type EvidenceStorage } from '../submissions/submission.storage.js'
import { inspectEvidence } from '../submissions/submission.validation.js'
import { SubmissionError } from '../submissions/submission.types.js'
import { TrainingPointRepository } from './training-points.repository.js'
import type { Group } from './training-points.types.js'
export class TrainingPointService {
  constructor(
    readonly repository = new TrainingPointRepository(),
    private readonly storage: EvidenceStorage = new LocalEvidenceStorage(
      resolve(process.env.SUBMISSION_STORAGE_ROOT || '.local/submission-files', 'training-points'),
    ),
  ) {}
  async upload(
    user: string,
    id: string,
    criterion: Group,
    expectedRevision: number,
    requestId: string,
    bytes: Buffer,
    name: string,
    mime: string,
  ) {
    const before = await this.repository.detail(user, id)
    if (!before.editable)
      throw new SubmissionError(409, 'TRAINING_NOT_EDITABLE', 'Bản kê khai hiện chỉ được xem.')
    const file = inspectEvidence(bytes, name, mime),
      key = await this.storage.put(bytes)
    let used = false
    try {
      const result = await this.repository.addFile(user, id, {
        requestId: requestId.toLowerCase(),
        criterion,
        expectedRevision,
        storageKey: key,
        ...file,
      })
      used = result.usedKey === key
      return result.view
    } finally {
      if (!used) await this.storage.remove(key)
    }
  }
  async submit(user: string, id: string, expectedRevision: number, requestId: string) {
    const before = await this.repository.detail(user, id)
    if (before.state === 'DRAFT') for (const f of before.files) await this.download(user, id, f.id)
    return this.repository.submit(user, id, expectedRevision, requestId)
  }
  async download(user: string, id: string, fileId: string) {
    const file = await this.repository.file(user, id, fileId),
      bytes = await this.storage.read(file.storage_key)
    if (
      bytes.length !== file.size ||
      createHash('sha256').update(bytes).digest('hex') !== file.sha256
    )
      throw new SubmissionError(
        409,
        'TRAINING_FILE_INTEGRITY',
        'Tệp không khớp bản đã lưu. Hãy liên hệ người phụ trách.',
      )
    const after = await this.repository.file(user, id, fileId)
    if (after.storage_key !== file.storage_key || after.sha256 !== file.sha256)
      throw new SubmissionError(409, 'TRAINING_FILE_INTEGRITY', 'Tệp đã thay đổi.')
    return { bytes, name: file.name, mimeType: file.mime_type }
  }
}
