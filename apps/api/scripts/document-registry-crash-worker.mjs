// Internal synthetic fault worker; spawned only by the private-database integration test.
import { db, databaseClient } from '../src/db/client.ts'
import { DrizzleSubmissionDocumentRegistry } from '../src/modules/submissions/submission-document-registry.repository.ts'
import { StoredSubmissionDocumentRenderer } from '../src/modules/submissions/submission-document-coordinator.ts'
import { LocalDocumentVault } from '../src/modules/submissions/submission-document-vault.ts'
import { LocalSubmissionDocumentRenderer } from '../src/modules/submissions/submission-document.ts'
const url = new URL(process.env.DATABASE_URL ?? 'http://invalid')
if (
  url.port !== '5434' ||
  !['127.0.0.1', 'localhost'].includes(url.hostname) ||
  !/^\/document_registry_test_[a-f0-9]{32}$/.test(url.pathname) ||
  !process.send
)
  throw new Error('CRASH_WORKER_REQUIRES_OWNED_TEST_DATABASE')
async function barrier(phase, attemptId) {
  process.send({ phase, attemptId })
  await new Promise(() => {
    setInterval(() => {}, 1000)
  })
}
process.once('message', async (options) => {
  try {
    const registry = new DrizzleSubmissionDocumentRegistry(db, 5, 0)
    const vault = await LocalDocumentVault.create({
      ...options.vault,
      onDurableWrite: async (phase, key) => {
        if (phase === options.phase) await barrier(phase, key)
      },
    })
    const facade = {
      ensureSet: registry.ensureSet.bind(registry),
      get: registry.get.bind(registry),
      claim: registry.claim.bind(registry),
      fail: registry.fail.bind(registry),
      publish: async (lease, metadata) => {
        const document = await registry.publish(lease, metadata)
        if (options.phase === 'COMMITTED') await barrier('COMMITTED', lease.attemptId)
        return document
      },
    }
    const coordinator = new StoredSubmissionDocumentRenderer(
      facade,
      vault,
      new LocalSubmissionDocumentRenderer(),
      {
        convert: async () => {
          throw new Error('PDF not used by crash worker')
        },
      },
      {
        renderer: async () => options.renderer,
        converter: async () => {
          throw new Error('PDF not used by crash worker')
        },
      },
    )
    await coordinator.render(options.snapshot, 'docx')
    process.send({ phase: 'UNEXPECTED_COMPLETION' })
  } catch (error) {
    process.send({
      phase: 'FAILED',
      code: error?.code === 'DOCUMENT_BUSY' ? 'DOCUMENT_BUSY' : 'CRASH_WORKER_FAILED',
    })
  } finally {
    await databaseClient.end()
    process.disconnect()
  }
})

// The parent waits for both processes to load before starting the short test lease.
process.send({ phase: 'READY' })
