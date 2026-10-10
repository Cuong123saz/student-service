import postgres from 'postgres'
import { auditConfiguration, auditEvidence, readEvidenceReferences } from './evidence-integrity.mjs'

let client
try {
  if (process.argv.length !== 2) throw new Error('NO_ARGUMENTS_SUPPORTED')
  const { databaseUrl, root } = auditConfiguration(process.env)
  client = postgres(databaseUrl, { max: 1, connect_timeout: 5, onnotice: () => {} })
  const report = await client.begin('isolation level repeatable read read only', async (tx) => {
    await tx`SET LOCAL statement_timeout = '30s'`
    return auditEvidence({ root, references: readEvidenceReferences(tx) })
  })
  process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  process.exitCode = report.status === 'OK' ? 0 : 2
} catch (error) {
  const safeCodes = new Set([
    'INVALID_DATABASE_CONFIG',
    'REQUIRES_KNOWN_LOCAL_DATABASE',
    'REQUIRES_ABSOLUTE_STORAGE_ROOT',
    'UNSAFE_STORAGE_ROOT',
    'NO_ARGUMENTS_SUPPORTED',
  ])
  const code = safeCodes.has(error.message) ? error.message : 'SCAN_INCOMPLETE'
  // Never print the driver error: it can contain credentials, SQL or private paths.
  process.stderr.write(JSON.stringify({ status: 'INCOMPLETE', code }) + '\n')
  process.exitCode = 1
} finally {
  try {
    await client?.end({ timeout: 5 })
  } catch {
    process.stderr.write(JSON.stringify({ status: 'INCOMPLETE', code: 'CLOSE_FAILED' }) + '\n')
    process.exitCode = 1
  }
}
