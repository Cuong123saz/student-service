import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { test } from 'node:test'
import postgres from 'postgres'
import { auditConfiguration, auditEvidence, readEvidenceReferences } from './evidence-integrity.mjs'

const { databaseUrl } = auditConfiguration({ ...process.env, SUBMISSION_STORAGE_ROOT: tmpdir() })
if (process.env.APP_ENV !== 'test') throw new Error('Requires APP_ENV=test')

test('SQL reader preserves removed/history references, strips personal fields, and tolerates malformed legacy JSON', async (t) => {
  const client = postgres(databaseUrl, { max: 1, onnotice: () => {} })
  t.after(() => client.end({ timeout: 5 }))
  const root = await mkdtemp(join(tmpdir(), 'student-evidence-sql-'))
  t.after(async () => {
    assert.ok(isAbsolute(root) && root.startsWith(join(tmpdir(), 'student-evidence-sql-')))
    await rm(root, { recursive: true, force: true })
  })
  const bytes = Buffer.from('original bytes'),
    fileId = randomUUID(),
    submissionId = randomUUID(),
    key = randomUUID()
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  await writeFile(join(root, key), bytes)
  await client.begin(async (tx) => {
    // Temp tables are connection-private and drop on commit; permanent tables are untouched.
    await tx`CREATE TEMP TABLE submission_files (LIKE public.submission_files INCLUDING DEFAULTS) ON COMMIT DROP`
    await tx`CREATE TEMP TABLE submission_rounds (LIKE public.submission_rounds INCLUDING DEFAULTS) ON COMMIT DROP`
    await tx`INSERT INTO pg_temp.submission_files
      (id, submission_id, attachment_key, name, mime_type, size, sha256, storage_key, removed_at)
      VALUES (${fileId}, ${submissionId}, 'evidence', 'PRIVATE_FILE_NAME.pdf', 'application/pdf',
        ${bytes.length}, ${sha256}, ${key}, now())`
    const file = {
      id: fileId,
      storageKey: key,
      size: bytes.length,
      sha256,
      name: 'PRIVATE_FILE_NAME.pdf',
    }
    for (const files of [[file], [], null, { invalid: 'PRIVATE_ANSWER' }, [null, 42]])
      await tx`INSERT INTO pg_temp.submission_rounds
        (id, submission_id, round_number, submitted_at, student_snapshot, values, files, source, declaration_template)
        VALUES (${randomUUID()}, ${submissionId}, 1, now(), ${tx.json({ fullName: 'PRIVATE_STUDENT' })},
          ${tx.json({ answer: 'PRIVATE_ANSWER' })}, ${JSON.stringify(files)}::text::jsonb, 'LIVE',
          ${tx.json({ id: 'submission-summary-v1', sha256: '9074a0b961cf66b625d4339c4473a42c7bfc3d981816f821fa78552c7fae8ca2', bindingSource: 'SUBMITTED' })})`
    const refs = []
    for await (const ref of readEvidenceReferences(tx, 'pg_temp')) refs.push(ref)
    assert.equal(refs.filter((ref) => ref.kind === 'CURRENT').length, 1)
    assert.equal(refs.find((ref) => ref.kind === 'CURRENT').removed, true)
    assert.equal(refs.filter((ref) => ref.kind === 'HISTORY').length, 3)
    assert.equal(refs.filter((ref) => ref.kind === 'INVALID_ROUND').length, 2)
    assert.ok(!JSON.stringify(refs).includes('PRIVATE_'))
    const report = await auditEvidence({ root, references: refs })
    assert.equal(report.counts.verifiedFiles, 1)
    assert.equal(report.issuesByCode.INVALID_ROUND, 2)
    assert.equal(report.issuesByCode.INVALID_REFERENCE, 2)
    assert.equal(report.issuesByCode.HISTORY_METADATA_MISMATCH, undefined)
    await tx`INSERT INTO pg_temp.submission_files
      (id, submission_id, attachment_key, name, mime_type, size, sha256, storage_key)
      SELECT gen_random_uuid(), ${submissionId}, 'evidence', 'PRIVATE_FILE_NAME.pdf',
        'application/pdf', ${bytes.length}, ${sha256}, gen_random_uuid()
      FROM generate_series(1, 300)`
    let currentCount = 0
    for await (const ref of readEvidenceReferences(tx, 'pg_temp'))
      if (ref.kind === 'CURRENT') currentCount++
    assert.equal(currentCount, 301, 'Reads beyond the first 256-row cursor batch')
  })
  await client.begin('isolation level repeatable read read only', async (tx) => {
    // Exercises the exact production queries against the migrated schema without writing it.
    for await (const ref of readEvidenceReferences(tx)) assert.ok(ref.kind)
    const [mode] = await tx`SHOW transaction_read_only`
    assert.equal(mode.transaction_read_only, 'on')
  })
})
