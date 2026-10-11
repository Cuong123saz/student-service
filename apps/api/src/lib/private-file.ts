import { constants, type BigIntStats } from 'node:fs'
import { lstat, open } from 'node:fs/promises'

const sameFile = (a: BigIntStats, b: BigIntStats) =>
  a.dev === b.dev &&
  a.ino === b.ino &&
  a.size === b.size &&
  a.mtimeNs === b.mtimeNs &&
  a.ctimeNs === b.ctimeNs
const unavailable = () => new Error('PRIVATE_FILE_UNAVAILABLE')

// Callers provide an internal path, never a client-supplied filename.
// Stat first, bound every read, and reject replacement/growth during the read.
export async function readPrivateFile(path: string, maximum: number): Promise<Buffer> {
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 16 * 1024 * 1024)
    throw new Error('INVALID_PRIVATE_FILE_LIMIT')
  const before = await lstat(path, { bigint: true }).catch(() => {
    throw unavailable()
  })
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.size < 1n ||
    before.size > BigInt(maximum)
  )
    throw unavailable()
  const handle = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0),
  ).catch(() => {
    throw unavailable()
  })
  try {
    const opened = await handle.stat({ bigint: true })
    if (!opened.isFile() || !sameFile(before, opened)) throw unavailable()
    // One extra byte detects growth without allocating from a later, unbounded stat.
    const bytes = Buffer.alloc(Number(opened.size) + 1)
    let used = 0
    while (used < bytes.length) {
      const result = await handle.read(bytes, used, bytes.length - used, used)
      if (!result.bytesRead) break
      used += result.bytesRead
    }
    const after = await handle.stat({ bigint: true })
    const final = await lstat(path, { bigint: true })
    if (
      used !== Number(opened.size) ||
      !sameFile(opened, after) ||
      !sameFile(after, final) ||
      final.isSymbolicLink()
    )
      throw unavailable()
    return bytes.subarray(0, used)
  } catch {
    throw unavailable()
  } finally {
    await handle.close()
  }
}
