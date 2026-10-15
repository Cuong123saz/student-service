import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { LocalEvidenceStorage, type EvidenceStorage } from '../submissions/submission.storage.js'
import { SubmissionError } from '../submissions/submission.types.js'
import { TrainingReviewRepository } from './training-review.repository.js'
import type { ReviewAction, ReviewInput } from './training-review.types.js'
export class TrainingReviewService {
  constructor(
    readonly repository = new TrainingReviewRepository(),
    private readonly storage: EvidenceStorage = new LocalEvidenceStorage(
      resolve(process.env.SUBMISSION_STORAGE_ROOT || '.local/submission-files', 'training-points'),
    ),
  ) {}
  async download(user: string, id: string, fileId: string) {
    const f = await this.repository.file(user, id, fileId),
      bytes = await this.storage.read(f.storageKey)
    if (bytes.length !== f.size || createHash('sha256').update(bytes).digest('hex') !== f.sha256)
      throw new SubmissionError(
        409,
        'TRAINING_REVIEW_FILE_INTEGRITY',
        'Minh chứng không khớp bản nộp. Chưa thể xác nhận.',
      )
    const after = await this.repository.file(user, id, fileId)
    if (after.storageKey !== f.storageKey || after.sha256 !== f.sha256)
      throw new SubmissionError(409, 'TRAINING_REVIEW_FILE_INTEGRITY', 'Minh chứng đã thay đổi.')
    return { bytes, name: f.name, mimeType: f.mimeType }
  }
  async act(user: string, id: string, action: ReviewAction, input: ReviewInput) {
    const d = await this.repository.detail(user, id)
    for (const f of d.files) await this.download(user, id, f.id)
    return this.repository.act(user, id, action, input)
  }
}
