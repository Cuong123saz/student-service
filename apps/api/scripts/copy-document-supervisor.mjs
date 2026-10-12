import { copyFile, lstat, realpath } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
const root = fileURLToPath(new URL('../', import.meta.url))
const source = resolve(root, 'src/modules/submissions/windows-document-supervisor.ps1')
const target = resolve(root, 'dist/modules/submissions/windows-document-supervisor.ps1')
for (const parent of [dirname(source), dirname(target)]) {
  const info = await lstat(parent)
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    resolve(await realpath(parent)).toLowerCase() !== parent.toLowerCase()
  )
    throw new Error('UNSAFE_SUPERVISOR_BUILD')
}
const info = await lstat(source)
if (!info.isFile() || info.isSymbolicLink() || info.size > 65536)
  throw new Error('INVALID_SUPERVISOR_SOURCE')
try {
  const old = await lstat(target)
  if (!old.isFile() || old.isSymbolicLink()) throw new Error('UNSAFE_SUPERVISOR_TARGET')
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}
await copyFile(source, target)
console.log('Document supervisor copied to compiled runtime.')
