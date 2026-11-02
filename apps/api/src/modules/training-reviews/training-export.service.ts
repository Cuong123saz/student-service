import { createHash } from 'node:crypto'
import { LibreOfficePdfConverter, type PdfConverter } from '../submissions/submission-document.js'
import { SubmissionError, type SubmissionActor } from '../submissions/submission.types.js'
import type { TrainingReviewRepository } from './training-review.repository.js'
import type { TrainingExportSnapshot } from './training-export.types.js'
import { createTrainingExportWorkbook, trainingXlsxMime } from './training-export.xlsx.js'
import {
  createTrainingMinutesDocx,
  trainingDocxMime,
  trainingMinutesTemplate,
} from './training-export.docx.js'

export type TrainingExportStore = Pick<
  TrainingReviewRepository,
  'exportSnapshot' | 'assertExportAccess' | 'recordExport'
>
export type TrainingWorkbookRenderer = (
  snapshot: TrainingExportSnapshot,
) => Buffer | Promise<Buffer>
export type TrainingMinutesRenderer = TrainingWorkbookRenderer
export type TrainingMinutesFormat = 'docx' | 'pdf'
export interface TrainingExportFile {
  bytes: Buffer
  name: string
  mimeType: string
  snapshotId: string
  sha256: string
  templateVersion?: string
  /** For PDF: SHA-256 of the exact DOCX bytes the PDF was converted from. */
  sourceDocxSha256?: string
}
export interface TrainingExportUseCase {
  downloadXlsx(actor: SubmissionActor, periodId: string): Promise<TrainingExportFile>
  downloadMinutes(
    actor: SubmissionActor,
    periodId: string,
    format: TrainingMinutesFormat,
  ): Promise<TrainingExportFile>
}
const MiB = 1024 * 1024
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const tooLarge = (limit: string) =>
  new SubmissionError(422, 'TRAINING_EXPORT_TOO_LARGE', `Tệp xuất vượt giới hạn ${limit}.`)

export class TrainingExportService implements TrainingExportUseCase {
  private readonly actors = new Set<string>()
  constructor(
    private readonly repository: TrainingExportStore,
    private readonly render: TrainingWorkbookRenderer = createTrainingExportWorkbook,
    private readonly renderMinutes: TrainingMinutesRenderer = createTrainingMinutesDocx,
    private readonly converter: PdfConverter = new LibreOfficePdfConverter(),
  ) {}
  async capture(user: string, periodId: string) {
    const snapshot = await this.repository.exportSnapshot(user, periodId)
    await this.repository.assertExportAccess(user, periodId)
    return snapshot
  }
  /** One export task per account and two per service instance, released on every outcome. */
  private async exclusive<T>(actor: SubmissionActor, task: () => Promise<T>): Promise<T> {
    if (this.actors.has(actor.userId) || this.actors.size >= 2)
      throw new SubmissionError(
        429,
        'TRAINING_EXPORT_BUSY',
        'Đang có tác vụ xuất dữ liệu. Hãy thử lại sau.',
      )
    this.actors.add(actor.userId)
    try {
      return await task()
    } finally {
      this.actors.delete(actor.userId)
    }
  }
  downloadXlsx(actor: SubmissionActor, periodId: string): Promise<TrainingExportFile> {
    return this.exclusive(actor, async () => {
      const snapshot = await this.capture(actor.userId, periodId)
      const bytes = await this.render(snapshot)
      if (bytes.length > 8 * MiB) throw tooLarge('8 MiB')
      const digest = sha256(bytes)
      // Final authorization and audit share one short transaction, after all rendering.
      await this.repository.recordExport(actor, periodId, {
        format: 'XLSX',
        snapshotId: snapshot.snapshotId,
        rowCount: snapshot.rows.length,
        sha256: digest,
        size: bytes.length,
      })
      return {
        bytes,
        mimeType: trainingXlsxMime,
        name: `training-points-${snapshot.snapshotId}.xlsx`,
        snapshotId: snapshot.snapshotId,
        sha256: digest,
      }
    })
  }
  downloadMinutes(
    actor: SubmissionActor,
    periodId: string,
    format: TrainingMinutesFormat,
  ): Promise<TrainingExportFile> {
    return this.exclusive(actor, async () => {
      const snapshot = await this.capture(actor.userId, periodId)
      // No database lock or transaction is open while the DOCX is built or LibreOffice runs.
      const docx = await this.renderMinutes(snapshot)
      if (docx.length > 8 * MiB) throw tooLarge('8 MiB')
      const docxSha256 = sha256(docx)
      const bytes = format === 'docx' ? docx : await this.convert(docx)
      if (bytes.length > 16 * MiB) throw tooLarge('16 MiB')
      const digest = format === 'docx' ? docxSha256 : sha256(bytes)
      await this.repository.recordExport(actor, periodId, {
        format: format === 'docx' ? 'DOCX' : 'PDF',
        snapshotId: snapshot.snapshotId,
        rowCount: snapshot.rows.length,
        sha256: digest,
        size: bytes.length,
        templateVersion: trainingMinutesTemplate.label,
        ...(format === 'pdf' ? { sourceDocxSha256: docxSha256 } : {}),
      })
      return {
        bytes,
        mimeType: format === 'docx' ? trainingDocxMime : 'application/pdf',
        name: `training-minutes-${snapshot.snapshotId}.${format}`,
        snapshotId: snapshot.snapshotId,
        sha256: digest,
        templateVersion: trainingMinutesTemplate.label,
        ...(format === 'pdf' ? { sourceDocxSha256: docxSha256 } : {}),
      }
    })
  }
  /** Converter failures never fall back to an empty or partial PDF. */
  private async convert(docx: Buffer): Promise<Buffer> {
    try {
      return await this.converter.convert(docx)
    } catch (error) {
      if (error instanceof SubmissionError && error.code === 'DOCUMENT_BUSY')
        throw new SubmissionError(
          503,
          'TRAINING_EXPORT_PDF_BUSY',
          'Máy chủ đang tạo nhiều tệp PDF. Hãy thử lại sau hoặc tải bản Word.',
        )
      if (error instanceof SubmissionError && error.code === 'DOCUMENT_CONVERTER_QUARANTINED')
        throw new SubmissionError(
          503,
          'TRAINING_EXPORT_PDF_QUARANTINED',
          'Bộ chuyển PDF cần được người phụ trách kiểm tra. Bạn vẫn có thể tải bản Word.',
        )
      throw new SubmissionError(
        503,
        'TRAINING_EXPORT_PDF_UNAVAILABLE',
        'Chưa tạo được PDF biên bản. Bạn vẫn có thể tải bản Word; dữ liệu xét duyệt không thay đổi.',
      )
    }
  }
}
