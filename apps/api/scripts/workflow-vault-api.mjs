// Copied into a fresh demo runtime; deliberately refuses direct/source invocation.
import { fileURLToPath } from 'node:url'
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
  protectedRoots: [p.projectRoot, p.evidence, p.templates],
})
const processObserver = (phase) => ({
  finished: (report) =>
    console.log(JSON.stringify({ event: 'VAULT_DEMO_PROCESS', phase, ...report })),
})
const { runWindowsDocumentProcess } =
  await import('./dist/modules/submissions/submission-document-supervisor.js')
const provenance = await LocalDocumentProvenance.create(
  {
    codeRoots: [join(p.api, 'dist'), join(p.projectRoot, 'node_modules/fflate')],
    metadataFiles: [
      join(p.api, 'package.json'),
      join(p.api, 'package-lock.json'),
      p.entry,
      join(p.api, 'workflow-vault.contract.mjs'),
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
const converter = new LibreOfficePdfConverter(
  process.env.LIBREOFFICE_PATH,
  (command, args, timeoutMs) =>
    runWindowsDocumentProcess(command, args, timeoutMs ?? 90000, processObserver('PDF')),
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
const documents = new StoredSubmissionDocumentRenderer(
  registry,
  vault,
  localRenderer,
  converter,
  observedProvenance,
)
const service = new SubmissionService(
  new DrizzleSubmissionRepository(),
  new LocalEvidenceStorage(),
  documents,
  new DrizzleSubmissionDocumentOperations(),
)
const app = buildApp({ submissionService: service })
await app.listen({ host: '127.0.0.4', port: 3016 })
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
