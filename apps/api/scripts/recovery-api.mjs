// Private child of the fake-data recovery rehearsal, never a general server launcher.
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertDrillDatabase, sourceDatabase, targetDatabase } from './recovery-bundle.mjs'
const runId = process.env.RECOVERY_DRILL_ID || ''
if (!process.send || !/^[a-f0-9-]{36}$/.test(runId) || process.env.APP_ENV !== 'test')
  throw new Error('REQUIRES_RECOVERY_PARENT')
const database = new URL(process.env.DATABASE_URL).pathname.slice(1)
assertDrillDatabase(process.env.DATABASE_URL, database)
if (![sourceDatabase, targetDatabase].includes(database)) throw new Error('INVALID_DRILL_DATABASE')
const runRoot = fileURLToPath(
  new URL('../../../run/recovery-drills/' + runId + '/', import.meta.url),
)
const expectedRoot = resolve(
  runRoot,
  database === sourceDatabase ? 'source-files' : 'restored-files',
)
if (
  resolve(process.env.SUBMISSION_STORAGE_ROOT || '') !== expectedRoot ||
  process.env.DOTENV_CONFIG_PATH !== resolve(runRoot, 'fake.env')
)
  throw new Error('INVALID_DRILL_STORAGE')
const { buildApp } = await import('../dist/app.js')
const { databaseClient } = await import('../dist/db/client.js')
let registry, submissionService
if (process.env.RECOVERY_DOCUMENT_REGISTRY === 'true') {
  const vaultRoot = resolve('D:/student-service-registry-drill-' + runId),
    prefix = database === sourceDatabase ? 'source' : 'restored'
  const outputRoot = join(vaultRoot, prefix + '-documents'),
    stagingRoot = join(vaultRoot, prefix + '-staging'),
    templateRoot = join(vaultRoot, prefix + '-templates')
  if (
    process.env.RECOVERY_DOCUMENT_ROOT !== outputRoot ||
    process.env.RECOVERY_DOCUMENT_STAGING_ROOT !== stagingRoot ||
    process.env.RECOVERY_DOCUMENT_TEMPLATE_ROOT !== templateRoot
  )
    throw new Error('INVALID_DRILL_DOCUMENT_STORAGE')
  const { db } = await import('../dist/db/client.js')
  const { DrizzleSubmissionDocumentRegistry } =
    await import('../dist/modules/submissions/submission-document-registry.repository.js')
  const { DrizzleSubmissionRepository } =
    await import('../dist/modules/submissions/submission.repository.js')
  const { DrizzleSubmissionDocumentOperations } =
    await import('../dist/modules/submissions/submission-document-operations.js')
  const { SubmissionService } = await import('../dist/modules/submissions/submission.service.js')
  const { LocalEvidenceStorage } = await import('../dist/modules/submissions/submission.storage.js')
  const { LocalDocumentVault } =
    await import('../dist/modules/submissions/submission-document-vault.js')
  const { LocalDocumentProvenance } =
    await import('../dist/modules/submissions/submission-document-provenance.js')
  const { StoredSubmissionDocumentRenderer } =
    await import('../dist/modules/submissions/submission-document-coordinator.js')
  const { LocalSubmissionDocumentRenderer, LibreOfficePdfConverter } =
    await import('../dist/modules/submissions/submission-document.js')
  const repo = fileURLToPath(new URL('../../../', import.meta.url)),
    api = join(repo, 'apps/api'),
    command = process.env.LIBREOFFICE_PATH
  if (!command) throw new Error('REGISTRY_DRILL_REQUIRES_CONVERTER')
  registry = new DrizzleSubmissionDocumentRegistry(db)
  const vault = await LocalDocumentVault.create({
    outputRoot,
    stagingRoot,
    protectedRoots: [repo, process.env.SUBMISSION_STORAGE_ROOT, templateRoot],
  })
  const provenance = await LocalDocumentProvenance.create({
    codeRoots: [join(api, 'dist'), join(repo, 'node_modules/fflate')],
    metadataFiles: [join(repo, 'package-lock.json'), join(api, 'package.json')],
    converterCommand: command,
    converterBinary: join(command, '..', 'soffice.bin'),
  })
  const documents = new StoredSubmissionDocumentRenderer(
    registry,
    vault,
    new LocalSubmissionDocumentRenderer(
      new LibreOfficePdfConverter(command),
      join(templateRoot, 'submission-summary-v1.docx'),
    ),
    new LibreOfficePdfConverter(command),
    provenance,
  )
  submissionService = new SubmissionService(
    new DrizzleSubmissionRepository(),
    new LocalEvidenceStorage(),
    documents,
    new DrizzleSubmissionDocumentOperations(),
  )
}
const app = buildApp(submissionService ? { submissionService } : {})
const address = await app.listen({ host: '127.0.0.1', port: 0 })
process.send({ address })
let stopping = false
async function stop() {
  if (stopping) return
  stopping = true
  await app.close()
  await databaseClient.end({ timeout: 5 })
  process.disconnect()
}
process.on('message', (message) => {
  if (message === 'stop') void stop()
  else if (
    registry &&
    database === sourceDatabase &&
    ['claim-unfinished-pdf', 'exhaust-pdf-for-retry'].includes(message?.type) &&
    /^[a-f0-9-]{36}$/.test(message.submissionId) &&
    message.roundNumber === 1
  ) {
    void (async () => {
      try {
        const set = await registry.ensureSet(message.submissionId, 1),
          claim = await registry.claim(set.id, 'PDF')
        if (message.type === 'exhaust-pdf-for-retry') {
          let current = claim
          for (let i = 0; i < 3; i++) {
            if (current.state !== 'CLAIMED') throw new Error('EXPECTED_OWNED_CLAIM')
            await registry.fail(current.lease, 'CONVERT_FAILED')
            if (i < 2) {
              await new Promise((res) => setTimeout(res, 3100))
              current = await registry.claim(set.id, 'PDF')
            }
          }
          process.send({
            type: 'exhausted-pdf',
            state: (await registry.claim(set.id, 'PDF')).state,
          })
        } else process.send({ type: 'unfinished-pdf', state: claim.state })
      } catch {
        process.send({ type: 'unfinished-pdf', state: 'FAILED' })
      }
    })()
  }
})
process.on('disconnect', () => {
  void stop().finally(() => process.exit(0))
})
