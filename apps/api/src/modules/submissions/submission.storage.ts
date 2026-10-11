import { readPrivateFile } from '../../lib/private-file.js'
import { randomUUID } from 'node:crypto'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
export interface EvidenceStorage {
  put(bytes: Buffer): Promise<string>
  read(key: string): Promise<Buffer>
  remove(key: string): Promise<void>
}
export class LocalEvidenceStorage implements EvidenceStorage {
  constructor(
    private readonly root = resolve(
      process.env.SUBMISSION_STORAGE_ROOT || '.local/submission-files',
    ),
  ) {}
  private path(key: string) {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(key))
      throw new Error('Invalid storage key')
    return resolve(this.root, key)
  }
  async put(bytes: Buffer) {
    if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw new Error('INVALID_EVIDENCE_SIZE')
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    const key = randomUUID()
    await writeFile(this.path(key), bytes, { flag: 'wx', mode: 0o600 })
    return key
  }
  read(key: string) {
    return readPrivateFile(this.path(key), 5 * 1024 * 1024)
  }
  async remove(key: string) {
    await unlink(this.path(key))
  }
}
