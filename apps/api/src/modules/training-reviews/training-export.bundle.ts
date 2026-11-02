import { createHash } from 'node:crypto'
import { strToU8, zipSync } from 'fflate'
import type { TrainingExportSnapshot } from './training-export.types.js'
import type { TrainingClassificationInfo } from './training-classification.js'

export const trainingZipMime = 'application/zip'

export interface TrainingBundleEntry {
  name: string
  mimeType: string
  bytes: Buffer
}
export interface TrainingBundleManifest {
  schemaVersion: 1
  kind: 'training-point-export-bundle'
  snapshotId: string
  capturedAt: string
  periodId: string
  classCode: string
  approvedRows: number
  templateVersion: string
  files: { name: string; mimeType: string; size: number; sha256: string }[]
  /** The PDF was converted from exactly this DOCX file of the same bundle. */
  pdfSourceDocx: string
  classification: TrainingClassificationInfo
  technicalSignatureStatus: 'NOT_VERIFIED'
  legalEffect: false
  notice: string
}
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

/**
 * Packs files that were all rendered from one snapshot. The manifest is the only place that
 * vouches for byte integrity; it does not claim a digital signature or legal effect.
 */
export function createTrainingExportBundle(
  snapshot: TrainingExportSnapshot,
  entries: {
    xlsx: TrainingBundleEntry
    classSheet: TrainingBundleEntry
    docx: TrainingBundleEntry
    pdf: TrainingBundleEntry
  },
  templateVersion: string,
): { bytes: Buffer; manifest: TrainingBundleManifest; manifestSha256: string } {
  const files = [entries.xlsx, entries.classSheet, entries.docx, entries.pdf]
  const names = new Set(files.map((f) => f.name))
  if (names.size !== files.length || names.has('manifest.json'))
    throw new Error('INVALID_EXPORT_BUNDLE')
  const manifest: TrainingBundleManifest = {
    schemaVersion: 1,
    kind: 'training-point-export-bundle',
    snapshotId: snapshot.snapshotId,
    capturedAt: snapshot.capturedAt,
    periodId: snapshot.period.id,
    classCode: snapshot.period.classCode,
    approvedRows: snapshot.rows.length,
    templateVersion,
    files: files.map((f) => ({
      name: f.name,
      mimeType: f.mimeType,
      size: f.bytes.length,
      sha256: sha256(f.bytes),
    })),
    pdfSourceDocx: entries.docx.name,
    classification: snapshot.classification,
    technicalSignatureStatus: snapshot.technicalSignatureStatus,
    legalEffect: snapshot.legalEffect,
    notice: snapshot.notice,
  }
  const manifestBytes = strToU8(JSON.stringify(manifest, null, 2) + '\n')
  const mtime = new Date('1980-01-01T00:00:00Z')
  const bytes = Buffer.from(
    zipSync(
      {
        'manifest.json': [manifestBytes, { level: 6, mtime }],
        // XLSX/DOCX/PDF are already compressed containers; storing them avoids wasted CPU.
        ...Object.fromEntries(files.map((f) => [f.name, [f.bytes, { level: 0, mtime }]])),
      },
      { mtime },
    ),
  )
  return { bytes, manifest, manifestSha256: sha256(manifestBytes) }
}
