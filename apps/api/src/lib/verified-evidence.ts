import { createHash } from 'node:crypto'

export interface StoredEvidence {
  storageKey: string
  size: number
  sha256: string
  name: string
  mimeType: string
}
export type EvidenceFailure = 'UNAVAILABLE' | 'INTEGRITY' | 'CHANGED'

// Keep authorization outside the read catch: callers must retain 403/404 errors.
// Reload after I/O so revoked access and changed metadata cannot return private bytes.
export async function readVerifiedEvidence(
  load: () => Promise<StoredEvidence>,
  read: (key: string) => Promise<Buffer>,
  failure: (reason: EvidenceFailure) => Error,
) {
  const before = { ...(await load()) }
  let bytes: Buffer
  try {
    bytes = await read(before.storageKey)
  } catch {
    throw failure('UNAVAILABLE')
  }
  if (
    bytes.length !== before.size ||
    createHash('sha256').update(bytes).digest('hex') !== before.sha256
  )
    throw failure('INTEGRITY')
  const after = await load()
  if (
    before.storageKey !== after.storageKey ||
    before.sha256 !== after.sha256 ||
    before.size !== after.size ||
    before.name !== after.name ||
    before.mimeType !== after.mimeType
  )
    throw failure('CHANGED')
  return { bytes, name: before.name, mimeType: before.mimeType }
}
