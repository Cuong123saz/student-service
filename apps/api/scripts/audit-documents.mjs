import postgres from 'postgres'
import { isAbsolute } from 'node:path'
import { auditConfiguration } from './evidence-integrity.mjs'
import { auditDocumentRegistry } from './document-registry-inventory.mjs'
import { assertDisjointRecoveryRoots } from './recovery-assets.mjs'
let client
try {
  if (process.argv.length !== 2) throw new Error('NO_ARGUMENTS_SUPPORTED')
  const { databaseUrl, root } = auditConfiguration(process.env)
  const options = {
    templateRoot: process.env.SUBMISSION_DOCUMENT_TEMPLATE_ROOT,
    documentRoot: process.env.SUBMISSION_DOCUMENT_ROOT,
    stagingRoot: process.env.SUBMISSION_DOCUMENT_STAGING_ROOT,
  }
  if (Object.values(options).some((path) => typeof path !== 'string' || !isAbsolute(path)))
    throw new Error('DOCUMENT_AUDIT_NOT_CONFIGURED')
  assertDisjointRecoveryRoots([root, ...Object.values(options)])
  client = postgres(databaseUrl, { max: 1, connect_timeout: 5, onnotice: () => {} })
  const report = await client.begin('isolation level repeatable read read only', async (sql) => {
    await sql`SET LOCAL statement_timeout='30s'`
    return auditDocumentRegistry({ sql, ...options })
  })
  delete report.assets
  process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  process.exitCode = report.status === 'OK' ? 0 : 2
} catch (error) {
  const allowed = new Set([
    'NO_ARGUMENTS_SUPPORTED',
    'INVALID_DATABASE_CONFIG',
    'REQUIRES_KNOWN_LOCAL_DATABASE',
    'REQUIRES_ABSOLUTE_STORAGE_ROOT',
    'DOCUMENT_AUDIT_NOT_CONFIGURED',
    'INVALID_DOCUMENT_ASSETS',
  ])
  process.stderr.write(
    JSON.stringify({
      status: 'INCOMPLETE',
      code: allowed.has(error.message) ? error.message : 'DOCUMENT_INVENTORY_INCOMPLETE',
    }) + '\n',
  )
  process.exitCode = 1
} finally {
  try {
    await client?.end({ timeout: 5 })
  } catch {
    process.exitCode = 1
  }
}
