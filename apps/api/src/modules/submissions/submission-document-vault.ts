import { createHash } from 'node:crypto'
import { lstat, mkdir, open, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { readPrivateFile } from '../../lib/private-file.js'
import { SubmissionError } from './submission.types.js'

export const maximumDocumentBytes = 16 * 1024 * 1024
export interface DocumentDigest {
  size: number
  sha256: string
}
export interface DocumentVault {
  put(attemptId: string, bytes: Buffer): Promise<DocumentDigest>
  read(key: string, expected: DocumentDigest): Promise<Buffer>
}
export const documentDigest = (bytes: Buffer): DocumentDigest => ({
  size: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
})
export const documentIntegrityFailure = () =>
  new SubmissionError(
    409,
    'DOCUMENT_INTEGRITY',
    'Tệp phiếu đã lưu thiếu hoặc không còn nguyên vẹn. Cần cán bộ kiểm tra kho tài liệu.',
  )
const keyPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
function validKey(key: string) {
  if (!keyPattern.test(key)) throw new Error('INVALID_DOCUMENT_STORAGE_KEY')
}
function validDigest(expected: DocumentDigest) {
  if (
    !Number.isSafeInteger(expected.size) ||
    expected.size < 1 ||
    expected.size > maximumDocumentBytes ||
    !/^[a-f0-9]{64}$/.test(expected.sha256)
  )
    throw new Error('INVALID_DOCUMENT_DIGEST')
}
export function disjointDocumentRoots(roots: string[]) {
  if (roots.some((root) => !isAbsolute(root))) throw new Error('DOCUMENT_ROOT_MUST_BE_ABSOLUTE')
  const normalized = roots.map((root) => resolve(root))
  for (let i = 0; i < normalized.length; i++)
    for (let j = i + 1; j < normalized.length; j++) {
      const a = normalized[i]!,
        b = normalized[j]!
      const within = (parent: string, child: string) => {
        const r = relative(parent, child)
        return !r || (!r.startsWith('..' + sep) && r !== '..' && !isAbsolute(r))
      }
      if (within(a, b) || within(b, a)) throw new Error('DOCUMENT_ROOTS_OVERLAP')
    }
  return normalized
}
// Check every ancestor: checking just the leaf misses directory junctions on Windows.
export async function assertDocumentDirectory(path: string): Promise<void> {
  if (!isAbsolute(path)) throw new Error('DOCUMENT_ROOT_MUST_BE_ABSOLUTE')
  const normalized = resolve(path),
    parent = dirname(normalized)
  if (parent !== normalized) await assertDocumentDirectory(parent)
  const info = await lstat(normalized)
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (process.platform === 'win32'
      ? resolve(await realpath(normalized)).toLowerCase() !== normalized.toLowerCase()
      : resolve(await realpath(normalized)) !== normalized)
  )
    throw new Error('UNSAFE_DOCUMENT_DIRECTORY')
}
async function assertExistingAncestors(path: string): Promise<void> {
  try {
    await assertDocumentDirectory(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const parent = dirname(path)
    if (parent === path) throw error
    await assertExistingAncestors(parent)
  }
}
async function createDirectory(path: string): Promise<void> {
  try {
    await assertDocumentDirectory(path)
    return
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const parent = dirname(path)
  if (parent === path) throw new Error('UNSAFE_DOCUMENT_DIRECTORY')
  await createDirectory(parent)
  await mkdir(path, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error
  })
  await assertDocumentDirectory(path)
}
export interface DocumentVaultOptions {
  outputRoot: string
  stagingRoot: string
  // Evidence, templates and deployment roots. Output/staging must be disjoint from all of them.
  protectedRoots: string[]
  // Internal instrumentation/fault barrier. Never accepts request input or discloses paths.
  onDurableWrite?: (phase: 'STAGED' | 'FINAL', attemptId: string) => Promise<void>
}
export class LocalDocumentVault implements DocumentVault {
  private constructor(private readonly options: DocumentVaultOptions) {}
  static async create(options: DocumentVaultOptions) {
    if (!options.protectedRoots.length) throw new Error('DOCUMENT_PROTECTED_ROOTS_REQUIRED')
    disjointDocumentRoots([options.outputRoot, options.stagingRoot])
    for (const protectedRoot of options.protectedRoots) {
      disjointDocumentRoots([options.outputRoot, protectedRoot])
      disjointDocumentRoots([options.stagingRoot, protectedRoot])
      await assertExistingAncestors(protectedRoot)
    }
    const vault = new LocalDocumentVault({
      ...options,
      outputRoot: resolve(options.outputRoot),
      stagingRoot: resolve(options.stagingRoot),
      protectedRoots: [...options.protectedRoots],
    })
    await createDirectory(vault.options.outputRoot)
    await createDirectory(vault.options.stagingRoot)
    return vault
  }
  private async roots() {
    await assertDocumentDirectory(this.options.outputRoot)
    await assertDocumentDirectory(this.options.stagingRoot)
    for (const protectedRoot of this.options.protectedRoots)
      await assertExistingAncestors(protectedRoot)
  }
  private async exclusive(path: string, bytes: Buffer) {
    const handle = await open(path, 'wx', 0o600)
    try {
      let offset = 0
      while (offset < bytes.length) {
        const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset, offset)
        if (!bytesWritten) throw new Error('DOCUMENT_WRITE_FAILED')
        offset += bytesWritten
      }
      await handle.sync()
    } finally {
      await handle.close()
    }
  }
  async put(attemptId: string, bytes: Buffer): Promise<DocumentDigest> {
    validKey(attemptId)
    if (bytes.length < 1 || bytes.length > maximumDocumentBytes)
      throw new Error('INVALID_DOCUMENT_SIZE')
    // Isolate from caller mutation while asynchronous writes are in progress.
    const owned = Buffer.from(bytes),
      expected = documentDigest(owned)
    await this.roots()
    const staged = join(this.options.stagingRoot, attemptId)
    await this.exclusive(staged, owned)
    await this.roots()
    const verified = await readPrivateFile(staged, maximumDocumentBytes)
    if (JSON.stringify(documentDigest(verified)) !== JSON.stringify(expected))
      throw documentIntegrityFailure()
    await this.options.onDurableWrite?.('STAGED', attemptId)
    await this.roots()
    await this.exclusive(join(this.options.outputRoot, attemptId), verified)
    await this.read(attemptId, expected)
    await this.options.onDurableWrite?.('FINAL', attemptId)
    // Retain staging/final artifacts for reconciliation; no guessed orphan cleanup.
    return expected
  }
  async read(key: string, expected: DocumentDigest): Promise<Buffer> {
    validKey(key)
    validDigest(expected)
    try {
      await this.roots()
      const bytes = await readPrivateFile(join(this.options.outputRoot, key), maximumDocumentBytes)
      if (bytes.length !== expected.size || documentDigest(bytes).sha256 !== expected.sha256)
        throw documentIntegrityFailure()
      return bytes
    } catch {
      throw documentIntegrityFailure()
    }
  }
}
