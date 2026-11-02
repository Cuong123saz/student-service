import { readVerifiedEvidence } from '../../lib/verified-evidence.js'
import type { EvidenceStorage } from '../submissions/submission.storage.js'
import { SubmissionError } from '../submissions/submission.types.js'
import type { TrainingReviewRepository } from './training-review.repository.js'
import type { ReviewAction, ReviewInput } from './training-review.types.js'
export type TrainingReviewStore = Pick<
  TrainingReviewRepository,
  'periods' | 'queue' | 'detail' | 'file' | 'act'
>
export class TrainingReviewService {
  constructor(
    readonly repository: TrainingReviewStore,
    private readonly storage: EvidenceStorage,
  ) {}
  async download(user: string, id: string, fileId: string) {
    return readVerifiedEvidence(
      () => this.repository.file(user, id, fileId),
      (key) => this.storage.read(key),
      (reason) =>
        new SubmissionError(
          409,
          reason === 'UNAVAILABLE'
            ? 'TRAINING_REVIEW_FILE_UNAVAILABLE'
            : 'TRAINING_REVIEW_FILE_INTEGRITY',
          reason === 'UNAVAILABLE'
            ? 'Không đọc được minh chứng. Hãy liên hệ người phụ trách để kiểm tra kho tệp.'
            : 'Minh chứng không khớp bản nộp hoặc đã thay đổi. Chưa thể xác nhận.',
        ),
    )
  }
  async act(user: string, id: string, action: ReviewAction, input: ReviewInput) {
    const d = await this.repository.detail(user, id)
    for (const f of d.files) await this.download(user, id, f.id)
    return this.repository.act(user, id, action, input)
  }
}
