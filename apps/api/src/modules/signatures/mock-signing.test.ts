import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import { randomUUID, createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { databaseClient } from '../../db/client.js'
import { env } from '../../config/env.js'
import { buildApp } from '../../app.js'
import { DrizzleMockSigning } from './mock-signing.js'
import { MockSignatureProvider, mockReceiptSha256 } from './signature-provider.js'
import { DrizzleSubmissionDocumentRegistry } from '../submissions/submission-document-registry.repository.js'
import { newDeclarationTemplateBinding } from '../submissions/submission-document-template.js'
import { SubmissionService } from '../submissions/submission.service.js'
import type { ProcedureConfig, PublicProcedure } from '../procedures/procedure.contract.js'
import { DrizzleSubmissionRepository } from '../submissions/submission.repository.js'
import { DrizzleSubmissionDocumentOperations } from '../submissions/submission-document-operations.js'
import { LocalEvidenceStorage } from '../submissions/submission.storage.js'
import { SubmissionError } from '../submissions/submission.types.js'
import { JWT_ISSUER, USER_JWT_AUDIENCE, ADMIN_JWT_AUDIENCE } from '../auth/auth.constants.js'
after(() => databaseClient.end())
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const code = (wanted: string) => (error: unknown) =>
  error instanceof SubmissionError && error.code === wanted
const pg = (wanted: string) => (error: unknown) => {
  let e = error
  for (let i = 0; i < 6 && e && typeof e === 'object'; i++) {
    if ('code' in e && e.code === wanted) return true
    e = 'cause' in e ? e.cause : null
  }
  return false
}
test('mock workflow uses a private synthetic database, scoped rights and immutable receipts', async (t) => {
  const source = new URL(process.env.DATABASE_URL ?? 'http://invalid')
  assert.equal(source.port, '5434')
  assert.equal(source.pathname, '/student_service_test')
  assert.ok(['localhost', '127.0.0.1'].includes(source.hostname))
  const name = 'mock_workflow_test_' + randomUUID().replaceAll('-', '')
  const admin = postgres(source.href, { max: 1, onnotice: () => {} })
  let q: ReturnType<typeof postgres> | undefined
  let orm: ReturnType<typeof postgres> | undefined
  try {
    await admin.unsafe('CREATE DATABASE "' + name + '"')
    source.pathname = '/' + name
    q = postgres(source.href, { max: 8, onnotice: () => {} })
    const client = q
    const journal = JSON.parse(
      await readFile(new URL('../../../drizzle/meta/_journal.json', import.meta.url), 'utf8'),
    ) as { entries: { tag: string }[] }
    for (const entry of journal.entries) {
      const migration = await readFile(
        new URL('../../../drizzle/' + entry.tag + '.sql', import.meta.url),
        'utf8',
      )
      await client.begin(async (tx) => {
        for (const statement of migration.split('--> statement-breakpoint').filter((s) => s.trim()))
          await tx.unsafe(statement)
      })
    }
    orm = postgres(source.href, { max: 8, onnotice: () => {} })
    const database = drizzle(orm),
      student = randomUUID(),
      reviewer = randomUUID(),
      foreign = randomUUID(),
      unit = randomUUID(),
      otherUnit = randomUUID(),
      faculty = randomUUID(),
      clazz = randomUUID()
    for (const [id, username] of [
      [student, 'mock-student'],
      [reviewer, 'mock-reviewer'],
      [foreign, 'mock-foreign'],
    ] as const)
      await client`INSERT INTO users(id,username,full_name,status,must_change_password) VALUES(${id},${username},'Synthetic actor','ACTIVE',false)`
    await client`INSERT INTO organizational_units(id,code,name) VALUES(${unit},'MOCK_UNIT','Synthetic unit'),(${otherUnit},'MOCK_FOREIGN','Other unit')`
    await client`INSERT INTO faculties(id,code,name) VALUES(${faculty},'MOCK_FACULTY','Synthetic faculty')`
    await client`INSERT INTO academic_classes(id,faculty_id,code,name) VALUES(${clazz},${faculty},'MOCK_CLASS','Synthetic class')`
    await client`INSERT INTO student_profiles(user_id,class_id,student_code) VALUES(${student},${clazz},'MOCK001')`
    await client`INSERT INTO roles(code,name,is_system) VALUES('MOCK_REVIEW','Mock review',false),('MOCK_ONLY','Mock only',false),('STUDENT','Student',false) ON CONFLICT(code) DO NOTHING`
    await client`INSERT INTO permissions(code,name) VALUES('submission.review','Review') ON CONFLICT(code) DO NOTHING`
    await client`INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.code='MOCK_REVIEW' AND p.code='submission.review'`
    for (const who of [reviewer, foreign]) {
      await client`INSERT INTO user_roles(user_id,role_id) SELECT ${who},id FROM roles WHERE code='MOCK_REVIEW'`
      const [scope] =
        await client`INSERT INTO authorization_scopes(scope_type,organizational_unit_id) VALUES('ORGANIZATION',${who === reviewer ? unit : otherUnit}) RETURNING id`
      await client`INSERT INTO user_role_scopes(user_id,role_id,scope_id) SELECT ${who},id,${scope!.id as string} FROM roles WHERE code='MOCK_REVIEW'`
    }
    await client`INSERT INTO user_roles(user_id,role_id) SELECT ${student},id FROM roles WHERE code='STUDENT'`
    const grant = async () => {
      await client`INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.code='MOCK_REVIEW' AND p.code='document.mock_sign' ON CONFLICT DO NOTHING`
    }
    const revoke = async () => {
      await client`DELETE FROM role_permissions WHERE role_id=(SELECT id FROM roles WHERE code='MOCK_REVIEW') AND permission_id=(SELECT id FROM permissions WHERE code='document.mock_sign')`
    }
    const bytes = new Map<string, Buffer>()
    let beforeRead: (() => Promise<void>) | undefined
    const vault = {
      read: async (key: string, expected: { size: number; sha256: string }) => {
        await beforeRead?.()
        const value = bytes.get(key)
        if (!value || value.length !== expected.size || digest(value) !== expected.sha256)
          throw new SubmissionError(409, 'DOCUMENT_INTEGRITY', 'Synthetic corruption')
        return Buffer.from(value)
      },
    }
    const ops = new DrizzleMockSigning(vault, { fakeDataOnly: true, environment: 'test' }, database)
    const registry = new DrizzleSubmissionDocumentRegistry(database)
    async function fixture(
      currentRound = 1,
      finalStatus: 'APPROVED' | 'REJECTED' | 'IN_REVIEW' = 'APPROVED',
    ) {
      const id = randomUUID(),
        version = randomUUID(),
        round = randomUUID()
      const [service] =
        await client`INSERT INTO services(code,name,description,processing_days,status) VALUES(${'MOCK_' + id},'Synthetic service','Synthetic',1,'ACTIVE') RETURNING id`
      const config: ProcedureConfig = {
        processingMode: 'ONLINE',
        processingUnitId: unit,
        processorUserId: null,
        contactInstructions: 'Synthetic workflow fixture',
        fields: [],
        attachments: [],
        maxTotalAttachmentBytes: 4096,
      }
      const procedure: PublicProcedure = {
        versionId: version,
        versionNumber: 1,
        processingMode: 'ONLINE',
        processingUnitName: 'Synthetic unit',
        contactInstructions: config.contactInstructions,
        fields: [],
        attachments: [],
        maxTotalAttachmentBytes: 4096,
      }
      const profile = {
        fullName: 'Synthetic actor',
        studentCode: 'MOCK001',
        classCode: 'MOCK_CLASS',
        facultyCode: 'MOCK_FACULTY',
      }
      await client`INSERT INTO procedure_versions(id,service_id,owner_unit_id,version_number,status,published_at,config,created_by,updated_by) VALUES(${version},${service!.id as number},${unit},1,'PUBLISHED',now(),${client.json({ ...config })},${student},${student})`
      await client`INSERT INTO submissions(id,student_user_id,service_id,procedure_version_id,service_name,procedure,values) VALUES(${id},${student},${service!.id as number},${version},'Synthetic',${client.json({ ...procedure })},'{}'::jsonb)`
      await client`UPDATE submissions SET status='SUBMITTED',revision=2,round_number=1,submitted_at=now(),last_submitted_at=now(),processing_unit_id=${unit},student_snapshot=${client.json(profile)} WHERE id=${id}`
      await client`INSERT INTO submission_rounds(id,submission_id,round_number,submitted_at,student_snapshot,values,files,source,declaration_template) VALUES(${round},${id},1,now(),${client.json(profile)},'{}'::jsonb,'[]'::jsonb,'LIVE',${client.json({ ...newDeclarationTemplateBinding() })})`
      await client`UPDATE submissions SET status='IN_REVIEW',revision=3,reviewer_user_id=${reviewer},review_started_at=now() WHERE id=${id}`
      if (currentRound === 2) {
        await client`UPDATE submissions SET status='NEEDS_SUPPLEMENT',revision=4 WHERE id=${id}`
        await client`UPDATE submissions SET status='IN_REVIEW',revision=5,round_number=2,last_submitted_at=now() WHERE id=${id}`
        await client`INSERT INTO submission_rounds(id,submission_id,round_number,submitted_at,student_snapshot,values,files,source,declaration_template) VALUES(${randomUUID()},${id},2,now(),${client.json(profile)},'{}'::jsonb,'[]'::jsonb,'LIVE',${client.json({ ...newDeclarationTemplateBinding() })})`
      }
      if (finalStatus !== 'IN_REVIEW')
        await client`UPDATE submissions SET status=${finalStatus},revision=${currentRound === 2 ? 6 : 4},decision_at=now() WHERE id=${id}`
      const set = await registry.ensureSet(id, 1)
      let wordSha = ''
      for (const format of ['DOCX', 'PDF'] as const) {
        const data = Buffer.from('Synthetic immutable ' + format + ' ' + id),
          claim = await registry.claim(set.id, format)
        assert.equal(claim.state, 'CLAIMED')
        if (claim.state !== 'CLAIMED') throw new Error('Missing claim')
        const hash = digest(data)
        if (format === 'DOCX') wordSha = hash
        const published = await registry.publish(claim.lease, {
          size: data.length,
          sha256: hash,
          template: newDeclarationTemplateBinding(),
          renderer: {
            version: 'synthetic',
            buildSha256: 'a'.repeat(64),
            nodeVersion: process.version,
            icuVersion: 'test',
          },
          converter:
            format === 'PDF' ? { version: 'synthetic', binarySha256: 'b'.repeat(64) } : null,
          sourceDocxSha256: format === 'PDF' ? wordSha : null,
        })
        bytes.set(published.storageKey, data)
      }
      return {
        id,
        round,
        revision:
          finalStatus === 'IN_REVIEW' ? (currentRound === 2 ? 5 : 3) : currentRound === 2 ? 6 : 4,
        set,
        serviceId: service!.id as number,
      }
    }
    const snapshot = async (id: string) => {
      const [s] = await client`SELECT row_to_json(s) AS row FROM submissions s WHERE id=${id}`
      const docs =
        await client`SELECT row_to_json(d) AS row FROM submission_documents d JOIN submission_document_sets ds ON ds.id=d.set_id WHERE ds.submission_id=${id} ORDER BY d.format`
      return JSON.stringify({ s, docs })
    }
    const f = await fixture(),
      before = await snapshot(f.id)

    await t.test('isolated test opt-in is mandatory', async () => {
      assert.throws(
        () =>
          new DrizzleMockSigning(
            vault,
            { fakeDataOnly: true, environment: 'production' as 'test' },
            database,
          ),
        /MOCK_WORKFLOW_REQUIRES_ISOLATED_TEST/,
      )
    })
    await t.test('permission is separate and cannot be assembled across two roles', async () => {
      assert.equal((await ops.status(reviewer, f.id, 1, true)).documents[0]!.canSign, false)
      await assert.rejects(
        ops.sign(reviewer, f.id, 1, 'DOCX', { requestId: randomUUID(), expectedRevision: 4 }),
        code('MOCK_SIGNATURE_FORBIDDEN'),
      )
      await client`INSERT INTO user_roles(user_id,role_id) SELECT ${reviewer},id FROM roles WHERE code='MOCK_ONLY'`
      await client`INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.code='MOCK_ONLY' AND p.code='document.mock_sign'`
      await client`INSERT INTO user_role_scopes(user_id,role_id,scope_id) SELECT ${reviewer},r.id,scope.id FROM roles r CROSS JOIN authorization_scopes scope WHERE r.code='MOCK_ONLY' AND scope.organizational_unit_id=${unit}`
      await assert.rejects(
        ops.sign(reviewer, f.id, 1, 'DOCX', { requestId: randomUUID(), expectedRevision: 4 }),
        code('MOCK_SIGNATURE_FORBIDDEN'),
      )
      await grant()
    })
    await t.test('owner, outside scope, stale revision and old round cannot sign', async () => {
      for (const who of [student, foreign])
        await assert.rejects(
          ops.sign(who, f.id, 1, 'DOCX', { requestId: randomUUID(), expectedRevision: 4 }),
          code('MOCK_SIGNATURE_FORBIDDEN'),
        )
      await assert.rejects(
        ops.sign(reviewer, f.id, 1, 'DOCX', { requestId: randomUUID(), expectedRevision: 2 }),
        code('MOCK_SIGNATURE_CONFLICT'),
      )
      const old = await fixture(2)
      await assert.rejects(
        ops.sign(reviewer, old.id, 1, 'DOCX', { requestId: randomUUID(), expectedRevision: 4 }),
        code('MOCK_SIGNATURE_FORBIDDEN'),
      )
    })
    await t.test(
      'content approval and active service/unit are mandatory; CTSV confirmation stays excluded',
      async () => {
        for (const status of ['IN_REVIEW', 'REJECTED'] as const) {
          const target = await fixture(1, status)
          await assert.rejects(
            ops.sign(reviewer, target.id, 1, 'DOCX', {
              requestId: randomUUID(),
              expectedRevision: target.revision,
            }),
            code('MOCK_SIGNATURE_FORBIDDEN'),
          )
        }
        const target = await fixture()
        await client`UPDATE organizational_units SET status='INACTIVE' WHERE id=${unit}`
        try {
          await assert.rejects(
            ops.sign(reviewer, target.id, 1, 'DOCX', {
              requestId: randomUUID(),
              expectedRevision: 4,
            }),
            code('MOCK_SIGNATURE_FORBIDDEN'),
          )
        } finally {
          await client`UPDATE organizational_units SET status='ACTIVE' WHERE id=${unit}`
        }
        await client`UPDATE services SET status='INACTIVE' WHERE id=${target.serviceId}`
        try {
          await assert.rejects(
            ops.sign(reviewer, target.id, 1, 'DOCX', {
              requestId: randomUUID(),
              expectedRevision: 4,
            }),
            code('MOCK_SIGNATURE_FORBIDDEN'),
          )
        } finally {
          await client`UPDATE services SET status='ACTIVE' WHERE id=${target.serviceId}`
        }
        await client`UPDATE services SET code='STUDENT_CONFIRMATION' WHERE id=${target.serviceId}`
        try {
          await assert.rejects(
            ops.sign(reviewer, target.id, 1, 'DOCX', {
              requestId: randomUUID(),
              expectedRevision: 4,
            }),
            code('MOCK_SIGNATURE_FORBIDDEN'),
          )
        } finally {
          await client`UPDATE services SET code=${'MOCK_' + target.id} WHERE id=${target.serviceId}`
        }
        const [count] =
          await client`SELECT count(*)::int AS n FROM mock_signature_receipts r JOIN submission_documents d ON d.id=r.document_id WHERE d.set_id=${target.set.id}`
        assert.equal(count!.n, 0)
      },
    )
    let signedId = ''
    await t.test(
      'sign binds an immutable stored document; replay writes no second receipt or audit',
      async () => {
        signedId = randomUUID()
        const result = await ops.sign(reviewer, f.id, 1, 'DOCX', {
          requestId: signedId,
          expectedRevision: 4,
        })
        assert.equal(result.technicalSignatureStatus, 'NOT_VERIFIED')
        assert.equal(result.legalEffect, false)
        assert.equal(result.replayed, false)
        const replay = await ops.sign(reviewer, f.id, 1, 'DOCX', {
          requestId: signedId,
          expectedRevision: 4,
        })
        assert.equal(replay.id, signedId)
        assert.equal(replay.replayed, true)
        const [counts] =
          await client`SELECT (SELECT count(*) FROM mock_signature_receipts WHERE id=${signedId})::int AS receipts,(SELECT count(*) FROM audit_logs WHERE action='document.mock_signed' AND resource_id=${signedId})::int AS audits`
        assert.equal(counts!.receipts, 1)
        assert.equal(counts!.audits, 1)
        assert.equal(await snapshot(f.id), before)
        await assert.rejects(
          ops.sign(reviewer, f.id, 1, 'PDF', { requestId: signedId, expectedRevision: 4 }),
          code('MOCK_SIGNATURE_CONFLICT'),
        )
      },
    )
    await t.test('two simultaneous signing requests publish exactly one receipt', async () => {
      const race = await fixture()
      const results = await Promise.allSettled(
        [1, 2].map(() =>
          ops.sign(reviewer, race.id, 1, 'PDF', { requestId: randomUUID(), expectedRevision: 4 }),
        ),
      )
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
      const failure = results.find((r) => r.status === 'rejected')
      assert.ok(failure?.status === 'rejected' && code('MOCK_SIGNATURE_CONFLICT')(failure.reason))
      const [count] =
        await client`SELECT count(*)::int AS n FROM mock_signature_receipts r JOIN submission_documents d ON d.id=r.document_id WHERE d.set_id=${race.set.id}`
      assert.equal(count!.n, 1)
    })
    await t.test('revocation during file I/O aborts before receipt/audit commit', async () => {
      const changed = await fixture()
      let once = false
      beforeRead = async () => {
        if (!once) {
          once = true
          await revoke()
        }
      }
      try {
        await assert.rejects(
          ops.sign(reviewer, changed.id, 1, 'DOCX', {
            requestId: randomUUID(),
            expectedRevision: 4,
          }),
          code('MOCK_SIGNATURE_FORBIDDEN'),
        )
      } finally {
        beforeRead = undefined
        await grant()
      }
      const [count] =
        await client`SELECT count(*)::int AS n FROM mock_signature_receipts r JOIN submission_documents d ON d.id=r.document_id WHERE d.set_id=${changed.set.id}`
      assert.equal(count!.n, 0)
    })
    await t.test(
      'verify uses pinned signer, allows owner, preserves replay and records corruption as mismatch',
      async () => {
        const requestId = randomUUID()
        const result = await ops.verify(student, f.id, 1, 'DOCX', {
          requestId,
          receiptId: signedId,
        })
        assert.equal(result.outcome, 'SIMULATION_MATCH')
        assert.equal(result.technicalSignatureStatus, 'NOT_VERIFIED')
        assert.equal(result.legalEffect, false)
        const [doc] =
          await client`SELECT storage_key FROM submission_documents WHERE set_id=${f.set.id} AND format='DOCX'`
        const key = doc!.storage_key as string,
          original = bytes.get(key)!
        bytes.set(key, Buffer.from('corrupted'))
        try {
          const replay = await ops.verify(student, f.id, 1, 'DOCX', {
            requestId,
            receiptId: signedId,
          })
          assert.equal(replay.outcome, 'SIMULATION_MATCH')
          assert.equal(replay.replayed, true)
          const corrupted = await ops.verify(student, f.id, 1, 'DOCX', {
            requestId: randomUUID(),
            receiptId: signedId,
          })
          assert.equal(corrupted.outcome, 'SIMULATION_MISMATCH')
          assert.equal(corrupted.reason, 'DOCUMENT_CHANGED')
          assert.equal(corrupted.legalEffect, false)
        } finally {
          bytes.set(key, original)
        }
        const status = await ops.status(student, f.id, 1, false)
        assert.equal(status.documents[0]!.checks.length, 2)
        await assert.rejects(
          ops.verify(foreign, f.id, 1, 'DOCX', { requestId: randomUUID(), receiptId: signedId }),
          code('NOT_FOUND'),
        )
      },
    )
    await t.test(
      'a lost viewer permission during I/O produces no verification record',
      async () => {
        const requestId = randomUUID()
        let once = false
        beforeRead = async () => {
          if (!once) {
            once = true
            await client`UPDATE users SET status='LOCKED' WHERE id=${student}`
          }
        }
        try {
          await assert.rejects(
            ops.verify(student, f.id, 1, 'DOCX', { requestId, receiptId: signedId }),
            code('NOT_FOUND'),
          )
        } finally {
          beforeRead = undefined
          await client`UPDATE users SET status='ACTIVE' WHERE id=${student}`
        }
        const [count] =
          await client`SELECT count(*)::int AS n FROM mock_signature_checks WHERE id=${requestId}`
        assert.equal(count!.n, 0)
      },
    )
    await t.test('receipt/check append-only and DB binding guards cannot be bypassed', async () => {
      for (const statement of [
        `UPDATE mock_signature_receipts SET receipt_sha256='${'a'.repeat(64)}' WHERE id='${signedId}'`,
        `DELETE FROM mock_signature_receipts WHERE id='${signedId}'`,
        `UPDATE mock_signature_checks SET result='{}'::jsonb`,
        `DELETE FROM mock_signature_checks`,
      ])
        await assert.rejects(client.unsafe(statement), pg('23514'))
      const target = await fixture(),
        [doc] =
          await client`SELECT * FROM submission_documents WHERE set_id=${target.set.id} AND format='DOCX'`
      const input = {
        document: {
          documentId: doc!.id as string,
          submissionId: target.id,
          roundId: target.round,
          format: 'DOCX' as const,
          size: Number(doc!.size),
          sha256: doc!.sha256 as string,
        },
        actorId: reviewer,
        bytes: bytes.get(doc!.storage_key as string)!,
      }
      const receipt = await new MockSignatureProvider({ fakeDataOnly: true }).sign(input)
      const wrong = { ...receipt, document: { ...receipt.document, roundId: randomUUID() } }
      await assert.rejects(
        client`INSERT INTO mock_signature_receipts(id,document_id,actor_user_id,submission_revision,receipt,receipt_sha256) VALUES(${randomUUID()},${doc!.id as string},${reviewer},4,${client.json(wrong)},${mockReceiptSha256(wrong)})`,
        pg('23514'),
      )
      const invalidShape = {
        ...receipt,
        receiptId: '-'.repeat(36),
        document: { ...receipt.document },
      }
      await assert.rejects(
        client`INSERT INTO mock_signature_receipts(id,document_id,actor_user_id,submission_revision,receipt,receipt_sha256) VALUES(${randomUUID()},${doc!.id as string},${reviewer},4,${client.json(invalidShape)},${'a'.repeat(64)})`,
        pg('23514'),
      )
      await revoke()
      try {
        await assert.rejects(
          client`INSERT INTO mock_signature_receipts(id,document_id,actor_user_id,submission_revision,receipt,receipt_sha256) VALUES(${randomUUID()},${doc!.id as string},${reviewer},4,${client.json({ ...receipt, document: { ...receipt.document } })},${mockReceiptSha256(receipt)})`,
          pg('42501'),
        )
      } finally {
        await grant()
      }
    })
    await t.test('audit failure rolls the signing transaction back', async () => {
      const target = await fixture()
      await client.unsafe(
        `CREATE FUNCTION mock_test_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='document.mock_signed' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`,
      )
      await client.unsafe(
        'CREATE TRIGGER mock_test_fail_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION mock_test_fail_audit()',
      )
      try {
        await assert.rejects(
          ops.sign(reviewer, target.id, 1, 'DOCX', {
            requestId: randomUUID(),
            expectedRevision: 4,
          }),
        )
      } finally {
        await client.unsafe('DROP TRIGGER mock_test_fail_audit ON audit_logs')
        await client.unsafe('DROP FUNCTION mock_test_fail_audit()')
      }
      const [count] =
        await client`SELECT count(*)::int AS n FROM mock_signature_receipts r JOIN submission_documents d ON d.id=r.document_id WHERE d.set_id=${target.set.id}`
      assert.equal(count!.n, 0)
    })
    await t.test(
      'HTTP contracts enforce portal, Origin, strict input, private status and disabled defaults',
      async () => {
        const repo = new DrizzleSubmissionRepository(database),
          documentOps = new DrizzleSubmissionDocumentOperations(database)
        const service = new SubmissionService(
          repo,
          new LocalEvidenceStorage(),
          undefined,
          documentOps,
          ops,
        )
        const app = buildApp({ submissionService: service })
        await app.ready()
        const token = (who: string, portal: 'user' | 'admin' = 'user') =>
          `${portal}_session=` +
          app.jwt.sign(
            {
              sub: who,
              username: 'synthetic',
              roles:
                who === student
                  ? ['STUDENT']
                  : portal === 'admin'
                    ? ['ADMIN']
                    : ['FACULTY_REVIEWER'],
              portal,
              mustChangePassword: false,
              iss: JWT_ISSUER,
              aud: portal === 'admin' ? ADMIN_JWT_AUDIENCE : USER_JWT_AUDIENCE,
            },
            { expiresIn: '5m' },
          )
        const base = '/api/v1/user/review-submissions/' + f.id.toUpperCase() + '/rounds/1'
        try {
          assert.equal((await app.inject({ url: base + '/mock-signatures' })).statusCode, 401)
          const state = await app.inject({
            url: base + '/mock-signatures',
            headers: { cookie: token(reviewer) },
          })
          assert.equal(state.statusCode, 200)
          assert.match(state.headers['cache-control'] as string, /no-store/)
          assert.equal(state.json<{ notice: string }>().notice, 'DEMO – KHÔNG CÓ GIÁ TRỊ PHÁP LÝ')
          assert.equal(
            (
              await app.inject({
                url: base + '/mock-signatures',
                headers: { cookie: token(foreign) },
              })
            ).statusCode,
            404,
          )
          assert.equal(
            (
              await app.inject({
                url: base + '/mock-signatures',
                headers: { cookie: token(reviewer, 'admin') },
              })
            ).statusCode,
            401,
          )
          const payload = { requestId: randomUUID().toUpperCase(), expectedRevision: 4 }
          assert.equal(
            (
              await app.inject({
                method: 'POST',
                url: base + '/documents/pdf/mock-sign',
                headers: { cookie: token(reviewer) },
                payload,
              })
            ).statusCode,
            403,
          )
          assert.equal(
            (
              await app.inject({
                method: 'POST',
                url: base + '/documents/pdf/mock-sign',
                headers: { cookie: token(reviewer), origin: env.corsOrigin },
                payload: { ...payload, receipt: {} },
              })
            ).statusCode,
            400,
          )
          assert.equal(
            (
              await app.inject({
                method: 'POST',
                url: base + '/documents/pdf/mock-sign',
                headers: { cookie: token(reviewer), origin: env.corsOrigin },
                payload,
              })
            ).statusCode,
            200,
          )
          const ownerBase = '/api/v1/user/submissions/' + f.id + '/rounds/1'
          assert.equal(
            (
              await app.inject({
                method: 'POST',
                url: ownerBase + '/documents/pdf/mock-sign',
                headers: { cookie: token(student), origin: env.corsOrigin },
                payload,
              })
            ).statusCode,
            404,
          )
          const pdfReceipt = (await ops.status(student, f.id, 1, false)).documents.find(
            (d) => d.format === 'pdf',
          )!.receipt!
          const verify = await app.inject({
            method: 'POST',
            url: ownerBase + '/documents/pdf/mock-verify',
            headers: { cookie: token(student), origin: env.corsOrigin },
            payload: { requestId: randomUUID(), receiptId: pdfReceipt.id },
          })
          assert.equal(verify.statusCode, 200)
          assert.equal(verify.json<{ legalEffect: boolean }>().legalEffect, false)
        } finally {
          await app.close()
        }
        const disabled = new SubmissionService(
          repo,
          new LocalEvidenceStorage(),
          undefined,
          documentOps,
        )
        assert.deepEqual(await disabled.mockSignatureStatus(student, f.id, 1, false), {
          enabled: false,
          documents: [],
        })
        await assert.rejects(
          disabled.mockSignatureSign(reviewer, f.id, 1, 'docx', {
            requestId: randomUUID(),
            expectedRevision: 4,
          }),
          code('MOCK_SIGNATURE_DISABLED'),
        )
      },
    )
    assert.equal(await snapshot(f.id), before)
  } finally {
    if (orm) await orm.end({ timeout: 5 })
    if (q) await q.end({ timeout: 5 })
    await admin.unsafe('DROP DATABASE IF EXISTS "' + name + '"')
    await admin.end()
  }
})
