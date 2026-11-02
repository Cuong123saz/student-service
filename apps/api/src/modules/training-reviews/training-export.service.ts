import { createHash } from 'node:crypto'
import { SubmissionError, type SubmissionActor } from '../submissions/submission.types.js'
import type { TrainingReviewRepository } from './training-review.repository.js'
import type { TrainingExportSnapshot } from './training-export.types.js'
import { createTrainingExportWorkbook, trainingXlsxMime } from './training-export.xlsx.js'

export type TrainingExportStore = Pick<
  TrainingReviewRepository,
  'exportSnapshot' | 'assertExportAccess' | 'recordExport'
>
export type TrainingWorkbookRenderer = (
  snapshot: TrainingExportSnapshot,
) => Buffer | Promise<Buffer>
export interface TrainingExportFile {
  bytes: Buffer
  name: string
  mimeType: string
  snapshotId: string
  sha256: string
}
export interface TrainingExportUseCase {
  downloadXlsx(actor: SubmissionActor, periodId: string): Promise<TrainingExportFile>
}
export class TrainingExportService implements TrainingExportUseCase {
  private readonly actors = new Set<string>()
  constructor(
    private readonly repository: TrainingExportStore,
    private readonly render: TrainingWorkbookRenderer = createTrainingExportWorkbook,
  ) {}
  async capture(user: string, periodId: string) {
    const snapshot = await this.repository.exportSnapshot(user, periodId)
    await this.repository.assertExportAccess(user, periodId)
    return snapshot
  }
  async downloadXlsx(actor: SubmissionActor, periodId: string): Promise<TrainingExportFile> {
    if (this.actors.has(actor.userId) || this.actors.size >= 2)
      throw new SubmissionError(
        429,
        'TRAINING_EXPORT_BUSY',
        'Đang có tác vụ xuất dữ liệu. Hãy thử lại sau.',
      )
    this.actors.add(actor.userId)
    try {
      const snapshot = await this.capture(actor.userId, periodId)
      const bytes = await this.render(snapshot)
      if (bytes.length > 8 * 1024 * 1024)
        throw new SubmissionError(422, 'TRAINING_EXPORT_TOO_LARGE', 'Tệp xuất vượt giới hạn 8 MiB.')
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      // Final authorization and audit share one short transaction, after all rendering.
      await this.repository.recordExport(actor, periodId, {
        snapshotId: snapshot.snapshotId,
        rowCount: snapshot.rows.length,
        sha256,
        size: bytes.length,
      })
      return {
        bytes,
        mimeType: trainingXlsxMime,
        name: `training-points-${snapshot.snapshotId}.xlsx`,
        snapshotId: snapshot.snapshotId,
        sha256,
      }
    } finally {
      this.actors.delete(actor.userId)
    }
  }
}
