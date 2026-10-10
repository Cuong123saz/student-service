import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { after, test } from 'node:test'
import postgres from 'postgres'
import { databaseClient } from '../../db/client.js'
import type { DraftValues, StudentSnapshot, RoundEvidence } from './submission.types.js'
interface MigratedSubmission {
  round_number: number
  last_submitted_at: Date | null
  decision_at: Date | null
}
interface MigratedRound {
  id: string
  submission_id: string
  round_number: number
  source: string
  values: DraftValues
  student_snapshot: StudentSnapshot
  submitted_at: Date
  files: RoundEvidence[]
}
after(() => databaseClient.end())
test('0017 backfills immutable rounds and 0018 preserves existing dossiers without invented notifications', async () => {
  const url = new URL(process.env.DATABASE_URL ?? 'http://invalid')
  assert.equal(url.port, '5434')
  assert.equal(url.pathname, '/student_service_test')
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname))
  const temporaryName = 'resolution_migration_test_' + randomUUID().replaceAll('-', '')
  assert.match(temporaryName, /^resolution_migration_test_[a-f0-9]{32}$/)
  const base = postgres(url.toString(), { max: 1, onnotice: () => {} })
  let temporary: ReturnType<typeof postgres> | undefined
  let created = false
  try {
    await base.unsafe('CREATE DATABASE "' + temporaryName + '"')
    created = true
    url.pathname = '/' + temporaryName
    temporary = postgres(url.toString(), { max: 1, onnotice: () => {} })
    const journal = JSON.parse(
      await readFile(new URL('../../../drizzle/meta/_journal.json', import.meta.url), 'utf8'),
    ) as { entries: { idx: number; tag: string }[] }
    for (const entry of journal.entries.filter((entry) => entry.idx <= 16)) {
      const source = await readFile(
        new URL('../../../drizzle/' + entry.tag + '.sql', import.meta.url),
        'utf8',
      )
      await temporary.begin(async (tx) => {
        for (const statement of source
          .split('--> statement-breakpoint')
          .filter((part) => part.trim()))
          await tx.unsafe(statement)
      })
    }
    const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()]
    const unitId = randomUUID(),
      versionId = randomUUID()
    for (const [index, id] of ids.entries())
      await temporary`INSERT INTO users(id,username,full_name,must_change_password) VALUES(${id},${'backfill-' + index},${'Backfill ' + index},false)`
    await temporary`INSERT INTO organizational_units(id,code,name) VALUES(${unitId},'BACKFILL','Backfill')`
    const [service] = await temporary<
      { id: number }[]
    >`INSERT INTO services(code,name,description,processing_days) VALUES('BACKFILL','Backfill','Test',3) RETURNING id`
    await temporary`INSERT INTO procedure_versions(id,service_id,owner_unit_id,version_number,status,published_at,config,created_by,updated_by) VALUES(${versionId},${service!.id},${unitId},1,'PUBLISHED',now(),'{}'::jsonb,${ids[0]!},${ids[0]!})`
    const rows: {
      id: string
      fileId: string
      storageKey: string
      values: { purpose: string }
      snapshot: { fullName: string; studentCode: string; classCode: string; facultyCode: string }
    }[] = []
    for (let index = 0; index < 3; index++) {
      const id = randomUUID(),
        fileId = randomUUID(),
        storageKey = randomUUID()
      const values = { purpose: 'Original ' + index },
        snapshot = {
          fullName: 'Student ' + index,
          studentCode: 'S' + index,
          classCode: 'C',
          facultyCode: 'F',
        }
      await temporary`INSERT INTO submissions(id,student_user_id,service_id,procedure_version_id,service_name,procedure,values) VALUES(${id},${ids[index]!},${service!.id},${versionId},'Backfill','{}'::jsonb,${temporary.json(values)})`
      await temporary`INSERT INTO submission_files(id,submission_id,attachment_key,name,mime_type,size,sha256,storage_key) VALUES(${fileId},${id},'proof','original.pdf','application/pdf',12,${'a'.repeat(64)},${storageKey})`
      if (index > 0)
        await temporary`UPDATE submissions SET status='SUBMITTED',revision=2,submitted_at='2026-10-09T02:00:00Z',processing_unit_id=${unitId},student_snapshot=${temporary.json(snapshot)} WHERE id=${id}`
      if (index === 2)
        await temporary`UPDATE submissions SET status='IN_REVIEW',revision=3,reviewer_user_id=${ids[3]!},review_started_at='2026-10-09T03:00:00Z' WHERE id=${id}`
      rows.push({ id, fileId, storageKey, values, snapshot })
    }
    const migration = await readFile(
      new URL('../../../drizzle/0017_submission_resolution.sql', import.meta.url),
      'utf8',
    )
    await temporary.begin(async (tx) => {
      for (const statement of migration
        .split('--> statement-breakpoint')
        .filter((part) => part.trim()))
        await tx.unsafe(statement)
    })
    assert.equal(Number((await temporary`SELECT count(*) FROM submission_events`)[0]!.count), 0)
    const rounds = await temporary<
      MigratedRound[]
    >`SELECT * FROM submission_rounds ORDER BY submission_id`
    assert.equal(rounds.length, 2)
    assert.ok(!rounds.some((round) => round.submission_id === rows[0]!.id))
    for (const row of rows.slice(1)) {
      const round = rounds.find((round) => round.submission_id === row.id)!
      assert.equal(round.round_number, 1)
      assert.equal(round.source, 'MIGRATION')
      assert.deepEqual(round.values, row.values)
      assert.deepEqual(round.student_snapshot, row.snapshot)
      assert.equal(round.submitted_at.toISOString(), '2026-10-09T02:00:00.000Z')
      assert.deepEqual(
        round.files.map((file: { id: string; storageKey: string }) => [file.id, file.storageKey]),
        [[row.fileId, row.storageKey]],
      )
      const records: MigratedSubmission[] = await temporary<
        MigratedSubmission[]
      >`SELECT * FROM submissions WHERE id=${row.id}`
      assert.equal(records[0]!.round_number, 1)
      assert.equal(records[0]!.last_submitted_at?.toISOString(), round.submitted_at.toISOString())
      await assert.rejects(
        () => temporary!`UPDATE submission_rounds SET values='{}'::jsonb WHERE id=${round.id}`,
      )
      await assert.rejects(() => temporary!`DELETE FROM submission_rounds WHERE id=${round.id}`)
    }
    const [draft] = await temporary<
      { round_number: number; last_submitted_at: Date | null; decision_at: Date | null }[]
    >`SELECT * FROM submissions WHERE id=${rows[0]!.id}`
    assert.equal(draft!.round_number, 0)
    assert.equal(draft!.last_submitted_at, null)
    assert.equal(draft!.decision_at, null)
    const handover = await readFile(
      new URL('../../../drizzle/0018_submission_handover_notifications.sql', import.meta.url),
      'utf8',
    )
    const beforeHandover = await temporary`SELECT * FROM submissions ORDER BY id`
    await temporary.begin(async (tx) => {
      for (const statement of handover
        .split('--> statement-breakpoint')
        .filter((part) => part.trim()))
        await tx.unsafe(statement)
    })
    assert.deepEqual(await temporary`SELECT * FROM submissions ORDER BY id`, beforeHandover)
    assert.equal(
      Number((await temporary`SELECT count(*) FROM personal_notifications`)[0]!.count),
      0,
    )
    assert.equal(Number((await temporary`SELECT count(*) FROM submission_events`)[0]!.count), 0)
    assert.equal(Number((await temporary`SELECT count(*) FROM submission_rounds`)[0]!.count), 2)
  } finally {
    await temporary?.end()
    if (created) await base.unsafe('DROP DATABASE "' + temporaryName + '"')
    await base.end()
  }
})
