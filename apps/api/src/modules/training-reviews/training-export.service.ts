import { createHash } from 'node:crypto'
import { LibreOfficePdfConverter, type PdfConverter } from '../submissions/submission-document.js'
import { SubmissionError, type SubmissionActor } from '../submissions/submission.types.js'
import type { TrainingReviewRepository } from './training-review.repository.js'
import type { TrainingExportSnapshot } from './training-export.types.js'
import {
  createTrainingClassSheet,
  createTrainingExportWorkbook,
  trainingClassSheetTemplate,
  trainingXlsxMime,
} from './training-export.xlsx.js'
import {
  createTrainingFormDocx,
  createTrainingMinutesDocx,
  trainingDocxMime,
  trainingFormTemplate,
  trainingMinutesTemplate,
} from './training-export.docx.js'
import { createTrainingExportBundle, trainingZipMime } from './training-export.bundle.js'

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
  /** For ZIP: SHA-256 of manifest.json inside the bundle. */
  manifestSha256?: string
}
export interface TrainingExportUseCase {
  downloadXlsx(actor: SubmissionActor, periodId: string): Promise<TrainingExportFile>
  downloadMinutes(
    actor: SubmissionActor,
    periodId: string,
    format: TrainingMinutesFormat,
  ): Promise<TrainingExportFile>
  downloadZip(actor: SubmissionActor, periodId: string): Promise<TrainingExportFile>
  downloadClassSheet(actor: SubmissionActor, periodId: string): Promise<TrainingExportFile>
  downloadForm(
    actor: SubmissionActor,
    periodId: string,
    declarationId: string,
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
    private readonly renderForm: (
      snapshot: TrainingExportSnapshot,
      declarationId: string,
    ) => Buffer = createTrainingFormDocx,
  ) {}
  /** ADR 0028: allowMonitor is true only for the class sheet and printed forms. */
  async capture(user: string, periodId: string, allowMonitor = false) {
    const snapshot = await this.repository.exportSnapshot(user, periodId, allowMonitor)
    await this.repository.assertExportAccess(user, periodId, allowMonitor)
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
      const bytes = await this.workbook(snapshot)
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
      const docx = await this.minutes(snapshot)
      const docxSha256 = sha256(docx)
      const bytes = format === 'docx' ? docx : await this.pdf(docx)
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
  /**
   * One snapshot, three renderings, one bundle. A failure in any part (including PDF) fails the
   * whole ZIP: a bundle never silently omits a format.
   */
  downloadZip(actor: SubmissionActor, periodId: string): Promise<TrainingExportFile> {
    return this.exclusive(actor, async () => {
      const snapshot = await this.capture(actor.userId, periodId)
      const id = snapshot.snapshotId
      const xlsx = await this.workbook(snapshot)
      const classSheet = this.classSheet(snapshot)
      const docx = await this.minutes(snapshot)
      const pdf = await this.pdf(docx)
      const bundle = createTrainingExportBundle(
        snapshot,
        {
          xlsx: { name: `training-points-${id}.xlsx`, mimeType: trainingXlsxMime, bytes: xlsx },
          classSheet: {
            name: `training-class-sheet-${id}.xlsx`,
            mimeType: trainingXlsxMime,
            bytes: classSheet,
          },
          docx: { name: `training-minutes-${id}.docx`, mimeType: trainingDocxMime, bytes: docx },
          pdf: { name: `training-minutes-${id}.pdf`, mimeType: 'application/pdf', bytes: pdf },
        },
        trainingMinutesTemplate.label,
      )
      if (bundle.bytes.length > 32 * MiB) throw tooLarge('32 MiB')
      const digest = sha256(bundle.bytes)
      await this.repository.recordExport(actor, periodId, {
        format: 'ZIP',
        snapshotId: id,
        rowCount: snapshot.rows.length,
        sha256: digest,
        size: bundle.bytes.length,
        templateVersion: trainingMinutesTemplate.label,
        manifestSha256: bundle.manifestSha256,
      })
      return {
        bytes: bundle.bytes,
        mimeType: trainingZipMime,
        name: `training-export-${id}.zip`,
        snapshotId: id,
        sha256: digest,
        templateVersion: trainingMinutesTemplate.label,
        manifestSha256: bundle.manifestSha256,
      }
    })
  }
  /** ADR 0026: school-format class sheet; same authorization, snapshot and audit flow as XLSX. */
  downloadClassSheet(actor: SubmissionActor, periodId: string): Promise<TrainingExportFile> {
    return this.exclusive(actor, async () => {
      const snapshot = await this.capture(actor.userId, periodId, true)
      const bytes = this.classSheet(snapshot)
      const digest = sha256(bytes)
      await this.repository.recordExport(actor, periodId, {
        format: 'CLASS_SHEET',
        snapshotId: snapshot.snapshotId,
        rowCount: snapshot.rows.length,
        sha256: digest,
        size: bytes.length,
        templateVersion: trainingClassSheetTemplate.label,
      })
      return {
        bytes,
        mimeType: trainingXlsxMime,
        name: `training-class-sheet-${snapshot.snapshotId}.xlsx`,
        snapshotId: snapshot.snapshotId,
        sha256: digest,
        templateVersion: trainingClassSheetTemplate.label,
      }
    })
  }
  /** ADR 0028: printed assessment form of one faculty-approved declaration (DOCX or PDF). */
  downloadForm(
    actor: SubmissionActor,
    periodId: string,
    declarationId: string,
    format: TrainingMinutesFormat,
  ): Promise<TrainingExportFile> {
    return this.exclusive(actor, async () => {
      const snapshot = await this.capture(actor.userId, periodId, true)
      if (!snapshot.rows.some((r) => r.declarationId === declarationId))
        throw new SubmissionError(
          404,
          'TRAINING_FORM_NOT_APPROVED',
          'Chỉ in được phiếu đã được khoa duyệt trong đợt này.',
        )
      const docx = this.renderForm(snapshot, declarationId)
      if (docx.length > 8 * MiB) throw tooLarge('8 MiB')
      const docxSha256 = sha256(docx)
      const bytes = format === 'docx' ? docx : await this.pdf(docx)
      const digest = format === 'docx' ? docxSha256 : sha256(bytes)
      await this.repository.recordExport(actor, periodId, {
        format: 'FORM',
        snapshotId: snapshot.snapshotId,
        rowCount: 1,
        sha256: digest,
        size: bytes.length,
        templateVersion: trainingFormTemplate.label,
        declarationId,
        ...(format === 'pdf' ? { sourceDocxSha256: docxSha256 } : {}),
      })
      return {
        bytes,
        mimeType: format === 'docx' ? trainingDocxMime : 'application/pdf',
        name: `training-form-${declarationId}.${format}`,
        snapshotId: snapshot.snapshotId,
        sha256: digest,
        templateVersion: trainingFormTemplate.label,
        ...(format === 'pdf' ? { sourceDocxSha256: docxSha256 } : {}),
      }
    })
  }
  private classSheet(snapshot: TrainingExportSnapshot) {
    const bytes = createTrainingClassSheet(snapshot)
    if (bytes.length > 8 * MiB) throw tooLarge('8 MiB')
    return bytes
  }
  private async workbook(snapshot: TrainingExportSnapshot) {
    const bytes = await this.render(snapshot)
    if (bytes.length > 8 * MiB) throw tooLarge('8 MiB')
    return bytes
  }
  private async minutes(snapshot: TrainingExportSnapshot) {
    const bytes = await this.renderMinutes(snapshot)
    if (bytes.length > 8 * MiB) throw tooLarge('8 MiB')
    return bytes
  }
  private async pdf(docx: Buffer) {
    const bytes = await this.convert(docx)
    if (bytes.length > 16 * MiB) throw tooLarge('16 MiB')
    return bytes
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
