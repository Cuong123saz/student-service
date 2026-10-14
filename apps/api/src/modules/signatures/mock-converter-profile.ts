import { constants, type BigIntStats } from 'node:fs'
import { createHash } from 'node:crypto'
import { lstat, mkdir, open, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readPrivateFile } from '../../lib/private-file.js'
import { assertDocumentDirectory } from '../submissions/submission-document-vault.js'
interface Entry {
  path: string
  size: number
  sha256: string
}
interface Manifest {
  version: 1
  fakeDataOnly: true
  binarySha256: string
  files: Entry[]
}
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const hex = /^[a-f0-9]{64}$/
const maximumFile = 4 * 1024 * 1024,
  maximumTotal = 32 * 1024 * 1024
const sameEmptyFile = (a: BigIntStats, b: BigIntStats) =>
  a.dev === b.dev &&
  a.ino === b.ino &&
  a.size === 0n &&
  b.size === 0n &&
  a.mtimeNs === b.mtimeNs &&
  a.ctimeNs === b.ctimeNs
async function readEmptyProfileFile(path: string): Promise<Buffer> {
  const before = await lstat(path, { bigint: true })
  if (!before.isFile() || before.isSymbolicLink() || before.size !== 0n)
    throw new Error('MOCK_PROFILE_FILE_CHANGED')
  const handle = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0),
  )
  try {
    const opened = await handle.stat({ bigint: true })
    if (!opened.isFile() || !sameEmptyFile(before, opened))
      throw new Error('MOCK_PROFILE_FILE_CHANGED')
    const probe = await handle.read(Buffer.alloc(1), 0, 1, 0),
      after = await handle.stat({ bigint: true }),
      final = await lstat(path, { bigint: true })
    if (
      probe.bytesRead !== 0 ||
      !sameEmptyFile(opened, after) ||
      !sameEmptyFile(after, final) ||
      final.isSymbolicLink()
    )
      throw new Error('MOCK_PROFILE_FILE_CHANGED')
    return Buffer.alloc(0)
  } finally {
    await handle.close()
  }
}
const readProfileFile = (path: string, size: number) =>
  size === 0 ? readEmptyProfileFile(path) : readPrivateFile(path, size)
// Percent escapes are literal filesystem names from LibreOffice extension caches; never URL-decode them.
function manifest(value: unknown): Manifest {
  const object = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v)
  if (
    !object(value) ||
    Object.keys(value).sort().join(',') !== 'binarySha256,fakeDataOnly,files,version' ||
    value.version !== 1 ||
    value.fakeDataOnly !== true ||
    typeof value.binarySha256 !== 'string' ||
    !hex.test(value.binarySha256) ||
    !Array.isArray(value.files) ||
    value.files.length < 1 ||
    value.files.length > 512
  )
    throw new Error('INVALID_MOCK_PROFILE_MANIFEST')
  const paths = new Set<string>()
  let total = 0
  for (const item of value.files as unknown[]) {
    if (
      !object(item) ||
      Object.keys(item).sort().join(',') !== 'path,sha256,size' ||
      typeof item.path !== 'string' ||
      !/^(?:[A-Za-z0-9_.%-]+\/)*[A-Za-z0-9_.%-]+$/.test(item.path) ||
      item.path.split('/').some((p) => p === '.' || p === '..' || p === '.lock') ||
      paths.has(item.path.toLowerCase()) ||
      !Number.isSafeInteger(item.size) ||
      Number(item.size) < 0 ||
      Number(item.size) > maximumFile ||
      typeof item.sha256 !== 'string' ||
      !hex.test(item.sha256)
    )
      throw new Error('INVALID_MOCK_PROFILE_ENTRY')
    paths.add(item.path.toLowerCase())
    total += Number(item.size)
  }
  if (total > maximumTotal) throw new Error('MOCK_PROFILE_TOO_LARGE')
  return value as unknown as Manifest
}
export async function bootstrapMockConverterProfile(
  root: string,
  docx: Buffer,
  binary: string,
  run: (args: string[]) => Promise<{ outcome: string; empty: boolean }>,
  options: { fakeDataOnly: true },
) {
  if (
    options?.fakeDataOnly !== true ||
    !Buffer.isBuffer(docx) ||
    docx.length < 1 ||
    docx.length > 16 * 1024 * 1024
  )
    throw new Error('REQUIRES_FAKE_PROFILE_BOOTSTRAP')
  await assertDocumentDirectory(dirname(root))
  await mkdir(root, { mode: 0o700 })
  await assertDocumentDirectory(root)
  const profile = join(root, 'profile'),
    input = join(root, 'input.docx')
  await mkdir(profile, { mode: 0o700 })
  await writeFile(input, docx, { flag: 'wx', mode: 0o600 })
  const args = [
    '-env:UserInstallation=' + pathToFileURL(profile).href,
    '--headless',
    '--nologo',
    '--norestore',
    '--convert-to',
    'pdf:writer_pdf_Export',
    '--outdir',
    root,
    input,
  ]
  let attempts = 0
  for (; attempts < 2; attempts++) {
    const result = await run(args)
    if (!result.empty) throw new Error('MOCK_PROFILE_PROCESS_NOT_REAPED')
    if (result.outcome === 'EXITED') break
    if (result.outcome !== 'TIMEOUT' || attempts !== 0)
      throw new Error('MOCK_PROFILE_BOOTSTRAP_FAILED')
  }
  if (attempts === 2) throw new Error('MOCK_PROFILE_BOOTSTRAP_FAILED')
  const pdf = await readPrivateFile(join(root, 'input.pdf'), 16 * 1024 * 1024)
  if (
    pdf.length < 100 ||
    pdf.subarray(0, 5).toString('ascii') !== '%PDF-' ||
    !pdf.subarray(-1024).includes(Buffer.from('%%EOF'))
  )
    throw new Error('MOCK_PROFILE_PDF_INVALID')
  const files: Entry[] = []
  let total = 0,
    directories = 0
  async function walk(directory: string, prefix: string) {
    if (++directories > 512 || prefix.split('/').length > 16)
      throw new Error('MOCK_PROFILE_TOO_LARGE')
    await assertDocumentDirectory(directory)
    for (const name of (await readdir(directory)).sort()) {
      if (name === '.lock') continue
      const path = join(directory, name),
        relative = prefix + name,
        stat = await lstat(path)
      if (stat.isSymbolicLink()) throw new Error('UNSAFE_MOCK_PROFILE')
      if (stat.isDirectory()) await walk(path, relative + '/')
      else if (stat.isFile()) {
        if (files.length >= 512) throw new Error('MOCK_PROFILE_TOO_LARGE')
        const bytes =
          stat.size === 0
            ? await readEmptyProfileFile(path)
            : await readPrivateFile(path, maximumFile)
        total += bytes.length
        if (total > maximumTotal) throw new Error('MOCK_PROFILE_TOO_LARGE')
        files.push({ path: relative, size: bytes.length, sha256: digest(bytes) })
      } else throw new Error('UNSAFE_MOCK_PROFILE')
    }
  }
  await walk(profile, '')
  const value = manifest({
    version: 1,
    fakeDataOnly: true,
    binarySha256: digest(await readPrivateFile(binary, 16 * 1024 * 1024)),
    files,
  })
  await writeFile(join(root, 'manifest.json'), JSON.stringify(value, null, 2) + '\n', {
    flag: 'wx',
    mode: 0o600,
  })
  return {
    attempts: attempts + 1,
    files: files.length,
    bytes: total,
    profileRoot: profile,
    manifestPath: join(root, 'manifest.json'),
  }
}
export async function loadMockConverterProfile(root: string, manifestPath: string, binary: string) {
  await assertDocumentDirectory(root)
  const bytes = await readPrivateFile(manifestPath, 1024 * 1024),
    value = manifest(JSON.parse(bytes.toString('utf8')) as unknown),
    pin = digest(bytes)
  async function deployment() {
    await assertDocumentDirectory(root)
    if (
      digest(await readPrivateFile(manifestPath, 1024 * 1024)) !== pin ||
      digest(await readPrivateFile(binary, 16 * 1024 * 1024)) !== value.binarySha256
    )
      throw new Error('MOCK_PROFILE_DEPLOYMENT_CHANGED')
  }
  await deployment()
  return async (target: string) => {
    await deployment()
    await assertDocumentDirectory(dirname(target))
    await mkdir(target, { mode: 0o700 })
    await assertDocumentDirectory(target)
    for (const entry of value.files) {
      const source = join(root, ...entry.path.split('/')),
        destination = join(target, ...entry.path.split('/'))
      await assertDocumentDirectory(dirname(source))
      const contents = await readProfileFile(source, entry.size)
      if (contents.length !== entry.size || digest(contents) !== entry.sha256)
        throw new Error('MOCK_PROFILE_FILE_CHANGED')
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
      await assertDocumentDirectory(dirname(destination))
      await writeFile(destination, contents, { flag: 'wx', mode: 0o600 })
      if (digest(await readProfileFile(destination, entry.size)) !== entry.sha256)
        throw new Error('MOCK_PROFILE_COPY_CHANGED')
    }
    await deployment()
  }
}
