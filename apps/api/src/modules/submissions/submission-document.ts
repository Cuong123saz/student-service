import { spawn, execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate'
import type { PublicProcedure, ProcedureField } from '../procedures/procedure.contract.js'
import { SubmissionError, type SubmissionRoundView } from './submission.types.js'

export type DocumentFormat = 'docx' | 'pdf'
export const documentMimeTypes = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
} as const
export interface DocumentSnapshot {
  id: string
  serviceName: string
  procedure: PublicProcedure
  round: SubmissionRoundView
}
export interface RenderedSubmissionDocuments {
  docx: Buffer
  pdf: Buffer
  template: { id: string; sha256: string }
}
export interface SubmissionDocumentRenderer {
  render(snapshot: DocumentSnapshot, format: DocumentFormat): Promise<Buffer>
  renderPair(snapshot: DocumentSnapshot): Promise<RenderedSubmissionDocuments>
}
export const submissionDocumentTemplate = {
  id: 'submission-summary-v1',
  sha256: '9074a0b961cf66b625d4339c4473a42c7bfc3d981816f821fa78552c7fae8ca2',
} as const
export interface PdfConverter {
  convert(docx: Buffer): Promise<Buffer>
}
export const documentTemplatePath = fileURLToPath(
  new URL('../../../templates/submission-summary-v1.docx', import.meta.url),
)

function text(value: string) {
  return (
    value
      // XML 1.0 disallows these controls in submitted text.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '\uFFFD')
      .split(/\r\n|\r|\n/)
      .map((part) =>
        part
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&apos;'),
      )
      .join('</w:t><w:br/><w:t xml:space="preserve">')
  )
}
export function documentAnswer(field: ProcedureField, round: SubmissionRoundView): string {
  const value =
    field.source === 'PROFILE' && field.profileKey
      ? round.studentSnapshot[field.profileKey]
      : round.values[field.key]
  if (value === undefined || value === null || value === '') return 'Chưa kê khai'
  if (field.type === 'BOOLEAN' && typeof value === 'boolean') return value ? 'Có' : 'Không'
  if (field.type === 'SELECT')
    return field.options.find((option) => option.value === value)?.label ?? String(value)
  if (field.type === 'DATE' && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value))
    return value.slice(8, 10) + '/' + value.slice(5, 7) + '/' + value.slice(0, 4)
  return String(value)
}
export function fillSubmissionDocument(template: Uint8Array, snapshot: DocumentSnapshot): Buffer {
  const parts = unzipSync(template)
  const document = parts['word/document.xml']
  if (!document) throw new Error('INVALID_DOCUMENT_TEMPLATE')
  let xml = strFromU8(document)
  const rows = xml.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) ?? []
  const answerRows = rows.filter(
    (row) => row.includes('{{fieldLabel}}') && row.includes('{{fieldValue}}'),
  )
  if (answerRows.length !== 1) throw new Error('INVALID_DOCUMENT_TEMPLATE')
  const answerRow = answerRows[0]!
  const scalar: Record<string, string> = {
    evidenceSummary: snapshot.round.files.length
      ? snapshot.round.files
          .map((file, index) => {
            const label =
              snapshot.procedure.attachments.find((item) => item.key === file.attachmentKey)
                ?.label ?? file.attachmentKey
            return `${index + 1}. ${label}: ${file.name} (${file.mimeType}; ${file.size} byte). Chữ ký chưa được xác minh.`
          })
          .join('\n')
      : 'Không có tệp minh chứng trong lần gửi này.',
    serviceName: snapshot.serviceName,
    submissionId: snapshot.id,
    roundNumber: String(snapshot.round.roundNumber),
    versionNumber: String(snapshot.procedure.versionNumber),
    submittedAt:
      new Intl.DateTimeFormat('vi-VN', {
        dateStyle: 'short',
        timeStyle: 'medium',
        timeZone: 'Asia/Ho_Chi_Minh',
        hourCycle: 'h23',
      }).format(new Date(snapshot.round.submittedAt)) + ' (giờ Việt Nam)',
    processingMode: { ONLINE: 'Trực tuyến', HYBRID: 'Kết hợp', OFFLINE: 'Trực tiếp' }[
      snapshot.procedure.processingMode
    ],
    processingUnitName: snapshot.procedure.processingUnitName,
    studentName: snapshot.round.studentSnapshot.fullName,
    studentCode: snapshot.round.studentSnapshot.studentCode,
    classCode: snapshot.round.studentSnapshot.classCode,
    facultyCode: snapshot.round.studentSnapshot.facultyCode,
  }
  // Replace only known template slots once; submitted text containing {{...}} stays literal.
  xml = xml.replace(
    /\{\{(evidenceSummary|serviceName|submissionId|roundNumber|versionNumber|submittedAt|processingMode|processingUnitName|studentName|studentCode|classCode|facultyCode)\}\}/g,
    (_, key: string) => text(scalar[key]!),
  )
  const answers = snapshot.procedure.fields.length
    ? snapshot.procedure.fields
        .map((field) =>
          answerRow.replace(/\{\{(fieldLabel|fieldValue)\}\}/g, (_, key: string) =>
            text(key === 'fieldLabel' ? field.label : documentAnswer(field, snapshot.round)),
          ),
        )
        .join('')
    : answerRow
        .replace('{{fieldLabel}}', 'Thông tin bổ sung')
        .replace('{{fieldValue}}', 'Biểu mẫu không có trường kê khai.')
  xml = xml.replace(answerRow, () => answers)
  parts['word/document.xml'] = strToU8(xml)
  return Buffer.from(zipSync(parts, { level: 6, mtime: new Date('1980-01-01T00:00:00Z') }))
}

export function runDocumentConversion(
  command: string,
  args: string[],
  timeoutMs = 90000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: 'ignore', shell: false })
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      if (process.platform === 'win32' && child.pid) {
        // Only terminate the converter process tree started by this call.
        execFile(
          'taskkill.exe',
          ['/PID', String(child.pid), '/T', '/F'],
          { windowsHide: true, timeout: 5000 },
          () => {
            child.kill('SIGKILL')
            reject(new Error('DOCUMENT_CONVERSION_TIMEOUT'))
          },
        )
      } else {
        child.kill('SIGKILL')
        reject(new Error('DOCUMENT_CONVERSION_TIMEOUT'))
      }
    }, timeoutMs)
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      if (timedOut) reject(new Error('DOCUMENT_CONVERSION_TIMEOUT'))
      else if (code === 0) resolve()
      else reject(new Error('DOCUMENT_CONVERSION_FAILED'))
    })
  })
}
export class LibreOfficePdfConverter implements PdfConverter {
  private active = 0
  constructor(
    private readonly command = process.env.LIBREOFFICE_PATH?.trim() ||
      (process.platform === 'win32' ? 'soffice.com' : 'soffice'),
  ) {}
  async convert(docx: Buffer): Promise<Buffer> {
    if (this.active >= 2)
      throw new SubmissionError(
        503,
        'DOCUMENT_BUSY',
        'Máy chủ đang tạo nhiều phiếu PDF. Vui lòng thử lại sau.',
      )
    this.active++
    let directory: string | undefined
    try {
      directory = await mkdtemp(join(tmpdir(), 'student-service-document-'))
      const input = join(directory, 'input.docx')
      await writeFile(input, docx, { flag: 'wx', mode: 0o600 })
      await runDocumentConversion(this.command, [
        '-env:UserInstallation=' + pathToFileURL(join(directory, 'profile')).href,
        '--headless',
        '--nologo',
        '--norestore',
        '--convert-to',
        'pdf:writer_pdf_Export',
        '--outdir',
        directory,
        input,
      ])
      const pdf = await readFile(join(directory, 'input.pdf'))
      if (
        pdf.length < 100 ||
        pdf.length > 16 * 1024 * 1024 ||
        pdf.subarray(0, 5).toString('ascii') !== '%PDF-' ||
        !pdf.subarray(-1024).includes(Buffer.from('%%EOF'))
      )
        throw new Error('INVALID_CONVERTED_PDF')
      return pdf
    } catch (error) {
      if (error instanceof SubmissionError) throw error
      throw new SubmissionError(
        503,
        'DOCUMENT_PDF_UNAVAILABLE',
        'Chưa tạo được PDF. Bạn vẫn có thể tải Word và thử lại PDF sau; hồ sơ đã gửi vẫn được giữ nguyên.',
      )
    } finally {
      // directory is created here with a fixed prefix; no user path is accepted.
      if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {})
      this.active--
    }
  }
}
export class LocalSubmissionDocumentRenderer implements SubmissionDocumentRenderer {
  constructor(
    private readonly converter: PdfConverter = new LibreOfficePdfConverter(),
    private readonly templatePath = documentTemplatePath,
  ) {}
  private async word(snapshot: DocumentSnapshot) {
    try {
      const template = await readFile(this.templatePath)
      // v1 is immutable. A new layout must use a new version, never overwrite this one.
      if (createHash('sha256').update(template).digest('hex') !== submissionDocumentTemplate.sha256)
        throw new Error('DOCUMENT_TEMPLATE_CHANGED')
      return fillSubmissionDocument(template, snapshot)
    } catch {
      throw new SubmissionError(
        503,
        'DOCUMENT_TEMPLATE_UNAVAILABLE',
        'Mẫu phiếu chưa sẵn sàng hoặc không đúng phiên bản. Vui lòng liên hệ đơn vị xử lý; hồ sơ đã gửi vẫn được giữ nguyên.',
      )
    }
  }
  async render(snapshot: DocumentSnapshot, format: DocumentFormat): Promise<Buffer> {
    const docx = await this.word(snapshot)
    return format === 'docx' ? docx : this.converter.convert(docx)
  }
  async renderPair(snapshot: DocumentSnapshot): Promise<RenderedSubmissionDocuments> {
    const docx = await this.word(snapshot)
    return { docx, pdf: await this.converter.convert(docx), template: submissionDocumentTemplate }
  }
}
