import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
const same = (a, b) =>
  a.dev === b.dev &&
  a.ino === b.ino &&
  a.size === b.size &&
  a.mtimeNs === b.mtimeNs &&
  a.ctimeNs === b.ctimeNs
// Standalone operational scripts do not load the TypeScript application/runtime configuration.
export async function readRecoveryPrivateFile(path, maximum) {
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 4194304)
    throw new Error('INVALID_METADATA_READ_LIMIT')
  let handle
  try {
    const before = await lstat(path, { bigint: true })
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.size <= 0n ||
      before.size > BigInt(maximum)
    )
      throw new Error('UNSAFE_OR_OVERSIZED_FILE')
    handle = await open(
      path,
      constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0),
    )
    const opened = await handle.stat({ bigint: true })
    if (!same(before, opened) || !opened.isFile()) throw new Error('METADATA_CHANGED_DURING_READ')
    const size = Number(opened.size),
      buffer = Buffer.alloc(size + 1)
    let used = 0
    while (used < buffer.length) {
      const { bytesRead } = await handle.read(buffer, used, buffer.length - used, null)
      if (!bytesRead) break
      used += bytesRead
    }
    const after = await handle.stat({ bigint: true }),
      final = await lstat(path, { bigint: true })
    if (used !== size || !same(opened, after) || !same(after, final) || final.isSymbolicLink())
      throw new Error('METADATA_CHANGED_DURING_READ')
    return buffer.subarray(0, size)
  } finally {
    await handle?.close()
  }
}

// The writer is stopped by the caller. Still bound each copy to the verified size so a
// growing source cannot fill the destination disk before post-copy verification.
export async function copyRecoveryPrivateFile(source, destination, expected, maximum) {
  if (
    !Number.isInteger(maximum) ||
    maximum < 1 ||
    maximum > 536870912 ||
    !expected ||
    !Number.isInteger(expected.size) ||
    expected.size < 1 ||
    expected.size > maximum ||
    typeof expected.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(expected.sha256)
  )
    throw new Error('INVALID_COPY_BOUND')
  let input, output
  try {
    const before = await lstat(source, { bigint: true })
    if (!before.isFile() || before.isSymbolicLink() || before.size !== BigInt(expected.size))
      throw new Error('UNSAFE_OR_CHANGED_COPY_SOURCE')
    input = await open(
      source,
      constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0),
    )
    const opened = await input.stat({ bigint: true })
    if (!same(before, opened) || !opened.isFile()) throw new Error('COPY_SOURCE_CHANGED')
    output = await open(destination, 'wx', 0o600)
    const buffer = Buffer.alloc(Math.min(65536, expected.size)),
      hash = createHash('sha256')
    let used = 0
    while (used < expected.size) {
      const { bytesRead } = await input.read(
        buffer,
        0,
        Math.min(buffer.length, expected.size - used),
        null,
      )
      if (!bytesRead) throw new Error('COPY_SOURCE_CHANGED')
      hash.update(buffer.subarray(0, bytesRead))
      let written = 0
      while (written < bytesRead) {
        const { bytesWritten } = await output.write(buffer, written, bytesRead - written, null)
        if (!bytesWritten) throw new Error('COPY_WRITE_FAILED')
        written += bytesWritten
      }
      used += bytesRead
    }
    const extra = await input.read(Buffer.alloc(1), 0, 1, null)
    const after = await input.stat({ bigint: true }),
      final = await lstat(source, { bigint: true })
    if (
      extra.bytesRead ||
      !same(opened, after) ||
      !same(after, final) ||
      final.isSymbolicLink() ||
      hash.digest('hex') !== expected.sha256
    )
      throw new Error('COPY_SOURCE_CHANGED')
    await output.sync()
  } finally {
    await Promise.allSettled([input?.close(), output?.close()])
  }
}

// Hash without allocating from file size; same inode and bounded N+1 read at both ends.
export async function digestRecoveryPrivateFile(path, maximum) {
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 536870912)
    throw new Error('INVALID_DIGEST_BOUND')
  let input
  try {
    const before = await lstat(path, { bigint: true })
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.size <= 0n ||
      before.size > BigInt(maximum)
    )
      throw new Error('UNSAFE_OR_OVERSIZED_FILE')
    input = await open(
      path,
      constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0),
    )
    const opened = await input.stat({ bigint: true })
    if (!opened.isFile() || !same(before, opened)) throw new Error('FILE_CHANGED_DURING_COPY')
    const size = Number(opened.size),
      buffer = Buffer.alloc(Math.min(size, 65536)),
      hash = createHash('sha256')
    let used = 0
    while (used < size) {
      const { bytesRead } = await input.read(buffer, 0, Math.min(buffer.length, size - used), null)
      if (!bytesRead) throw new Error('FILE_CHANGED_DURING_COPY')
      hash.update(buffer.subarray(0, bytesRead))
      used += bytesRead
    }
    const extra = await input.read(Buffer.alloc(1), 0, 1, null),
      after = await input.stat({ bigint: true }),
      final = await lstat(path, { bigint: true })
    if (extra.bytesRead || !same(opened, after) || !same(after, final) || final.isSymbolicLink())
      throw new Error('FILE_CHANGED_DURING_COPY')
    return { size, sha256: hash.digest('hex') }
  } finally {
    await input?.close()
  }
}
