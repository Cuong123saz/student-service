import { DrizzleSubmissionDocumentOperations } from './submission-document-operations.js'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile, mkdtemp, rm, readdir, writeFile, unlink, lstat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fork } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import {
  StoredSubmissionDocumentRenderer,
  type DocumentRegistry,
  type DocumentProvenance,
} from './submission-document-coordinator.js'
import {
  LocalDocumentVault,
  documentDigest,
  type DocumentVaultOptions,
} from './submission-document-vault.js'
import { LocalSubmissionDocumentRenderer, type DocumentSnapshot } from './submission-document.js'
import { SubmissionService, type SubmissionRepository } from './submission.service.js'
import type { EvidenceStorage } from './submission.storage.js'
import { SubmissionError } from './submission.types.js'
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
      return { id, round, unit, student }
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
    const preservedSet = await registry.ensureSet(existing.id, 1)
    for (const format of ['DOCX', 'PDF'] as const) {
      const jobId = randomUUID(),
        attemptId = randomUUID()
      await client`INSERT INTO submission_document_jobs(id,set_id,format) VALUES(${jobId},${preservedSet.id},${format})`
      await client`UPDATE submission_document_jobs SET state='RUNNING',attempts=1,attempt_id=${attemptId},lease_until=clock_timestamp()+interval '30 seconds' WHERE id=${jobId}`
      await registry.publish({ jobId, setId: preservedSet.id, format, attemptId }, metadata(format))
    }
    const preserved = new Map<string, unknown>()
    for (const table of [
      'submission_document_sets',
      'submission_documents',
      'submission_document_jobs',
      'audit_logs',
    ])
      preserved.set(
        table,
        await client.unsafe('SELECT row_to_json(t) AS value FROM ' + table + ' t ORDER BY id'),
      )
    await client`INSERT INTO roles(code,name) VALUES('SYSTEM_ADMIN','Synthetic system admin'),('ADMIN','Synthetic admin') ON CONFLICT(code) DO NOTHING`
    await migrate('0024_document_retry')
    await t.test(
      '0024 preserves completed documents, leases and audits; new permission defaults only to SYSTEM_ADMIN',
      async () => {
        for (const [table, before] of preserved) {
          const query =
            table === 'submission_document_jobs'
              ? "SELECT to_jsonb(t)-'retry_allowance' AS value FROM submission_document_jobs t ORDER BY id"
              : 'SELECT row_to_json(t) AS value FROM ' + table + ' t ORDER BY id'
          assert.deepEqual(await client.unsafe(query), before, table)
        }
        const holders = await client<
          { code: string }[]
        >`SELECT r.code FROM roles r JOIN role_permissions rp ON rp.role_id=r.id JOIN permissions p ON p.id=rp.permission_id WHERE p.code='document.retry' ORDER BY r.code`
        assert.deepEqual(
          holders.map((row) => row.code),
          ['SYSTEM_ADMIN'],
        )
      },
    )
    const operations = new DrizzleSubmissionDocumentOperations(drizzle(ormClient))
    async function reset() {
      const [current] = await client`SELECT current_database() AS name`
      assert.equal(current!.name, name)
      await client.unsafe(
        'TRUNCATE submission_document_retries, submission_document_jobs, submission_documents, submission_document_sets, audit_logs',
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
    async function operator(
      unitId: string,
      codes = ['submission.review', 'document.retry'],
      userId = randomUUID(),
    ) {
      await client`INSERT INTO users(id,username,full_name,must_change_password) VALUES(${userId},${'operator-' + userId},'Synthetic operator',false) ON CONFLICT(id) DO NOTHING`
      const [role] = await client<
        { id: number }[]
      >`INSERT INTO roles(code,name) VALUES(${'TEST-' + randomUUID()},'Synthetic role') RETURNING id`
      await client`INSERT INTO user_roles(user_id,role_id) VALUES(${userId},${role!.id})`
      for (const code of codes) {
        await client`INSERT INTO permissions(code,name,description) VALUES(${code},${code},'Synthetic permission') ON CONFLICT(code) DO NOTHING`
        await client`INSERT INTO role_permissions(role_id,permission_id) SELECT ${role!.id},id FROM permissions WHERE code=${code}`
      }
      await client`INSERT INTO authorization_scopes(scope_type,organizational_unit_id) VALUES('ORGANIZATION',${unitId}) ON CONFLICT DO NOTHING`
      const [scope] = await client<
        { id: string }[]
      >`SELECT id FROM authorization_scopes WHERE scope_type='ORGANIZATION' AND organizational_unit_id=${unitId}`
      await client`INSERT INTO user_role_scopes(user_id,role_id,scope_id) VALUES(${userId},${role!.id},${scope!.id})`
      return userId
    }
    async function exhausted(
      f: Awaited<ReturnType<typeof fixture>>,
      format: 'DOCX' | 'PDF' = 'DOCX',
    ) {
      const docset = await registry.ensureSet(f.id, 1)
      if (format === 'PDF')
        await registry.publish(lease(await registry.claim(docset.id, 'DOCX')), metadata())
      let last: DocumentLease | undefined
      for (let i = 0; i < 3; i++) {
        last = lease(await registry.claim(docset.id, format))
        await registry.fail(last, format === 'PDF' ? 'CONVERT_FAILED' : 'RENDER_FAILED')
      }
      assert.equal((await registry.claim(docset.id, format)).state, 'EXHAUSTED')
      return { docset, last: last! }
    }
    const conflictRetry = (e: unknown) =>
      e instanceof SubmissionError && e.code === 'DOCUMENT_RETRY_CONFLICT'
    const forbiddenRetry = (e: unknown) =>
      e instanceof SubmissionError && e.code === 'DOCUMENT_RETRY_FORBIDDEN'
    await run('status reads create no set or job and owner cannot open a retry', async () => {
      const f = await fixture(),
        status = await operations.status(f.student, f.id, 1, false)
      assert.equal(status.enabled, true)
      assert.deepEqual(
        status.documents.map((d) => [d.state, d.retryAllowed]),
        [
          ['NOT_STARTED', false],
          ['NOT_STARTED', false],
        ],
      )
      assert.equal((await client`SELECT count(*)::int AS n FROM submission_document_sets`)[0]!.n, 0)
      assert.equal((await client`SELECT count(*)::int AS n FROM submission_document_jobs`)[0]!.n, 0)
    })
    await run('retry requires active same-role permission and current scope', async () => {
      const f = await fixture(),
        { last } = await exhausted(f)
      const allowed = await operator(f.unit),
        reviewOnly = await operator(f.unit, ['submission.review']),
        retryOnly = await operator(f.unit, ['document.retry']),
        own = await operator(f.unit, undefined, f.student),
        foreign = await operator((await fixture()).unit)
      await operator(f.unit, ['submission.review'], retryOnly)
      const input = {
        requestId: randomUUID(),
        expectedAttemptId: last.attemptId,
        reasonCode: 'RENDERER_FIXED' as const,
      }
      for (const userId of [reviewOnly, retryOnly, own, foreign])
        await assert.rejects(operations.retry(userId, f.id, 1, 'DOCX', input), forbiddenRetry)
      await client`UPDATE users SET must_change_password=true WHERE id=${allowed}`
      await assert.rejects(operations.retry(allowed, f.id, 1, 'DOCX', input), forbiddenRetry)
      await client`UPDATE users SET must_change_password=false,status='DISABLED' WHERE id=${allowed}`
      await assert.rejects(operations.retry(allowed, f.id, 1, 'DOCX', input), forbiddenRetry)
      assert.equal(
        (await client`SELECT count(*)::int AS n FROM submission_document_retries`)[0]!.n,
        0,
      )
      await assert.rejects(
        client`INSERT INTO submission_document_retries(id,job_id,attempt_id,attempts,allowance,actor_user_id,reason_code) VALUES(${randomUUID()},${last.jobId},${last.attemptId},3,1,${foreign},'RENDERER_FIXED')`,
        pgCode('42501'),
      )
    })
    await run(
      'retry is audited, idempotent and delayed; stale worker and completed document stay fenced',
      async () => {
        const f = await fixture(),
          { docset, last } = await exhausted(f),
          actor = await operator(f.unit)
        const input = {
          requestId: randomUUID(),
          expectedAttemptId: last.attemptId,
          reasonCode: 'RENDERER_FIXED' as const,
        }
        assert.equal(
          (await operations.status(actor, f.id, 1, true)).documents[0]!.retryAllowed,
          true,
        )
        assert.deepEqual(await operations.retry(actor, f.id, 1, 'DOCX', input), {
          requestId: input.requestId,
          attemptLimit: 4,
          alreadyApplied: false,
        })
        assert.equal((await operations.retry(actor, f.id, 1, 'DOCX', input)).alreadyApplied, true)
        assert.equal(
          (
            await client`SELECT count(*)::int AS n FROM audit_logs WHERE action='document.retry.authorized'`
          )[0]!.n,
          1,
        )
        const [before] = await client`SELECT * FROM submission_document_jobs WHERE id=${last.jobId}`
        assert.equal(before!.attempts, 3)
        assert.equal(before!.retry_allowance, 1)
        assert.equal(before!.attempt_id, last.attemptId)
        assert.equal((await registry.claim(docset.id, 'DOCX')).state, 'RETRY_LATER')
        await delay(3100)
        const current = lease(await registry.claim(docset.id, 'DOCX'))
        assert.notEqual(current.attemptId, last.attemptId)
        assert.equal(await registry.fail(last, 'RENDER_FAILED'), false)
        await assert.rejects(
          registry.publish(last, metadata()),
          (e) => e instanceof SubmissionError && e.code === 'DOCUMENT_LEASE_LOST',
        )
        const ready = await registry.publish(current, metadata())
        await assert.rejects(
          operations.retry(actor, f.id, 1, 'DOCX', {
            ...input,
            requestId: randomUUID(),
            expectedAttemptId: current.attemptId,
          }),
          conflictRetry,
        )
        assert.deepEqual(await registry.get(docset.id, 'DOCX'), ready)
        await client`DELETE FROM user_role_scopes WHERE user_id=${actor}`
        await assert.rejects(operations.retry(actor, f.id, 1, 'DOCX', input), forbiddenRetry)
      },
    )
    await run(
      'concurrent operators grant once; changed request, wrong reason/token and retry-history mutations fail',
      async () => {
        const f = await fixture(),
          { last } = await exhausted(f),
          actor = await operator(f.unit),
          other = await operator(f.unit)
        const input = {
          requestId: randomUUID(),
          expectedAttemptId: last.attemptId,
          reasonCode: 'RENDERER_FIXED' as const,
        }
        await assert.rejects(
          operations.retry(actor, f.id, 1, 'DOCX', { ...input, expectedAttemptId: randomUUID() }),
          conflictRetry,
        )
        await assert.rejects(
          operations.retry(actor, f.id, 1, 'DOCX', { ...input, reasonCode: 'STORAGE_FIXED' }),
          conflictRetry,
        )
        const results = await Promise.allSettled([
          operations.retry(actor, f.id, 1, 'DOCX', input),
          operations.retry(other, f.id, 1, 'DOCX', { ...input, requestId: randomUUID() }),
        ])
        assert.equal(results.filter((v) => v.status === 'fulfilled').length, 1)
        assert.equal(
          results.filter((v) => v.status === 'rejected' && conflictRetry(v.reason)).length,
          1,
        )
        assert.equal(
          (await client`SELECT count(*)::int AS n FROM submission_document_retries`)[0]!.n,
          1,
        )
        const [grant] = await client<
          { id: string; actor_user_id: string }[]
        >`SELECT id,actor_user_id FROM submission_document_retries`
        await assert.rejects(
          operations.retry(grant!.actor_user_id, f.id, 1, 'DOCX', {
            ...input,
            requestId: grant!.id,
            reasonCode: 'STORAGE_FIXED',
          }),
          conflictRetry,
        )
        await assert.rejects(
          client`UPDATE submission_document_retries SET reason_code='STORAGE_FIXED'`,
          pgCode('23514'),
        )
        await assert.rejects(client`DELETE FROM submission_document_retries`, pgCode('23514'))
      },
    )
    await run(
      'audit failure rolls back authorization and allowance; direct allowance update fails',
      async () => {
        const f = await fixture(),
          { last } = await exhausted(f),
          actor = await operator(f.unit)
        const before =
          await client`SELECT row_to_json(j) AS value FROM submission_document_jobs j WHERE id=${last.jobId}`
        await client.unsafe(
          `CREATE FUNCTION reject_document_retry_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='document.retry.authorized' THEN RAISE EXCEPTION 'TEST_AUDIT_FAILURE'; END IF; RETURN NEW; END $$`,
        )
        await client.unsafe(
          'CREATE TRIGGER reject_document_retry_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_document_retry_audit()',
        )
        try {
          await assert.rejects(
            operations.retry(actor, f.id, 1, 'DOCX', {
              requestId: randomUUID(),
              expectedAttemptId: last.attemptId,
              reasonCode: 'RENDERER_FIXED',
            }),
            pgCode('P0001'),
          )
        } finally {
          await client.unsafe('DROP TRIGGER reject_document_retry_audit ON audit_logs')
          await client.unsafe('DROP FUNCTION reject_document_retry_audit()')
        }
        assert.deepEqual(
          await client`SELECT row_to_json(j) AS value FROM submission_document_jobs j WHERE id=${last.jobId}`,
          before,
        )
        assert.equal(
          (await client`SELECT count(*)::int AS n FROM submission_document_retries`)[0]!.n,
          0,
        )
        await assert.rejects(
          client`UPDATE submission_document_jobs SET retry_allowance=1 WHERE id=${last.jobId}`,
          pgCode('23514'),
        )
      },
    )
    await run('PDF reaches at most six attempts and retains original Word', async () => {
      const f = await fixture(),
        { docset, last } = await exhausted(f, 'PDF'),
        actor = await operator(f.unit)
      const original = await registry.get(docset.id, 'DOCX')
      let current = last
      for (let extra = 0; extra < 3; extra++) {
        await operations.retry(actor, f.id, 1, 'PDF', {
          requestId: randomUUID(),
          expectedAttemptId: current.attemptId,
          reasonCode: 'CONVERTER_FIXED',
        })
        await delay(3100)
        current = lease(await registry.claim(docset.id, 'PDF'))
        await registry.fail(current, 'CONVERT_FAILED')
      }
      assert.equal((await registry.claim(docset.id, 'PDF')).state, 'EXHAUSTED')
      await assert.rejects(
        operations.retry(actor, f.id, 1, 'PDF', {
          requestId: randomUUID(),
          expectedAttemptId: current.attemptId,
          reasonCode: 'CONVERTER_FIXED',
        }),
        conflictRetry,
      )
      const status = await operations.status(actor, f.id, 1, true)
      assert.equal(status.documents[1]!.attempts, 6)
      assert.equal(status.documents[1]!.retryAllowed, false)
      assert.equal(status.documents[1]!.remainingAuthorizations, 0)
      assert.deepEqual(await registry.get(docset.id, 'DOCX'), original)
    })
    await run('permission revoked during a lock wait also rejects retry and replay', async () => {
      const f = await fixture(),
        { docset, last } = await exhausted(f),
        actor = await operator(f.unit)
      const locked = Promise.withResolvers<void>(),
        release = Promise.withResolvers<void>()
      const holder = client.begin(async (tx) => {
        await tx`SELECT id FROM submission_document_sets WHERE id=${docset.id} FOR UPDATE`
        locked.resolve()
        await release.promise
      })
      await locked.promise
      const retry = operations.retry(actor, f.id, 1, 'DOCX', {
        requestId: randomUUID(),
        expectedAttemptId: last.attemptId,
        reasonCode: 'RENDERER_FIXED',
      })
      try {
        let waiting = false
        for (let i = 0; i < 100; i++) {
          const [row] = await client<
            { n: number }[]
          >`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%submission_document_sets%'`
          if (row!.n > 0) {
            waiting = true
            break
          }
          await delay(20)
        }
        assert.equal(waiting, true)
        await client`DELETE FROM role_permissions WHERE role_id IN (SELECT role_id FROM user_roles WHERE user_id=${actor}) AND permission_id IN (SELECT id FROM permissions WHERE code='document.retry')`
      } finally {
        release.resolve()
        await holder
      }
      await assert.rejects(retry, forbiddenRetry)
      assert.equal(
        (await client`SELECT count(*)::int AS n FROM submission_document_retries`)[0]!.n,
        0,
      )
    })
    await run(
      'expired final lease invalidation and retry audit commit or roll back together',
      async () => {
        const f = await fixture(),
          actor = await operator(f.unit),
          docset = await registry.ensureSet(f.id, 1)
        const short = new DrizzleSubmissionDocumentRegistry(drizzle(ormClient), 1, 0)
        for (let i = 0; i < 2; i++)
          await short.fail(lease(await short.claim(docset.id, 'DOCX')), 'RENDER_FAILED')
        const last = lease(await short.claim(docset.id, 'DOCX'))
        await delay(1100)
        assert.equal(
          (await operations.status(actor, f.id, 1, true)).documents[0]!.errorCode,
          'LEASE_EXPIRED',
        )
        const before =
          await client`SELECT row_to_json(j) AS value FROM submission_document_jobs j WHERE id=${last.jobId}`
        const audit = await client`SELECT * FROM audit_logs ORDER BY id`
        await client.unsafe(
          `CREATE FUNCTION reject_document_retry_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='document.retry.authorized' THEN RAISE EXCEPTION 'TEST_AUDIT_FAILURE'; END IF; RETURN NEW; END $$`,
        )
        await client.unsafe(
          'CREATE TRIGGER reject_document_retry_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_document_retry_audit()',
        )
        const input = {
          requestId: randomUUID(),
          expectedAttemptId: last.attemptId,
          reasonCode: 'WORKER_RESTARTED' as const,
        }
        try {
          await assert.rejects(operations.retry(actor, f.id, 1, 'DOCX', input), pgCode('P0001'))
        } finally {
          await client.unsafe('DROP TRIGGER reject_document_retry_audit ON audit_logs')
          await client.unsafe('DROP FUNCTION reject_document_retry_audit()')
        }
        assert.deepEqual(
          await client`SELECT row_to_json(j) AS value FROM submission_document_jobs j WHERE id=${last.jobId}`,
          before,
        )
        assert.deepEqual(await client`SELECT * FROM audit_logs ORDER BY id`, audit)
        await operations.retry(actor, f.id, 1, 'DOCX', input)
        const [after] = await client`SELECT * FROM submission_document_jobs WHERE id=${last.jobId}`
        assert.equal(after!.state, 'RETRYABLE')
        assert.equal(after!.retry_allowance, 1)
        assert.equal(after!.attempts, 3)
        assert.equal(after!.error_code, 'LEASE_EXPIRED')
        assert.equal(after!.attempt_id, last.attemptId)
        assert.equal(await registry.fail(last, 'RENDER_FAILED'), false)
      },
    )
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

    async function vaultFixture() {
      const parent = resolve(tmpdir()),
        root = await mkdtemp(join(parent, 'student-registry-vault-'))
      t.after(async () => {
        assert.equal(dirname(root), parent)
        assert.ok(root.startsWith(join(parent, 'student-registry-vault-')))
        await rm(root, { recursive: true, force: true })
      })
      const options: DocumentVaultOptions = {
        outputRoot: join(root, 'output'),
        stagingRoot: join(root, 'staging'),
        protectedRoots: [fileURLToPath(new URL('../../../../../', import.meta.url))],
      }
      return { root, options, vault: await LocalDocumentVault.create(options) }
    }
    function snapshot(id: string): DocumentSnapshot {
      return {
        id,
        serviceName: 'Synthetic document service',
        procedure: {
          versionId: randomUUID(),
          versionNumber: 1,
          processingMode: 'ONLINE',
          processingUnitName: 'Synthetic office',
          contactInstructions: '',
          fields: [],
          attachments: [],
          maxTotalAttachmentBytes: 0,
        },
        round: {
          declarationTemplate: newDeclarationTemplateBinding(),
          roundNumber: 1,
          submittedAt: '2026-10-11T00:00:00Z',
          studentSnapshot: {
            fullName: 'Sinh viên giả định',
            studentCode: 'FAKE',
            classCode: 'FAKE',
            facultyCode: 'FAKE',
          },
          values: {},
          files: [],
          source: 'LIVE',
        },
      }
    }
    const provenance: DocumentProvenance = {
      renderer: async () => metadata().renderer,
      converter: async () => ({ version: 'SYNTHETIC-CONVERTER', binarySha256: 'd'.repeat(64) }),
    }
    const fakePdf = Buffer.from('%PDF-1.7\n%SYNTHETIC-ONLY\n' + 'x'.repeat(100) + '\n%%EOF')
    await run(
      'coordinator persists real Word, derives PDF from those exact bytes and reuses both across instances',
      async () => {
        const f = await fixture(),
          v = await vaultFixture(),
          input = snapshot(f.id)
        let words = 0,
          conversions = 0,
          converted: Buffer | undefined
        const wordRenderer = new LocalSubmissionDocumentRenderer()
        const coordinator = new StoredSubmissionDocumentRenderer(
          registry,
          v.vault,
          {
            render: async (s) => {
              words++
              return wordRenderer.render(s, 'docx')
            },
          },
          {
            convert: async (word) => {
              conversions++
              converted = Buffer.from(word)
              return fakePdf
            },
          },
          provenance,
        )
        const pair = await coordinator.renderPair(input)
        assert.deepEqual(converted, pair.docx)
        assert.deepEqual(pair.pdf, fakePdf)
        const s = await registry.ensureSet(f.id, 1),
          word = await registry.get(s.id, 'DOCX'),
          pdf = await registry.get(s.id, 'PDF')
        assert.ok(word && pdf)
        assert.deepEqual(documentDigest(pair.docx), { size: word.size, sha256: word.sha256 })
        assert.equal(pdf.sourceDocxSha256, word.sha256)
        assert.deepEqual(pdf.renderer, word.renderer)
        const reused = new StoredSubmissionDocumentRenderer(
          second,
          await LocalDocumentVault.create(v.options),
          {
            render: async () => {
              throw new Error('must not render stored Word')
            },
          },
          {
            convert: async () => {
              throw new Error('must not convert stored PDF')
            },
          },
          {
            renderer: async () => {
              throw new Error('must not need current renderer')
            },
            converter: async () => {
              throw new Error('must not need current converter')
            },
          },
        )
        assert.deepEqual(await reused.renderPair(input), pair)
        assert.equal(words, 1)
        assert.equal(conversions, 1)
        assert.equal((await readdir(v.options.outputRoot)).length, 2)
        assert.equal((await readdir(v.options.stagingRoot)).length, 2)
      },
    )
    await run(
      'PDF failure leaves committed Word available and a later bounded attempt converts the same Word',
      async () => {
        const f = await fixture(),
          v = await vaultFixture(),
          input = snapshot(f.id)
        let fail = true,
          words = 0
        const renderer = new LocalSubmissionDocumentRenderer()
        const coordinator = new StoredSubmissionDocumentRenderer(
          registry,
          v.vault,
          {
            render: async (s) => {
              words++
              return renderer.render(s, 'docx')
            },
          },
          {
            convert: async () => {
              if (fail) throw new Error('synthetic converter failure')
              return fakePdf
            },
          },
          provenance,
        )
        await assert.rejects(
          coordinator.render(input, 'pdf'),
          (e: unknown) =>
            e instanceof Error && 'code' in e && e.code === 'DOCUMENT_PDF_UNAVAILABLE',
        )
        const word = await coordinator.render(input, 'docx'),
          s = await registry.ensureSet(f.id, 1)
        assert.ok(await registry.get(s.id, 'DOCX'))
        assert.equal(await registry.get(s.id, 'PDF'), undefined)
        const [job] =
          await client`SELECT state,attempts,error_code FROM submission_document_jobs WHERE set_id=${s.id} AND format='PDF'`
        assert.equal(job!.state, 'RETRYABLE')
        assert.equal(job!.attempts, 1)
        assert.equal(job!.error_code, 'CONVERT_FAILED')
        fail = false
        assert.deepEqual((await coordinator.renderPair(input)).docx, word)
        assert.equal(words, 1)
      },
    )
    await run(
      'missing or corrupt committed source fails closed for PDF as well as Word without regeneration',
      async () => {
        const f = await fixture(),
          v = await vaultFixture(),
          input = snapshot(f.id),
          renderer = new LocalSubmissionDocumentRenderer()
        let words = 0,
          conversions = 0
        const coordinator = new StoredSubmissionDocumentRenderer(
          registry,
          v.vault,
          {
            render: async (s) => {
              words++
              return renderer.render(s, 'docx')
            },
          },
          {
            convert: async () => {
              conversions++
              return fakePdf
            },
          },
          provenance,
        )
        await coordinator.renderPair(input)
        const s = await registry.ensureSet(f.id, 1),
          word = await registry.get(s.id, 'DOCX')
        assert.ok(word)
        await writeFile(join(v.options.outputRoot, word.storageKey), Buffer.alloc(word.size))
        for (const format of ['docx', 'pdf'] as const)
          await assert.rejects(
            coordinator.render(input, format),
            (e: unknown) => e instanceof Error && 'code' in e && e.code === 'DOCUMENT_INTEGRITY',
          )
        await unlink(join(v.options.outputRoot, word.storageKey))
        await assert.rejects(coordinator.render(input, 'docx'))
        assert.equal(words, 1)
        assert.equal(conversions, 1)
        assert.equal((await client`SELECT count(*)::int AS n FROM submission_documents`)[0]!.n, 2)
      },
    )

    await run(
      'source corruption during slow conversion prevents PDF publication and retains diagnostic artifacts',
      async () => {
        const f = await fixture(),
          v = await vaultFixture(),
          input = snapshot(f.id)
        const coordinator = new StoredSubmissionDocumentRenderer(
          registry,
          v.vault,
          new LocalSubmissionDocumentRenderer(),
          {
            convert: async () => {
              const s = await registry.ensureSet(f.id, 1),
                source = await registry.get(s.id, 'DOCX')
              assert.ok(source)
              await writeFile(
                join(v.options.outputRoot, source.storageKey),
                Buffer.alloc(source.size),
              )
              return fakePdf
            },
          },
          provenance,
        )
        await assert.rejects(
          coordinator.render(input, 'pdf'),
          (e: unknown) => e instanceof SubmissionError && e.code === 'DOCUMENT_INTEGRITY',
        )
        const s = await registry.ensureSet(f.id, 1)
        assert.ok(await registry.get(s.id, 'DOCX'))
        assert.equal(await registry.get(s.id, 'PDF'), undefined)
        assert.equal((await readdir(v.options.outputRoot)).length, 1)
      },
    )
    await run(
      'lost publication response is reconciled by token/hash without re-rendering or failing COMPLETE',
      async () => {
        const f = await fixture(),
          v = await vaultFixture(),
          input = snapshot(f.id)
        const facade: DocumentRegistry = {
          ensureSet: registry.ensureSet.bind(registry),
          get: registry.get.bind(registry),
          claim: registry.claim.bind(registry),
          fail: async () => {
            throw new Error('must not mark uncertain publication failed')
          },
          publish: async (l, m) => {
            await registry.publish(l, m)
            throw new Error('response lost after commit')
          },
        }
        const coordinator = new StoredSubmissionDocumentRenderer(
          facade,
          v.vault,
          new LocalSubmissionDocumentRenderer(),
          { convert: async () => fakePdf },
          provenance,
        )
        const pair = await coordinator.renderPair(input)
        assert.ok(pair.docx.length > 100)
        assert.deepEqual(await coordinator.renderPair(input), pair)
        const rows = await client`SELECT state,attempts FROM submission_document_jobs`
        assert.equal(rows.length, 2)
        assert.ok(rows.every((j) => j.state === 'COMPLETE' && j.attempts === 1))
      },
    )
    await run(
      'unreadable database after uncertain commit preserves bytes and does not mark job failed',
      async () => {
        const f = await fixture(),
          v = await vaultFixture(),
          input = snapshot(f.id)
        let failed = false
        const facade: DocumentRegistry = {
          ensureSet: registry.ensureSet.bind(registry),
          get: async () => {
            throw new Error('synthetic database unavailable')
          },
          claim: registry.claim.bind(registry),
          fail: async () => {
            failed = true
            return true
          },
          publish: async () => {
            throw new Error('synthetic uncertain commit')
          },
        }
        const coordinator = new StoredSubmissionDocumentRenderer(
          facade,
          v.vault,
          new LocalSubmissionDocumentRenderer(),
          { convert: async () => fakePdf },
          provenance,
        )
        await assert.rejects(
          coordinator.render(input, 'docx'),
          (e: unknown) =>
            e instanceof Error && 'code' in e && e.code === 'DOCUMENT_PUBLICATION_UNCERTAIN',
        )
        assert.equal(failed, false)
        const keys = await readdir(v.options.outputRoot)
        assert.equal(keys.length, 1)
        assert.ok((await readFile(join(v.options.outputRoot, keys[0]!))).length > 100)
        assert.equal(
          (await client`SELECT state FROM submission_document_jobs`)[0]!.state,
          'RUNNING',
        )
        assert.equal((await client`SELECT count(*)::int AS n FROM submission_documents`)[0]!.n, 0)
      },
    )
    await run(
      'concurrent coordinators produce one committed Word and return BUSY to the other caller',
      async () => {
        const f = await fixture(),
          v = await vaultFixture(),
          input = snapshot(f.id),
          renderer = new LocalSubmissionDocumentRenderer()
        let release!: () => void, entered!: () => void
        const blocked = new Promise<void>((done) => {
            release = done
          }),
          started = new Promise<void>((done) => {
            entered = done
          })
        const coordinator = new StoredSubmissionDocumentRenderer(
          registry,
          v.vault,
          {
            render: async (s) => {
              entered()
              await blocked
              return renderer.render(s, 'docx')
            },
          },
          { convert: async () => fakePdf },
          provenance,
        )
        const first = coordinator.render(input, 'docx')
        await started
        try {
          await assert.rejects(
            coordinator.render(input, 'docx'),
            (e: unknown) => e instanceof Error && 'code' in e && e.code === 'DOCUMENT_BUSY',
          )
        } finally {
          release()
        }
        const bytes = await first
        assert.deepEqual(await coordinator.render(input, 'docx'), bytes)
        assert.equal((await readdir(v.options.outputRoot)).length, 1)
      },
    )

    await run(
      'worker that resumes after lease takeover retains its orphan but cannot publish or fail the replacement',
      async () => {
        const f = await fixture(),
          v = await vaultFixture(),
          input = snapshot(f.id)
        let release!: () => void, entered!: () => void
        const blocked = new Promise<void>((done) => {
            release = done
          }),
          started = new Promise<void>((done) => {
            entered = done
          })
        const delayedVault = await LocalDocumentVault.create({
          ...v.options,
          onDurableWrite: async (phase) => {
            if (phase === 'FINAL') {
              entered()
              await blocked
            }
          },
        })
        const expiring = new DrizzleSubmissionDocumentRegistry(drizzle(ormClient), 1, 0)
        const old = new StoredSubmissionDocumentRenderer(
          expiring,
          delayedVault,
          new LocalSubmissionDocumentRenderer(),
          { convert: async () => fakePdf },
          provenance,
        )
        const oldResult = old.render(input, 'docx').then(
          () => 'UNEXPECTED_SUCCESS',
          (error: unknown) => error,
        )
        await started
        let newBytes: Buffer
        try {
          await delay(1200)
          const replacement = new StoredSubmissionDocumentRenderer(
            registry,
            v.vault,
            new LocalSubmissionDocumentRenderer(),
            { convert: async () => fakePdf },
            provenance,
          )
          newBytes = await replacement.render(input, 'docx')
        } finally {
          release()
        }
        const outcome = await oldResult
        assert.ok(outcome instanceof SubmissionError)
        assert.equal(outcome.code, 'DOCUMENT_PUBLICATION_UNCERTAIN')
        const s = await registry.ensureSet(f.id, 1),
          committed = await registry.get(s.id, 'DOCX')
        assert.ok(committed)
        assert.deepEqual(await v.vault.read(committed.storageKey, committed), newBytes)
        assert.equal((await readdir(v.options.outputRoot)).length, 2)
        const [job] =
          await client`SELECT attempts,state FROM submission_document_jobs WHERE set_id=${s.id}`
        assert.equal(job!.attempts, 2)
        assert.equal(job!.state, 'COMPLETE')
        assert.equal((await client`SELECT count(*)::int AS n FROM submission_documents`)[0]!.n, 1)
      },
    )
    await run(
      'current authorization denies work before claim and withholds stored bytes when scope is revoked during PDF conversion',
      async () => {
        const f = await fixture(),
          v = await vaultFixture(),
          input = snapshot(f.id),
          forbidden = new SubmissionError(403, 'FORBIDDEN', 'Synthetic scope revoked')
        let scope = true,
          calls = 0
        const coordinator = new StoredSubmissionDocumentRenderer(
          registry,
          v.vault,
          new LocalSubmissionDocumentRenderer(),
          {
            convert: async () => {
              calls++
              scope = false
              return fakePdf
            },
          },
          provenance,
        )
        const view = { ...input, rounds: [input.round] }
        const repository = {
          get: async () => {
            if (!scope) throw forbidden
            return view
          },
          reviewGet: async () => {
            if (!scope) throw forbidden
            return view
          },
        } as unknown as SubmissionRepository
        const service = new SubmissionService(repository, {} as EvidenceStorage, coordinator)
        scope = false
        await assert.rejects(
          service.documentDownload('synthetic outsider', f.id, 1, 'pdf', true),
          forbidden,
        )
        assert.equal(
          (await client`SELECT count(*)::int AS n FROM submission_document_sets`)[0]!.n,
          0,
        )
        scope = true
        await assert.rejects(
          service.documentDownload('synthetic scoped reviewer', f.id, 1, 'pdf', true),
          forbidden,
        )
        assert.equal(calls, 1)
        assert.equal((await client`SELECT count(*)::int AS n FROM submission_documents`)[0]!.n, 2)
        scope = true
        assert.deepEqual(
          (await service.documentDownload('synthetic owner', f.id, 1, 'pdf')).bytes,
          fakePdf,
        )
        assert.equal(calls, 1)
      },
    )
    await run(
      'invalid Word package or converter output is never published as a document',
      async () => {
        for (const format of ['docx', 'pdf'] as const) {
          const f = await fixture(),
            v = await vaultFixture(),
            input = snapshot(f.id)
          const renderer =
            format === 'docx'
              ? { render: async () => Buffer.from('not a Word package') }
              : new LocalSubmissionDocumentRenderer()
          const coordinator = new StoredSubmissionDocumentRenderer(
            registry,
            v.vault,
            renderer,
            { convert: async () => Buffer.from('not a PDF') },
            provenance,
          )
          await assert.rejects(coordinator.render(input, format))
          const s = await registry.ensureSet(f.id, 1)
          assert.equal(await registry.get(s.id, format === 'docx' ? 'DOCX' : 'PDF'), undefined)
          assert.equal((await readdir(v.options.outputRoot)).length, format === 'pdf' ? 1 : 0)
        }
      },
    )
    for (const phase of ['STAGED', 'FINAL', 'COMMITTED'])
      await run(
        'actual process death at ' + phase + ' preserves artifacts and fences recovery',
        async () => {
          const f = await fixture(),
            v = await vaultFixture(),
            input = snapshot(f.id)
          const child = fork(
            fileURLToPath(
              new URL('../../../scripts/document-registry-crash-worker.mjs', import.meta.url),
            ),
            [],
            {
              execArgv: ['--import', 'tsx'],
              stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
              env: { ...process.env, DATABASE_URL: url.toString() },
            },
          )
          // Preload the competitor before the owner claims its five-second lease.
          // Windows/tsx startup is outside the competition being tested.
          const competing =
            phase === 'STAGED'
              ? fork(
                  fileURLToPath(
                    new URL('../../../scripts/document-registry-crash-worker.mjs', import.meta.url),
                  ),
                  [],
                  {
                    execArgv: ['--import', 'tsx'],
                    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
                    env: { ...process.env, DATABASE_URL: url.toString() },
                  },
                )
              : undefined
          let stderr = ''
          child.stderr?.on('data', (data: Buffer) => {
            stderr += data.toString().slice(0, 2000)
          })
          const closed = new Promise<void>((done) => {
            child.once('exit', () => done())
          })
          const competingClosed = competing
            ? new Promise<void>((done) => competing.once('exit', () => done()))
            : Promise.resolve()
          function ready(worker: ReturnType<typeof fork>) {
            return new Promise<void>((done, reject) => {
              const timer = setTimeout(
                () => reject(new Error('Owned fault worker not ready')),
                20000,
              )
              worker.once('message', (message) => {
                clearTimeout(timer)
                if ((message as { phase?: string }).phase === 'READY') done()
                else reject(new Error('Invalid owned fault worker readiness'))
              })
              worker.once('error', (error) => {
                clearTimeout(timer)
                reject(error)
              })
              worker.once('exit', () => {
                clearTimeout(timer)
                reject(new Error('Owned fault worker exited before readiness'))
              })
            })
          }
          try {
            await Promise.all([ready(child), ...(competing ? [ready(competing)] : [])])
            const message = await new Promise<{ phase: string; attemptId: string }>(
              (done, reject) => {
                const timer = setTimeout(
                  () =>
                    reject(
                      new Error(
                        'Owned fault worker did not reach barrier: ' +
                          stderr.replaceAll(url.toString(), '[REDACTED]'),
                      ),
                    ),
                  20000,
                )
                child.once('message', (m) => {
                  clearTimeout(timer)
                  done(m as { phase: string; attemptId: string })
                })
                child.once('error', (error) => {
                  clearTimeout(timer)
                  reject(error)
                })
                child.once('exit', () => {
                  clearTimeout(timer)
                  reject(new Error('Owned fault worker exited before barrier'))
                })
                child.send({
                  phase,
                  vault: v.options,
                  snapshot: input,
                  renderer: metadata().renderer,
                })
              },
            )
            assert.equal(message.phase, phase)

            if (competing) {
              try {
                const competingResult = await new Promise<{ phase: string; code: string }>(
                  (done, reject) => {
                    const timer = setTimeout(
                      () => reject(new Error('Competing owned worker did not answer')),
                      15000,
                    )
                    competing.once('message', (m) => {
                      clearTimeout(timer)
                      done(m as { phase: string; code: string })
                    })
                    competing.once('error', (e) => {
                      clearTimeout(timer)
                      reject(e)
                    })
                    competing.once('exit', () => {
                      clearTimeout(timer)
                      reject(new Error('Competing worker exited before answer'))
                    })
                    competing.send({
                      phase: 'FINAL',
                      vault: v.options,
                      snapshot: input,
                      renderer: metadata().renderer,
                    })
                  },
                )
                assert.equal(competingResult.phase, 'FAILED')
                assert.equal(competingResult.code, 'DOCUMENT_BUSY')
                await competingClosed
              } finally {
                if (competing.exitCode === null && competing.signalCode === null)
                  competing.kill('SIGKILL')
                await competingClosed
              }
            }
            // Terminate only the Node child we just created; no shared process search or tree kill.
            assert.ok(child.kill('SIGKILL'))
            await closed
            const s = await registry.ensureSet(f.id, 1),
              committed = await registry.get(s.id, 'DOCX')
            if (phase === 'STAGED')
              await assert.rejects(lstat(join(v.options.outputRoot, message.attemptId)), {
                code: 'ENOENT',
              })
            else
              assert.ok(
                (await readFile(join(v.options.outputRoot, message.attemptId))).length > 100,
              )
            assert.ok((await readFile(join(v.options.stagingRoot, message.attemptId))).length > 100)
            if (phase === 'COMMITTED') {
              assert.equal(committed?.attemptId, message.attemptId)
              const coordinator = new StoredSubmissionDocumentRenderer(
                registry,
                v.vault,
                {
                  render: async () => {
                    throw new Error('must reuse committed file after process death')
                  },
                },
                { convert: async () => fakePdf },
                provenance,
              )
              assert.deepEqual(
                await coordinator.render(input, 'docx'),
                await readFile(join(v.options.outputRoot, message.attemptId)),
              )
            } else {
              assert.equal(committed, undefined)
              await delay(5200)
              const coordinator = new StoredSubmissionDocumentRenderer(
                registry,
                v.vault,
                new LocalSubmissionDocumentRenderer(),
                { convert: async () => fakePdf },
                provenance,
              )
              const bytes = await coordinator.render(input, 'docx'),
                recovered = await registry.get(s.id, 'DOCX')
              assert.ok(recovered)
              assert.notEqual(recovered.attemptId, message.attemptId)
              assert.deepEqual(await v.vault.read(recovered.storageKey, recovered), bytes)
              const [job] =
                await client`SELECT attempts,state FROM submission_document_jobs WHERE set_id=${s.id}`
              assert.equal(job!.attempts, 2)
              assert.equal(job!.state, 'COMPLETE')
              await assert.rejects(
                registry.publish(
                  {
                    jobId: (
                      await client`SELECT id FROM submission_document_jobs WHERE set_id=${s.id}`
                    )[0]!.id as string,
                    setId: s.id,
                    format: 'DOCX',
                    attemptId: message.attemptId,
                  },
                  { ...metadata(), ...documentDigest(bytes) },
                ),
              )
            }
          } finally {
            if (competing && competing.exitCode === null && competing.signalCode === null)
              competing.kill('SIGKILL')
            if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
            await Promise.all([closed, competingClosed])
          }
        },
      )
    if (process.env.VAULT_REAL_CONVERTER === 'true')
      await run(
        'real compiled runtime provenance and LibreOffice persist a PDF from the committed Word',
        async () => {
          const f = await fixture(),
            v = await vaultFixture(),
            input = snapshot(f.id),
            command = process.env.LIBREOFFICE_PATH
          assert.ok(command)
          const apiRoot = fileURLToPath(new URL('../../../', import.meta.url)),
            repoRoot = fileURLToPath(new URL('../../../../../', import.meta.url))
          const compiledDocuments = (await import(
            new URL('../../../dist/modules/submissions/submission-document.js', import.meta.url)
              .href
          )) as typeof import('./submission-document.js')
          const compiledProvenance = (await import(
            new URL(
              '../../../dist/modules/submissions/submission-document-provenance.js',
              import.meta.url,
            ).href
          )) as typeof import('./submission-document-provenance.js')
          const compiledCoordinator = (await import(
            new URL(
              '../../../dist/modules/submissions/submission-document-coordinator.js',
              import.meta.url,
            ).href
          )) as typeof import('./submission-document-coordinator.js')
          const actual = await compiledProvenance.LocalDocumentProvenance.create({
            codeRoots: [join(apiRoot, 'dist'), join(repoRoot, 'node_modules', 'fflate')],
            metadataFiles: [join(repoRoot, 'package-lock.json'), join(apiRoot, 'package.json')],
            converterCommand: command,
            converterBinary: join(dirname(command), 'soffice.bin'),
          })
          const realRegistry = new DrizzleSubmissionDocumentRegistry(drizzle(ormClient), 180, 0)
          const coordinator = new compiledCoordinator.StoredSubmissionDocumentRenderer(
            realRegistry,
            v.vault,
            new compiledDocuments.LocalSubmissionDocumentRenderer(),
            new compiledDocuments.LibreOfficePdfConverter(command),
            actual,
          )
          const pair = await coordinator.renderPair(input),
            s = await registry.ensureSet(f.id, 1),
            word = await registry.get(s.id, 'DOCX'),
            pdf = await registry.get(s.id, 'PDF')
          assert.ok(word && pdf)
          assert.equal(pdf.sourceDocxSha256, word.sha256)
          assert.equal(word.renderer.nodeVersion, process.versions.node)
          assert.ok(pdf.converter?.version.startsWith('LibreOffice'))
          assert.deepEqual(await coordinator.renderPair(input), pair)
          // Evidence artifacts only: parent directory already owned by this repository's run/ area.
          const artifactRoot = fileURLToPath(new URL('../../../../../run/', import.meta.url))
          await writeFile(join(artifactRoot, 'vault-real-word.docx'), pair.docx)
          await writeFile(join(artifactRoot, 'vault-real-pdf.pdf'), pair.pdf)
          await writeFile(
            join(artifactRoot, 'vault-real-provenance.json'),
            JSON.stringify(
              {
                fakeDataOnly: true,
                word: { ...documentDigest(pair.docx), renderer: word.renderer },
                pdf: {
                  ...documentDigest(pair.pdf),
                  converter: pdf.converter,
                  sourceDocxSha256: pdf.sourceDocxSha256,
                },
              },
              null,
              2,
            ),
          )
        },
      )
  } finally {
    await orm?.end({ timeout: 5 })
    await q?.end({ timeout: 5 })
    if (url.pathname === '/' + name)
      await admin.unsafe('DROP DATABASE IF EXISTS "' + name + '" WITH (FORCE)')
    await admin.end({ timeout: 5 })
  }
})
