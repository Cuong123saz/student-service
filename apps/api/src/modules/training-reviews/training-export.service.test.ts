import { readFile } from 'node:fs/promises'
import { SubmissionError } from '../submissions/submission.types.js'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TrainingExportService } from './training-export.service.js'
import type { TrainingExportSnapshot } from './training-export.types.js'

test('export service does not return private data when fresh authorization fails', async () => {
  const revoked = new Error('Permission revoked after snapshot read')
  const service = new TrainingExportService({
    exportSnapshot: async () => ({ snapshotId: 'sensitive-snapshot' }) as TrainingExportSnapshot,
    recordExport: async () => {},
    assertExportAccess: async () => {
      throw revoked
    },
  })
  await assert.rejects(service.capture('actor', 'period'), (error) => error === revoked)
})

const fixture = async () =>
  JSON.parse(
    await readFile(
      new URL('../../../scripts/fixtures/training-export/snapshot.json', import.meta.url),
      'utf8',
    ),
  ) as TrainingExportSnapshot
const actor = {
  userId: 'actor',
  username: 'actor',
  requestId: 'request',
  ipAddress: '127.0.0.1',
  userAgent: 'unit-test',
}
test('workbook generation is followed by authorization/audit and a revocation returns no bytes', async () => {
  const snapshot = await fixture()
  let revoked = true,
    audits = 0
  const repository = {
    exportSnapshot: async () => snapshot,
    assertExportAccess: async () => {},
    recordExport: async () => {
      if (revoked) throw new SubmissionError(403, 'REVOKED', 'Revoked')
      audits++
    },
  }
  const service = new TrainingExportService(repository, () => Buffer.from('synthetic'))
  await assert.rejects(
    service.downloadXlsx(actor, 'period'),
    (e) => e instanceof SubmissionError && e.statusCode === 403,
  )
  revoked = false
  const file = await service.downloadXlsx(actor, 'period')
  assert.equal(file.name, `training-points-${snapshot.snapshotId}.xlsx`)
  assert.equal(audits, 1)
})
test('render errors, oversized output and audit failure release export capacity without returning a file', async () => {
  const snapshot = await fixture()
  let auditCalls = 0,
    mode = 'render-error'
  const service = new TrainingExportService(
    {
      exportSnapshot: async () => snapshot,
      assertExportAccess: async () => {},
      recordExport: async () => {
        auditCalls++
        throw new Error('audit failure')
      },
    },
    () => {
      if (mode === 'render-error') throw new Error('render failure')
      return Buffer.alloc(mode === 'oversize' ? 8 * 1024 * 1024 + 1 : 32)
    },
  )
  await assert.rejects(service.downloadXlsx(actor, 'period'), /render failure/)
  mode = 'oversize'
  await assert.rejects(
    service.downloadXlsx(actor, 'period'),
    (e) => e instanceof SubmissionError && e.statusCode === 422,
  )
  assert.equal(auditCalls, 0)
  mode = 'audit-error'
  await assert.rejects(service.downloadXlsx(actor, 'period'), /audit failure/)
  assert.equal(auditCalls, 1)
})
test('same-actor and global export concurrency are bounded and capacity is released', async () => {
  const snapshot = await fixture()
  let release!: () => void
  const hold = new Promise<void>((resolve) => {
    release = resolve
  })
  const service = new TrainingExportService(
    {
      exportSnapshot: async () => snapshot,
      assertExportAccess: async () => {},
      recordExport: async () => {},
    },
    async () => {
      await hold
      return Buffer.from('synthetic')
    },
  )
  const first = service.downloadXlsx(actor, 'period'),
    second = service.downloadXlsx({ ...actor, userId: 'second' }, 'period')
  try {
    for (const userId of ['actor', 'third'])
      await assert.rejects(
        service.downloadXlsx({ ...actor, userId }, 'period'),
        (e) => e instanceof SubmissionError && e.statusCode === 429,
      )
  } finally {
    release()
    await Promise.all([first, second])
  }
  await service.downloadXlsx(actor, 'period')
})
