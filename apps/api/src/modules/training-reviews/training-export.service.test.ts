import { createHash } from 'node:crypto'
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

test('PDF minutes are converted from the exact DOCX bytes and the audit links both hashes', async () => {
  const snapshot = await fixture()
  const receipts: unknown[] = []
  const docx = Buffer.from('synthetic-docx')
  let converted: Buffer | undefined
  const service = new TrainingExportService(
    {
      exportSnapshot: async () => snapshot,
      assertExportAccess: async () => {},
      recordExport: async (_actor, _period, receipt) => {
        receipts.push(receipt)
      },
    },
    () => Buffer.from('unused-xlsx'),
    () => docx,
    {
      convert: async (input) => {
        converted = input
        return Buffer.from('%PDF-synthetic')
      },
    },
  )
  const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')
  const word = await service.downloadMinutes(actor, 'period', 'docx')
  assert.equal(word.sha256, sha(docx))
  assert.equal(word.name, `training-minutes-${snapshot.snapshotId}.docx`)
  assert.equal(word.templateVersion, 'training-minutes-v1')
  assert.equal(word.sourceDocxSha256, undefined)
  const pdf = await service.downloadMinutes(actor, 'period', 'pdf')
  assert.equal(converted, docx)
  assert.equal(pdf.mimeType, 'application/pdf')
  assert.equal(pdf.sha256, sha(Buffer.from('%PDF-synthetic')))
  assert.equal(pdf.sourceDocxSha256, sha(docx))
  assert.deepEqual(receipts, [
    {
      format: 'DOCX',
      snapshotId: snapshot.snapshotId,
      rowCount: snapshot.rows.length,
      sha256: sha(docx),
      size: docx.length,
      templateVersion: 'training-minutes-v1',
    },
    {
      format: 'PDF',
      snapshotId: snapshot.snapshotId,
      rowCount: snapshot.rows.length,
      sha256: pdf.sha256,
      size: pdf.bytes.length,
      templateVersion: 'training-minutes-v1',
      sourceDocxSha256: sha(docx),
    },
  ])
})

test('converter failures map to minutes errors, write no audit and release the export slot', async () => {
  const snapshot = await fixture()
  let audits = 0,
    failure: Error = new SubmissionError(503, 'DOCUMENT_BUSY', 'busy')
  const service = new TrainingExportService(
    {
      exportSnapshot: async () => snapshot,
      assertExportAccess: async () => {},
      recordExport: async () => {
        audits++
      },
    },
    () => Buffer.from('unused'),
    () => Buffer.from('docx'),
    {
      convert: async () => {
        throw failure
      },
    },
  )
  for (const [error, code] of [
    [new SubmissionError(503, 'DOCUMENT_BUSY', 'busy'), 'TRAINING_EXPORT_PDF_BUSY'],
    [
      new SubmissionError(503, 'DOCUMENT_CONVERTER_QUARANTINED', 'quarantined'),
      'TRAINING_EXPORT_PDF_QUARANTINED',
    ],
    [new SubmissionError(503, 'DOCUMENT_PDF_UNAVAILABLE', 'x'), 'TRAINING_EXPORT_PDF_UNAVAILABLE'],
    [new Error('DOCUMENT_CONVERSION_TIMEOUT'), 'TRAINING_EXPORT_PDF_UNAVAILABLE'],
  ] as const) {
    failure = error
    await assert.rejects(
      service.downloadMinutes(actor, 'period', 'pdf'),
      (e) => e instanceof SubmissionError && e.statusCode === 503 && e.code === code,
    )
  }
  assert.equal(audits, 0)
  // The same account can export again immediately: the slot was released on failure.
  assert.equal((await service.downloadMinutes(actor, 'period', 'docx')).bytes.toString(), 'docx')
  assert.equal(audits, 1)
})

test('authorization revoked after DOCX/PDF rendering returns no minutes bytes', async () => {
  const snapshot = await fixture()
  let conversions = 0
  const service = new TrainingExportService(
    {
      exportSnapshot: async () => snapshot,
      assertExportAccess: async () => {},
      recordExport: async () => {
        throw new SubmissionError(404, 'TRAINING_PERIOD_NOT_FOUND', 'gone')
      },
    },
    () => Buffer.from('unused'),
    () => Buffer.from('docx'),
    {
      convert: async () => {
        conversions++
        return Buffer.from('%PDF-synthetic')
      },
    },
  )
  for (const format of ['docx', 'pdf'] as const)
    await assert.rejects(
      service.downloadMinutes(actor, 'period', format),
      (e) => e instanceof SubmissionError && e.statusCode === 404,
    )
  assert.equal(conversions, 1)
})

test('XLSX and minutes exports share one per-account slot', async () => {
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
      return Buffer.from('xlsx')
    },
    () => Buffer.from('docx'),
  )
  const running = service.downloadXlsx(actor, 'period')
  try {
    await assert.rejects(
      service.downloadMinutes(actor, 'period', 'docx'),
      (e) => e instanceof SubmissionError && e.statusCode === 429,
    )
  } finally {
    release()
    await running
  }
})
