import { unzipSync, strFromU8 } from 'fflate'
import {
  LocalSubmissionDocumentRenderer,
  submissionDocumentTemplate,
  type DocumentSnapshot,
  type SubmissionDocumentRenderer,
} from './submission-document.js'
import { SubmissionError } from './submission.types.js'

const probeTypes = ['TEXT', 'TEXTAREA', 'NUMBER', 'DATE', 'SELECT', 'BOOLEAN'] as const

// Deliberately synthetic and independent of accounts, database and stored submissions.
const probeSnapshot: DocumentSnapshot = {
  id: '11111111-1111-4111-8111-111111111111',
  serviceName: 'Kiểm tra xuất phiếu bằng dữ liệu giả',
  procedure: {
    versionId: '22222222-2222-4222-8222-222222222222',
    versionNumber: 1,
    processingMode: 'ONLINE',
    processingUnitName: 'Đơn vị thử',
    contactInstructions: '',
    attachments: [],
    maxTotalAttachmentBytes: 0,
    fields: probeTypes.map((type, index) => ({
      key: 'f' + index,
      label: 'Trường thử ' + index,
      type,
      source: 'STUDENT_INPUT',
      profileKey: null,
      required: false,
      maxLength: 2000,
      options: type === 'SELECT' ? [{ value: 'DEMO', label: 'Giả định' }] : [],
    })),
  },
  round: {
    roundNumber: 1,
    submittedAt: '2026-10-11T01:00:00Z',
    source: 'LIVE',
    files: [],
    studentSnapshot: {
      fullName: 'Sinh viên kiểm tra giả định',
      studentCode: 'TEST-ONLY',
      classCode: 'TEST',
      facultyCode: 'TEST',
    },
    values: {
      f0: 'Nội dung tiếng Việt: Nguyễn Ánh',
      f1: 'Dòng thứ nhất\nDòng thứ hai',
      f2: 0,
      f3: '2026-10-11',
      f4: 'DEMO',
      f5: false,
    },
  },
}
export interface DocumentRuntimeReport {
  version: 1
  checkedAt: string
  status: 'READY' | 'WORD_ONLY' | 'UNAVAILABLE'
  fakeDataOnly: true
  template: { id: string; sha256: string }
  word: { ready: boolean; elapsedMs: number; code?: string }
  pdf: { ready: boolean; elapsedMs: number; code?: string }
  message: string
}
function code(error: unknown) {
  return error instanceof SubmissionError ? error.code : 'DOCUMENT_CHECK_FAILED'
}
export async function checkSubmissionDocumentRuntime(
  renderer: SubmissionDocumentRenderer = new LocalSubmissionDocumentRenderer(),
): Promise<DocumentRuntimeReport> {
  const report: DocumentRuntimeReport = {
    version: 1,
    checkedAt: new Date().toISOString(),
    status: 'UNAVAILABLE',
    fakeDataOnly: true,
    template: submissionDocumentTemplate,
    word: { ready: false, elapsedMs: 0 },
    pdf: { ready: false, elapsedMs: 0 },
    message: 'Chưa tạo được Word. Kiểm tra bản mẫu đúng phiên bản trước khi sử dụng.',
  }
  let word: Buffer
  let start = performance.now()
  try {
    word = await renderer.render(structuredClone(probeSnapshot), 'docx')
    const content = strFromU8(unzipSync(word)['word/document.xml']!)
    for (const value of [
      'Nội dung tiếng Việt: Nguyễn Ánh',
      'Dòng thứ nhất',
      'Dòng thứ hai',
      '11/10/2026',
      'Giả định',
      'Không',
    ])
      if (!content.includes(value)) throw new Error('DOCUMENT_CHECK_FAILED')
    if (!/>0<\/w:t>/.test(content)) throw new Error('DOCUMENT_CHECK_FAILED')
    report.word.ready = true
    report.status = 'WORD_ONLY'
  } catch (error) {
    report.word.code = code(error)
    return report
  } finally {
    report.word.elapsedMs = Math.round(performance.now() - start)
  }
  start = performance.now()
  try {
    const pair = await renderer.renderPair(structuredClone(probeSnapshot))
    if (
      !pair.docx.equals(word) ||
      pair.pdf.length < 100 ||
      pair.pdf.subarray(0, 5).toString('ascii') !== '%PDF-' ||
      !pair.pdf.subarray(-1024).includes(Buffer.from('%%EOF'))
    )
      throw new Error('DOCUMENT_CHECK_FAILED')
    report.pdf.ready = true
    report.status = 'READY'
    report.message =
      'Word và PDF đã tạo được bằng dữ liệu giả. Cần xem bố cục và đo tải riêng trước khi vận hành thực tế.'
  } catch (error) {
    report.pdf.code = code(error)
    report.message =
      'Word tải được; PDF và gói ZIP chưa sẵn sàng. Kiểm tra LibreOffice, thư mục tạm và tài nguyên máy rồi chạy lại.'
  } finally {
    report.pdf.elapsedMs = Math.round(performance.now() - start)
  }
  return report
}
