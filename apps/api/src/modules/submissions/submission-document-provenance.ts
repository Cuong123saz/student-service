import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, readdir } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'
import { readPrivateFile } from '../../lib/private-file.js'
import { assertDocumentDirectory } from './submission-document-vault.js'
import type { DocumentProvenance } from './submission-document-coordinator.js'
import type {
  ConverterProvenance,
  RendererProvenance,
} from './submission-document-registry.schema.js'

export interface LocalDocumentProvenanceOptions {
  // Compiled API and installed rendering dependency trees; fixed server configuration only.
  codeRoots: string[]
  metadataFiles: string[]
  converterCommand: string
  // Actual soffice.bin when using the Windows command launcher.
  converterBinary: string
}
async function buildDigest(options: LocalDocumentProvenanceOptions) {
  const hash = createHash('sha256')
  let count = 0,
    total = 0,
    directories = 0
  async function file(path: string, label: string) {
    if (++count > 1000) throw new Error('DOCUMENT_BUILD_TOO_LARGE')
    const bytes = await readPrivateFile(path, 16 * 1024 * 1024)
    if ((total += bytes.length) > 64 * 1024 * 1024) throw new Error('DOCUMENT_BUILD_TOO_LARGE')
    hash.update(label + '\0' + bytes.length + '\0').update(bytes)
  }
  async function tree(root: string, prefix: string) {
    if (++directories > 1000) throw new Error('DOCUMENT_BUILD_TOO_LARGE')
    await assertDocumentDirectory(root)
    for (const entry of (await readdir(root, { withFileTypes: true })).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )) {
      const path = join(root, entry.name),
        label = prefix + '/' + entry.name
      const info = await lstat(path)
      if (info.isSymbolicLink()) throw new Error('UNSAFE_DOCUMENT_BUILD')
      if (info.isDirectory()) await tree(path, label)
      else if (!info.isFile()) throw new Error('UNSAFE_DOCUMENT_BUILD')
      else if (/\.(?:[cm]?js|json)$/.test(entry.name)) await file(path, label)
    }
  }
  for (const [index, root] of options.codeRoots.entries()) await tree(root, 'code-' + index)
  for (const [index, path] of options.metadataFiles.entries()) {
    await assertDocumentDirectory(join(path, '..'))
    await file(path, 'metadata-' + index)
  }
  if (!count) throw new Error('EMPTY_DOCUMENT_BUILD')
  return hash.digest('hex')
}
export class LocalDocumentProvenance implements DocumentProvenance {
  private converterSnapshot: ConverterProvenance | undefined
  private launcherSha256: string | undefined
  private constructor(
    private readonly options: LocalDocumentProvenanceOptions,
    private readonly buildSha256: string,
  ) {}
  static async create(options: LocalDocumentProvenanceOptions) {
    if (
      !options.codeRoots.length ||
      !options.metadataFiles.length ||
      options.codeRoots.length > 8 ||
      options.metadataFiles.length > 16 ||
      [
        ...options.codeRoots,
        ...options.metadataFiles,
        options.converterCommand,
        options.converterBinary,
      ].some((path) => !isAbsolute(path))
    )
      throw new Error('INVALID_DOCUMENT_PROVENANCE_CONFIG')
    const frozen = structuredClone(options)
    return new LocalDocumentProvenance(frozen, await buildDigest(frozen))
  }
  async renderer(): Promise<RendererProvenance> {
    // Do not hash newly edited disk code and falsely attribute already-loaded modules to it.
    if ((await buildDigest(this.options)) !== this.buildSha256)
      throw new Error('DOCUMENT_DEPLOYMENT_CHANGED')
    if (!process.versions.icu) throw new Error('DOCUMENT_ICU_UNAVAILABLE')
    return {
      version: 'submission-declaration-v1',
      buildSha256: this.buildSha256,
      nodeVersion: process.versions.node,
      icuVersion: process.versions.icu,
    }
  }
  async converter(): Promise<ConverterProvenance> {
    await assertDocumentDirectory(join(this.options.converterCommand, '..'))
    await assertDocumentDirectory(join(this.options.converterBinary, '..'))
    // Bound both launcher and actual executable; the launcher alone is not the conversion binary.
    const commandBefore = await readPrivateFile(this.options.converterCommand, 16 * 1024 * 1024)
    const binaryBefore = await readPrivateFile(this.options.converterBinary, 16 * 1024 * 1024)
    const { stdout } = await promisify(execFile)(this.options.converterCommand, ['--version'], {
      windowsHide: true,
      timeout: 5000,
      maxBuffer: 4096,
      encoding: 'utf8',
    })
    const version = stdout.trim()
    if (
      !version ||
      version.length > 200 ||
      [...version].some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      )
    )
      throw new Error('INVALID_DOCUMENT_CONVERTER_VERSION')
    if (
      !commandBefore.equals(
        await readPrivateFile(this.options.converterCommand, 16 * 1024 * 1024),
      ) ||
      !binaryBefore.equals(await readPrivateFile(this.options.converterBinary, 16 * 1024 * 1024))
    )
      throw new Error('DOCUMENT_CONVERTER_CHANGED')
    const launcherSha256 = createHash('sha256').update(commandBefore).digest('hex')
    if (this.launcherSha256 && this.launcherSha256 !== launcherSha256)
      throw new Error('DOCUMENT_CONVERTER_CHANGED')
    const snapshot = {
      version,
      binarySha256: createHash('sha256').update(binaryBefore).digest('hex'),
    }
    if (
      this.converterSnapshot &&
      (this.converterSnapshot.version !== version ||
        this.converterSnapshot.binarySha256 !== snapshot.binarySha256)
    )
      throw new Error('DOCUMENT_CONVERTER_CHANGED')
    this.converterSnapshot = snapshot
    this.launcherSha256 = launcherSha256
    return { ...snapshot }
  }
}
