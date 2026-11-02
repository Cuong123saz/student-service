export type TrainingExportFormat = 'xlsx' | 'docx' | 'pdf' | 'zip'

export const trainingExportFormats: Record<
  TrainingExportFormat,
  { label: string; path: string; prefix: string; description: string }
> = {
  xlsx: {
    label: 'Tải Excel',
    path: 'export.xlsx',
    prefix: 'training-points',
    description: 'Bảng kết quả đã duyệt',
  },
  docx: {
    label: 'Tải Word',
    path: 'minutes.docx',
    prefix: 'training-minutes',
    description: 'Biên bản để chỉnh in',
  },
  pdf: {
    label: 'Tải PDF',
    path: 'minutes.pdf',
    prefix: 'training-minutes',
    description: 'Biên bản chuyển từ đúng bản Word',
  },
  zip: {
    label: 'Tải gói ZIP',
    path: 'export.zip',
    prefix: 'training-export',
    description: 'Excel, Word, PDF và manifest cùng một snapshot',
  },
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const sha256Pattern = /^[0-9a-f]{64}$/

/** The file name never comes from free-form server text, only from a validated snapshot UUID. */
export function trainingExportFileName(format: TrainingExportFormat, snapshotId: string) {
  const { prefix } = trainingExportFormats[format]
  return uuid.test(snapshotId)
    ? `${prefix}-${snapshotId.toLowerCase()}.${format}`
    : `${prefix}.${format}`
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
