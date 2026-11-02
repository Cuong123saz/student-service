import { readVerifiedEvidence } from '../../lib/verified-evidence.js'
import type { EvidenceStorage } from '../submissions/submission.storage.js'
import { inspectEvidence } from '../submissions/submission.validation.js'
import { SubmissionError } from '../submissions/submission.types.js'
import type { TrainingPointRepository } from './training-points.repository.js'
import type { Group } from './training-points.types.js'
export type TrainingPointStore = Pick<
  TrainingPointRepository,
  | 'catalog'
  | 'periods'
  | 'periodDetail'
  | 'createPeriod'
  | 'changePeriod'
  | 'start'
  | 'detail'
  | 'save'
  | 'submit'
  | 'addFile'
  | 'removeFile'
  | 'file'
>
export class TrainingPointService {
  constructor(
    readonly repository: TrainingPointStore,
    private readonly storage: EvidenceStorage,
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
    return readVerifiedEvidence(
      async () => {
        const file = await this.repository.file(user, id, fileId)
        return {
          storageKey: file.storage_key,
          sha256: file.sha256,
          size: file.size,
          name: file.name,
          mimeType: file.mime_type,
        }
      },
      (key) => this.storage.read(key),
      (reason) =>
        new SubmissionError(
          409,
          reason === 'UNAVAILABLE' ? 'TRAINING_FILE_UNAVAILABLE' : 'TRAINING_FILE_INTEGRITY',
          reason === 'UNAVAILABLE'
            ? 'Không đọc được minh chứng. Hãy liên hệ người phụ trách để kiểm tra kho tệp.'
            : 'Tệp không khớp bản đã lưu hoặc đã thay đổi. Hãy liên hệ người phụ trách.',
        ),
    )
  }
}
