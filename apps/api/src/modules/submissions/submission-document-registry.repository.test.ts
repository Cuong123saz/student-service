import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { after, test } from 'node:test'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { databaseClient } from '../../db/client.js'
import {
  DrizzleSubmissionDocumentRegistry,
  type DocumentClaim,
  type DocumentLease,
  type PublishDocument,
} from './submission-document-registry.repository.js'
import { newDeclarationTemplateBinding } from './submission-document-template.js'
after(() => databaseClient.end())
function lease(result: DocumentClaim): DocumentLease {
  assert.equal(result.state, 'CLAIMED')
  if (result.state !== 'CLAIMED') throw new Error('Expected claimed job')
  return result.lease
}
function metadata(format: 'DOCX' | 'PDF' = 'DOCX'): PublishDocument {
  return {
    size: 100,
    sha256: (format === 'DOCX' ? 'a' : 'b').repeat(64),
    template: newDeclarationTemplateBinding(),
    renderer: {
      version: 'test-v1',
      buildSha256: 'c'.repeat(64),
      nodeVersion: '22.23.2',
      icuVersion: '78.2',
    },
    converter: format === 'PDF' ? { version: 'fake-only', binarySha256: 'd'.repeat(64) } : null,
    sourceDocxSha256: format === 'PDF' ? 'a'.repeat(64) : null,
  }
}
const pgCode =
  (code: string) =>
  (error: unknown): boolean => {
    let current = error
    for (let i = 0; i < 5; i++) {
      if (typeof current !== 'object' || current === null) return false
      if ('code' in current && current.code === code) return true
      current = 'cause' in current ? current.cause : undefined
    }
    return false
  }

test('0023 registry preserves old rows and enforces lease, publication and provenance on a private database', async (t) => {
  const url = new URL(process.env.DATABASE_URL ?? 'http://invalid')
  assert.equal(url.port, '5434')
  assert.equal(url.pathname, '/student_service_test')
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname))
  const name = 'document_registry_test_' + randomUUID().replaceAll('-', '')
  assert.match(name, /^document_registry_test_[a-f0-9]{32}$/)
  const admin = postgres(url.toString(), { max: 1, onnotice: () => {} })
  let q: ReturnType<typeof postgres> | undefined
  let orm: ReturnType<typeof postgres> | undefined
  try {
    await admin.unsafe('CREATE DATABASE "' + name + '"')
    url.pathname = '/' + name
    q = postgres(url.toString(), { max: 5, onnotice: () => {} })
    const client = q
    const journal = JSON.parse(
      await readFile(new URL('../../../drizzle/meta/_journal.json', import.meta.url), 'utf8'),
    ) as { entries: { idx: number; tag: string }[] }
    const migrate = async (tag: string) => {
      const source = await readFile(
        new URL('../../../drizzle/' + tag + '.sql', import.meta.url),
        'utf8',
      )
      await client.begin(async (tx) => {
        for (const statement of source.split('--> statement-breakpoint').filter((s) => s.trim()))
          await tx.unsafe(statement)
      })
    }
    for (const entry of journal.entries.filter((e) => e.idx <= 22)) await migrate(entry.tag)
    orm = postgres(url.toString(), { max: 5, onnotice: () => {} })
    const ormClient = orm
    const registry = new DrizzleSubmissionDocumentRegistry(drizzle(ormClient), 10, 0)
    const second = new DrizzleSubmissionDocumentRegistry(drizzle(ormClient), 10, 0)
    async function fixture() {
      const student = randomUUID(),
        unit = randomUUID(),
        version = randomUUID(),
        id = randomUUID(),
        round = randomUUID()
      await client`INSERT INTO users(id,username,full_name,must_change_password) VALUES(${student},${'registry-' + student},'Synthetic student',false)`
      await client`INSERT INTO organizational_units(id,code,name) VALUES(${unit},${'REG-' + unit},'Synthetic unit')`
      const [service] = await client<
        { id: number }[]
      >`INSERT INTO services(code,name,description,processing_days) VALUES(${'REG-' + id},'Synthetic service','Test',1) RETURNING id`
      await client`INSERT INTO procedure_versions(id,service_id,owner_unit_id,version_number,status,published_at,config,created_by,updated_by) VALUES(${version},${service!.id},${unit},1,'PUBLISHED',now(),'{}'::jsonb,${student},${student})`
      await client`INSERT INTO submissions(id,student_user_id,service_id,procedure_version_id,service_name,procedure,values) VALUES(${id},${student},${service!.id},${version},'Synthetic service','{}'::jsonb,'{}'::jsonb)`
      await client`UPDATE submissions SET status='SUBMITTED',revision=2,round_number=1,submitted_at=now(),last_submitted_at=now(),processing_unit_id=${unit},student_snapshot='{"fullName":"Synthetic student","studentCode":"TEST","classCode":"TEST","facultyCode":"TEST"}'::jsonb WHERE id=${id}`
      await client`INSERT INTO submission_rounds(id,submission_id,round_number,submitted_at,student_snapshot,values,files,source,declaration_template) VALUES(${round},${id},1,now(),'{}'::jsonb,'{}'::jsonb,'[]'::jsonb,'LIVE',${client.json({ ...newDeclarationTemplateBinding() })})`
      return { id, round }
    }
    const existing = await fixture()
    const oldTables = await client<
      { tablename: string }[]
    >`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`
    const snapshots = new Map<string, string>()
    for (const { tablename } of oldTables) {
      assert.match(tablename, /^[a-z_]+$/)
      const rows = await client.unsafe(
        'SELECT row_to_json(t)::text AS value FROM public."' +
          tablename +
          '" t ORDER BY row_to_json(t)::text',
      )
      snapshots.set(tablename, JSON.stringify(rows))
    }
    await migrate('0023_document_registry')
    await t.test(
      'migration does not rewrite existing dossier, history, permissions, audit or notifications',
      async () => {
        for (const [table, before] of snapshots) {
          const rows = await client.unsafe(
            'SELECT row_to_json(t)::text AS value FROM public."' +
              table +
              '" t ORDER BY row_to_json(t)::text',
          )
          assert.equal(JSON.stringify(rows), before, table)
        }
        const [countRow] = await client`SELECT count(*)::int AS count FROM submission_document_sets`
        assert.equal(countRow!.count, 0)
        assert.equal((await registry.ensureSet(existing.id, 1)).roundId, existing.round)
      },
    )
    async function reset() {
      const [current] = await client`SELECT current_database() AS name`
      assert.equal(current!.name, name)
      await client.unsafe(
        'TRUNCATE submission_document_jobs, submission_documents, submission_document_sets, audit_logs',
      )
    }
    async function set() {
      const f = await fixture()
      return registry.ensureSet(f.id, 1)
    }
    async function run(label: string, fn: () => Promise<void>) {
      await reset()
      await t.test(label, fn)
    }
    await run('concurrent set creation is idempotent', async () => {
      const f = await fixture()
      const [a, b] = await Promise.all([registry.ensureSet(f.id, 1), second.ensureSet(f.id, 1)])
      assert.equal(a.id, b.id)
    })
    await run('two connections claim one format exactly once', async () => {
      const s = await set(),
        claims = await Promise.all([registry.claim(s.id, 'DOCX'), second.claim(s.id, 'DOCX')])
      assert.equal(claims.filter((c) => c.state === 'CLAIMED').length, 1)
      assert.equal(claims.filter((c) => c.state === 'BUSY').length, 1)
      const [job] = await client`SELECT * FROM submission_document_jobs WHERE set_id=${s.id}`
      assert.equal(job!.attempts, 1)
    })
    await run(
      'Word publication is atomic, immutable and reused after a lost response',
      async () => {
        const s = await set(),
          l = lease(await registry.claim(s.id, 'DOCX'))
        const word = await registry.publish(l, metadata())
        const again = await second.claim(s.id, 'DOCX')
        assert.equal(again.state, 'READY')
        if (again.state === 'READY') assert.deepEqual(again.document, word)
        for (const table of ['submission_documents', 'submission_document_sets']) {
          await assert.rejects(
            client.unsafe('UPDATE ' + table + ' SET created_at=now()'),
            pgCode('23514'),
          )
          await assert.rejects(client.unsafe('DELETE FROM ' + table), pgCode('23514'))
        }
        const [job] = await client`SELECT * FROM submission_document_jobs WHERE id=${l.jobId}`
        assert.equal(job!.state, 'COMPLETE')
        assert.equal(job!.published_document_id, word.id)
        await assert.rejects(
          client`UPDATE submission_document_jobs SET state='PENDING' WHERE id=${l.jobId}`,
          pgCode('23514'),
        )
        assert.equal(await registry.fail(l, 'STORAGE_FAILED'), false)
      },
    )
    await run(
      'PDF requires committed Word and the same template, renderer and source hash',
      async () => {
        const s = await set()
        assert.equal((await registry.claim(s.id, 'PDF')).state, 'WORD_REQUIRED')
        await registry.publish(lease(await registry.claim(s.id, 'DOCX')), metadata())
        const l = lease(await registry.claim(s.id, 'PDF'))
        await assert.rejects(
          registry.publish(l, { ...metadata('PDF'), sourceDocxSha256: 'e'.repeat(64) }),
          pgCode('23514'),
        )
        await assert.rejects(
          registry.publish(l, {
            ...metadata('PDF'),
            renderer: { ...metadata().renderer, version: 'other' },
          }),
          pgCode('23514'),
        )
        await assert.rejects(
          registry.publish(l, {
            ...metadata('PDF'),
            template: { ...newDeclarationTemplateBinding(), bindingSource: 'LEGACY_V1' },
          }),
          pgCode('23514'),
        )
        const pdf = await registry.publish(l, metadata('PDF'))
        assert.equal(pdf.sourceDocxSha256, 'a'.repeat(64))
        assert.equal((await registry.claim(s.id, 'DOCX')).state, 'READY')
      },
    )
    await run(
      'expired lease alone cannot publish; job identity and lease extension are checked',
      async () => {
        const short = new DrizzleSubmissionDocumentRegistry(drizzle(ormClient), 1, 0),
          s = await set()
        const l = lease(await short.claim(s.id, 'DOCX'))
        await assert.rejects(
          registry.publish({ ...l, jobId: randomUUID() }, metadata()),
          pgCode('DOCUMENT_LEASE_LOST'),
        )
        await assert.rejects(
          client`UPDATE submission_document_jobs SET lease_until=clock_timestamp()+interval '100 seconds' WHERE id=${l.jobId}`,
          pgCode('23514'),
        )
        await client`SELECT pg_sleep(1.1)`
        await assert.rejects(registry.publish(l, metadata()), pgCode('P0001'))
        assert.equal(await registry.get(s.id, 'DOCX'), undefined)
        const [job] = await client`SELECT state FROM submission_document_jobs WHERE id=${l.jobId}`
        assert.equal(job!.state, 'RUNNING')
      },
    )
    await run('job cannot start RUNNING or publish without a live lease', async () => {
      const s = await set(),
        token = randomUUID()
      await assert.rejects(
        client`INSERT INTO submission_document_jobs(set_id,format,state,attempts,attempt_id,lease_until) VALUES(${s.id},'DOCX','RUNNING',1,${token},clock_timestamp()+interval '100 seconds')`,
        pgCode('23514'),
      )
      await assert.rejects(
        client`INSERT INTO submission_documents(set_id,format,storage_key,attempt_id,size,sha256,template,renderer,status) VALUES(${s.id},'DOCX',${token},${token},100,${'a'.repeat(64)},${client.json({ ...newDeclarationTemplateBinding() })},${client.json({ ...metadata().renderer })},'UNSIGNED_DECLARATION')`,
        pgCode('P0001'),
      )
      assert.equal(await registry.get(s.id, 'DOCX'), undefined)
    })
    await run('PDF SQL nulls cannot bypass source and provenance checks', async () => {
      const s = await set()
      await registry.publish(lease(await registry.claim(s.id, 'DOCX')), metadata())
      const l = lease(await registry.claim(s.id, 'PDF'))
      await assert.rejects(
        registry.publish(l, { ...metadata('PDF'), sourceDocxSha256: null }),
        pgCode('23514'),
      )
      await assert.rejects(
        registry.publish(l, { ...metadata('PDF'), converter: null }),
        pgCode('23514'),
      )
      await assert.rejects(
        client`INSERT INTO submission_documents(set_id,format,storage_key,attempt_id,size,sha256,template,renderer,converter,source_docx_sha256,status) VALUES(${s.id},'PDF',${l.attemptId},${l.attemptId},100,${'b'.repeat(64)},${client.json({ ...newDeclarationTemplateBinding() })},${client.json({ ...metadata().renderer })},${client.json({ version: null, binarySha256: 'd'.repeat(64) })},${'a'.repeat(64)},'UNSIGNED_DECLARATION')`,
        pgCode('23514'),
      )
      await registry.publish(l, metadata('PDF'))
    })
    await run('expired worker cannot publish or fail the replacement lease', async () => {
      const short = new DrizzleSubmissionDocumentRegistry(drizzle(ormClient), 1, 0),
        s = await set()
      const stale = lease(await short.claim(s.id, 'DOCX'))
      await client`SELECT pg_sleep(1.1)`
      const fresh = lease(await registry.claim(s.id, 'DOCX'))
      assert.notEqual(stale.attemptId, fresh.attemptId)
      await assert.rejects(registry.publish(stale, metadata()), pgCode('DOCUMENT_LEASE_LOST'))
      assert.equal(await registry.fail(stale, 'RENDER_FAILED'), false)
      await registry.publish(fresh, metadata())
    })
    await run(
      'at most two live jobs across repository instances; failure releases capacity',
      async () => {
        const sets = await Promise.all([set(), set(), set()])
        const first = lease(await registry.claim(sets[0].id, 'DOCX'))
        lease(await second.claim(sets[1].id, 'DOCX'))
        assert.equal((await registry.claim(sets[2].id, 'DOCX')).state, 'BUSY')
        assert.equal(await registry.fail(first, 'RENDER_FAILED'), true)
        lease(await second.claim(sets[2].id, 'DOCX'))
      },
    )
    await run('retry is delayed and attempts are finite', async () => {
      const delayed = new DrizzleSubmissionDocumentRegistry(drizzle(ormClient), 10, 10),
        s = await set()
      const l = lease(await delayed.claim(s.id, 'DOCX'))
      await delayed.fail(l, 'RENDER_FAILED')
      assert.equal((await delayed.claim(s.id, 'DOCX')).state, 'RETRY_LATER')
      const other = await set()
      for (let i = 0; i < 3; i++)
        await registry.fail(lease(await registry.claim(other.id, 'DOCX')), 'RENDER_FAILED')
      assert.equal((await registry.claim(other.id, 'DOCX')).state, 'EXHAUSTED')
    })
    await run(
      'SQL nulls, fake signature status and malformed provenance cannot bypass checks',
      async () => {
        const s = await set(),
          l = lease(await registry.claim(s.id, 'DOCX'))
        for (const renderer of [
          { ...metadata().renderer, buildSha256: null },
          { ...metadata().renderer, version: null },
          { ...metadata().renderer, unexpected: true },
        ]) {
          await assert.rejects(
            client`INSERT INTO submission_documents(set_id,format,storage_key,attempt_id,size,sha256,template,renderer,status) VALUES(${s.id},'DOCX',${l.attemptId},${l.attemptId},100,${'a'.repeat(64)},${client.json({ ...newDeclarationTemplateBinding() })},${client.json(renderer)},'UNSIGNED_DECLARATION')`,
            pgCode('23514'),
          )
        }
        await assert.rejects(
          client`INSERT INTO submission_documents(set_id,format,storage_key,attempt_id,size,sha256,template,renderer,status) VALUES(${s.id},'DOCX',${l.attemptId},${l.attemptId},100,${'a'.repeat(64)},${client.json({ ...newDeclarationTemplateBinding() })},${client.json({ ...metadata().renderer })},'SIGNED')`,
          pgCode('23514'),
        )
        await registry.publish(l, metadata())
      },
    )
    await run(
      'failure writing publication audit rolls back both document and COMPLETE job',
      async () => {
        const s = await set(),
          l = lease(await registry.claim(s.id, 'DOCX'))
        await client.unsafe(
          "CREATE FUNCTION registry_test_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='document.published' THEN RAISE EXCEPTION 'SIMULATED_AUDIT_FAILURE'; END IF; RETURN NEW; END $$",
        )
        await client.unsafe(
          'CREATE TRIGGER registry_test_fail_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION registry_test_fail_audit()',
        )
        try {
          await assert.rejects(registry.publish(l, metadata()), pgCode('P0001'))
          assert.equal(await registry.get(s.id, 'DOCX'), undefined)
          const [job] = await client`SELECT state FROM submission_document_jobs WHERE id=${l.jobId}`
          assert.equal(job!.state, 'RUNNING')
        } finally {
          await client.unsafe('DROP TRIGGER registry_test_fail_audit ON audit_logs')
          await client.unsafe('DROP FUNCTION registry_test_fail_audit()')
        }
        await registry.publish(l, metadata())
        const [audit] = await client<
          { actor_type: string; metadata: { status: string } }[]
        >`SELECT actor_type,metadata FROM audit_logs WHERE action='document.published'`
        assert.equal(audit!.actor_type, 'SYSTEM')
        assert.equal(audit!.metadata.status, 'UNSIGNED_DECLARATION')
        assert.ok(!JSON.stringify(audit).includes('Synthetic student'))
      },
    )
    await run('set cannot invent template binding or rebind another round', async () => {
      const f = await fixture()
      await assert.rejects(
        client`INSERT INTO submission_document_sets(submission_id,round_id,kind,template) VALUES(${f.id},${f.round},'DECLARATION',${client.json({ ...newDeclarationTemplateBinding(), sha256: 'e'.repeat(64) })})`,
        pgCode('23514'),
      )
      await registry.ensureSet(f.id, 1)
    })
  } finally {
    await orm?.end({ timeout: 5 })
    await q?.end({ timeout: 5 })
    if (url.pathname === '/' + name)
      await admin.unsafe('DROP DATABASE IF EXISTS "' + name + '" WITH (FORCE)')
    await admin.end({ timeout: 5 })
  }
})
