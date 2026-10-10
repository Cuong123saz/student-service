// Private child of the fake-data recovery rehearsal, never a general server launcher.
import { resolve } from 'node:path'
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
const app = buildApp()
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
})
process.on('disconnect', () => {
  void stop().finally(() => process.exit(0))
})
