export type TrainingExportFormat =
  'xlsx' | 'class-sheet' | 'docx' | 'pdf' | 'zip' | 'form-docx' | 'form-pdf'

export const trainingExportFormats: Record<
  TrainingExportFormat,
  { label: string; path: string; prefix: string; extension: string; description: string }
> = {
  xlsx: {
    label: 'Tải Excel',
    path: 'export.xlsx',
    prefix: 'training-points',
    extension: 'xlsx',
    description: 'Bảng kết quả chi tiết đã duyệt',
  },
  'class-sheet': {
    label: 'Tải bảng điểm lớp',
    path: 'class-sheet.xlsx',
    prefix: 'training-class-sheet',
    extension: 'xlsx',
    description: 'Bảng điểm rèn luyện lớp theo mẫu của Học viện, có xếp loại tạm tính',
  },
  docx: {
    label: 'Tải Word',
    path: 'minutes.docx',
    prefix: 'training-minutes',
    extension: 'docx',
    description: 'Biên bản họp lớp theo mẫu của Học viện, kèm phụ lục điểm',
  },
  pdf: {
    label: 'Tải PDF',
    path: 'minutes.pdf',
    prefix: 'training-minutes',
    extension: 'pdf',
    description: 'Biên bản chuyển từ đúng bản Word',
  },
  zip: {
    label: 'Tải gói ZIP',
    path: 'export.zip',
    prefix: 'training-export',
    extension: 'zip',
    description: 'Hai bảng Excel, Word, PDF và manifest cùng một snapshot',
  },
  // ADR 0028: printed assessment form of one approved declaration (path is per declaration).
  'form-docx': {
    label: 'In phiếu (Word)',
    path: 'form.docx',
    prefix: 'training-form',
    extension: 'docx',
    description: 'Phiếu đánh giá kết quả rèn luyện của một sinh viên',
  },
  'form-pdf': {
    label: 'In phiếu (PDF)',
    path: 'form.pdf',
    prefix: 'training-form',
    extension: 'pdf',
    description: 'Phiếu đánh giá chuyển từ đúng bản Word',
  },
}

/** ADR 0028: buttons offered on the class export panel for each viewer role. */
export const panelExportFormats: Record<
  'ADVISOR' | 'FACULTY' | 'MONITOR',
  readonly TrainingExportFormat[]
> = {
  ADVISOR: ['xlsx', 'class-sheet', 'docx', 'pdf', 'zip'],
  FACULTY: ['xlsx', 'class-sheet', 'docx', 'pdf', 'zip'],
  MONITOR: ['class-sheet'],
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const sha256Pattern = /^[0-9a-f]{64}$/

/** The file name never comes from free-form server text, only from a validated snapshot UUID. */
export function trainingExportFileName(format: TrainingExportFormat, snapshotId: string) {
  const { prefix, extension } = trainingExportFormats[format]
  return uuid.test(snapshotId)
    ? `${prefix}-${snapshotId.toLowerCase()}.${extension}`
    : `${prefix}.${extension}`
}

export function isSha256(value: string | null | undefined): value is string {
  return typeof value === 'string' && sha256Pattern.test(value)
}

/** Returns null when Web Crypto is unavailable (for example a non-secure context). */
export async function blobSha256(blob: Blob): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) return null
  const digest = await subtle.digest('SHA-256', await blob.arrayBuffer())
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
