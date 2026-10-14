// Copied into a fresh demo runtime; deliberately refuses direct/source invocation.
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { assertVaultDemoEnvironment } from './workflow-vault.contract.mjs'
const projectRoot = fileURLToPath(new URL('../../../../../', import.meta.url))
const p = assertVaultDemoEnvironment(
  projectRoot,
  process.env,
  fileURLToPath(import.meta.url),
  Boolean(process.send && process.connected),
)
const { buildApp } = await import('./dist/app.js')
const { db, databaseClient } = await import('./dist/db/client.js')
const { DrizzleSubmissionRepository } =
  await import('./dist/modules/submissions/submission.repository.js')
const { DrizzleSubmissionDocumentRegistry } =
  await import('./dist/modules/submissions/submission-document-registry.repository.js')
const { DrizzleSubmissionDocumentOperations } =
  await import('./dist/modules/submissions/submission-document-operations.js')
const { SubmissionService } = await import('./dist/modules/submissions/submission.service.js')
const { LocalEvidenceStorage } = await import('./dist/modules/submissions/submission.storage.js')
const { LocalDocumentVault, assertDocumentDirectory } =
  await import('./dist/modules/submissions/submission-document-vault.js')
const { LocalDocumentProvenance } =
  await import('./dist/modules/submissions/submission-document-provenance.js')
const { StoredSubmissionDocumentRenderer } =
  await import('./dist/modules/submissions/submission-document-coordinator.js')
const { LocalSubmissionDocumentRenderer, LibreOfficePdfConverter } =
  await import('./dist/modules/submissions/submission-document.js')
for (const path of [p.runRoot, p.api, p.templates, p.evidence]) await assertDocumentDirectory(path)
const registry = new DrizzleSubmissionDocumentRegistry(db)
const vault = await LocalDocumentVault.create({
  outputRoot: p.output,
  stagingRoot: p.staging,
  protectedRoots: [p.api, join(p.projectRoot, 'node_modules'), p.evidence, p.templates],
})
const processObserver = (phase) => ({
  finished: (report) =>
    console.log(JSON.stringify({ event: 'VAULT_DEMO_PROCESS', phase, ...report })),
})
const { runWindowsDocumentProcess } =
  await import('./dist/modules/submissions/submission-document-supervisor.js')
const sealedProfileMode = ['signature', 'sprint6'].includes(process.env.WORKFLOW_VAULT_MODE)
const provenance = await LocalDocumentProvenance.create(
  {
    codeRoots: [join(p.api, 'dist'), join(p.projectRoot, 'node_modules/fflate')],
    metadataFiles: [
      join(p.api, 'package.json'),
      join(p.api, 'package-lock.json'),
      p.entry,
      join(p.api, 'workflow-vault.contract.mjs'),
      ...(sealedProfileMode ? [join(p.api, 'converter-bootstrap/manifest.json')] : []),
    ],
    converterCommand: process.env.LIBREOFFICE_PATH,
    converterBinary: join(process.env.LIBREOFFICE_PATH, '..', 'soffice.bin'),
  },
  processObserver('VERSION'),
)
const observedProvenance = {
  renderer: () => provenance.renderer(),
  converter: async () => {
    try {
      return await provenance.converter()
    } catch (error) {
      const known = [
        'DOCUMENT_CONVERSION_TIMEOUT',
        'DOCUMENT_CONVERSION_FAILED',
        'DOCUMENT_PROCESS_TERMINATION_UNCERTAIN',
        'DOCUMENT_SUPERVISOR_UNAVAILABLE',
        'DOCUMENT_DEPLOYMENT_CHANGED',
        'DOCUMENT_CONVERTER_CHANGED',
      ]
      console.error(
        JSON.stringify({
          event: 'VAULT_DEMO_PROVENANCE_FAILED',
          code: known.includes(error.message) ? error.message : 'DOCUMENT_CHECK_FAILED',
        }),
      )
      throw error
    }
  },
}
const prepareProfile = sealedProfileMode
  ? await (
      await import('./dist/modules/signatures/mock-converter-profile.js')
    ).loadMockConverterProfile(
      join(p.api, 'converter-bootstrap/profile'),
      join(p.api, 'converter-bootstrap/manifest.json'),
      join(process.env.LIBREOFFICE_PATH, '..', 'soffice.bin'),
    )
  : undefined
const converter = new LibreOfficePdfConverter(
  process.env.LIBREOFFICE_PATH,
  (command, args, timeoutMs) =>
    runWindowsDocumentProcess(command, args, timeoutMs ?? 90000, processObserver('PDF')),
  prepareProfile,
)
const localRenderer = new LocalSubmissionDocumentRenderer(
  converter,
  join(p.templates, 'submission-summary-v1.docx'),
)
const { checkSubmissionDocumentRuntime } =
  await import('./dist/modules/submissions/submission-document-runtime.js')
const versionBefore = await observedProvenance.converter()
const readiness = await checkSubmissionDocumentRuntime(localRenderer)
const versionAfter = await observedProvenance.converter()
if (readiness.status !== 'READY' || JSON.stringify(versionBefore) !== JSON.stringify(versionAfter))
  throw new Error('VAULT_DEMO_DOCUMENTS_NOT_READY')
console.log(
  JSON.stringify({ event: 'VAULT_DEMO_DOCUMENTS_READY', word: readiness.word, pdf: readiness.pdf }),
)
// Fault injection exists only in the fixed, fake-data retry profile and over parent IPC.
// It never changes job counters: real HTTP requests and the coordinator record failures.
let armedSha,
  remainingFailures = 0,
  repaired = false
const retryMode = process.env.WORKFLOW_VAULT_MODE === 'retry'
const retryConverter = {
  convert: async (bytes) => {
    if (retryMode && armedSha === createHash('sha256').update(bytes).digest('hex') && !repaired) {
      if (remainingFailures > 0) remainingFailures--
      throw new Error('FAKE_REHEARSAL_CONVERSION_FAILED')
    }
    return converter.convert(bytes)
  },
}
async function inspectRetry() {
  const documents =
    await databaseClient`SELECT format,sha256,source_docx_sha256,status,renderer,converter FROM submission_documents ORDER BY format`
  const jobs =
    await databaseClient`SELECT format,state,attempts,retry_allowance,error_code FROM submission_document_jobs ORDER BY format`
  const retries =
    await databaseClient`SELECT attempts,allowance,reason_code,actor_user_id FROM submission_document_retries ORDER BY created_at`
  const audits =
    await databaseClient`SELECT action,actor_type,actor_user_id FROM audit_logs WHERE action='document.retry.authorized'`
  return { documents, jobs, retries, audits, remainingFailures, repaired }
}
if (retryMode)
  process.on('message', (m) => {
    if (
      !['ARM', 'REPAIR', 'INSPECT'].includes(m?.type) ||
      !/^[a-f0-9-]{36}$/.test(m.requestId || '')
    )
      return
    void (async () => {
      try {
        if (m.type === 'ARM') {
          assert.ok(!armedSha && /^[a-f0-9]{64}$/.test(m.wordSha || ''), 'RETRY_ALREADY_ARMED')
          const [counts] =
            await databaseClient`SELECT (SELECT count(*) FROM submissions)::int AS submissions,(SELECT count(*) FROM submission_rounds)::int AS rounds`
          const snapshot = await inspectRetry()
          assert.ok(
            counts.submissions === 1 &&
              counts.rounds === 1 &&
              snapshot.documents.length === 1 &&
              snapshot.documents[0].format === 'DOCX' &&
              snapshot.documents[0].sha256 === m.wordSha &&
              snapshot.jobs.length === 1 &&
              snapshot.jobs[0].state === 'COMPLETE' &&
              snapshot.retries.length === 0,
            'RETRY_FIXTURE_MISMATCH',
          )
          armedSha = m.wordSha
          remainingFailures = 3
        } else if (m.type === 'REPAIR') {
          const snapshot = await inspectRetry(),
            pdf = snapshot.jobs.find((j) => j.format === 'PDF')
          assert.ok(
            armedSha &&
              remainingFailures === 0 &&
              !repaired &&
              pdf?.attempts === 3 &&
              pdf.retry_allowance === 0 &&
              pdf.state === 'RETRYABLE' &&
              pdf.error_code === 'CONVERT_FAILED',
            'RETRY_NOT_EXHAUSTED',
          )
          repaired = true
        }
        process.send({
          type: 'RETRY_REHEARSAL_RESULT',
          requestId: m.requestId,
          ok: true,
          snapshot: await inspectRetry(),
        })
      } catch {
        process.send({ type: 'RETRY_REHEARSAL_RESULT', requestId: m.requestId, ok: false })
      }
    })()
  })
const documents = new StoredSubmissionDocumentRenderer(
  registry,
  vault,
  localRenderer,
  retryConverter,
  observedProvenance,
)
const service = new SubmissionService(
  new DrizzleSubmissionRepository(),
  new LocalEvidenceStorage(),
  documents,
  new DrizzleSubmissionDocumentOperations(),
)
const app = buildApp({ submissionService: service })
await app.listen({ host: process.env.API_HOST, port: Number(process.env.API_PORT) })
let stopping = false
async function stop() {
  if (stopping) return
  stopping = true
  await app.close()
  await databaseClient.end({ timeout: 5 })
  if (process.connected) process.disconnect()
}
process.on('disconnect', () => void stop())
process.on('message', (m) => {
  if (m === 'stop') void stop()
})
process.on('SIGTERM', () => void stop())
process.on('SIGINT', () => void stop())

// Covers parent loss during async initialization before the disconnect listener existed.
if (!process.connected) await stop()
