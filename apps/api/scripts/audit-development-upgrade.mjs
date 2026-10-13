// Offline backup audit/rehearsal only. No API, mail, workers, seed, source mount or source startup.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID, randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pipeline } from 'node:stream/promises'
import { setTimeout as pause } from 'node:timers/promises'
import postgres from 'postgres'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { assertRecoveryDirectory, fileDigest } from './recovery-bundle.mjs'
import { readRecoveryPrivateFile, copyRecoveryPrivateFile } from './recovery-private-file.mjs'
import { snapshotDevelopment } from './development-snapshot.mjs'
import {
  developmentVolume,
  assertOfflineDevelopmentSource,
  assertDevelopmentVolumeQuiescent,
} from './offline-development.contract.mjs'
import {
  assertDevelopmentAuditInvocation,
  assertDevelopmentAuditContainer,
  inspectMigrationHistory,
  inspectKnownLegacyHistory,
  legacyShapeSql,
  compareDevelopmentSchema,
  assertLegacyLedgerPreserved,
  assertPreservedCatalogRows,
  assertUpgradeSequences,
} from './development-upgrade.contract.mjs'
const options = assertDevelopmentAuditInvocation(process.argv.slice(2), process.env)
assert.equal(process.versions.node.split('.')[0], '22', 'NODE_22_REQUIRED')
const project = fileURLToPath(new URL('../../../', import.meta.url)),
  api = join(project, 'apps/api')
const runId = randomUUID(),
  root = join(project, 'run/development-upgrade', runId)
const backup = join(project, 'run/offline-development', options.preservationRun)
const clones = [],
  clients = []
let original,
  preservation,
  phase = 'preflight'
const report = {
  version: 1,
  runId,
  preservationRun: options.preservationRun,
  status: 'RUNNING',
  basis: 'VERIFIED_PRESERVATION_COPY',
  sourceModified: false,
  checks: {},
}
function operation(args, env = {}, input) {
  const child = spawn('docker', args, {
    windowsHide: true,
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  child.stderr.resume()
  let output = '',
    overflow = false
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (text) => {
    if (output.length + text.length <= 1048576) output += text
    else {
      overflow = true
      child.kill()
    }
  })
  const timer = setTimeout(() => child.kill(), 120000)
  const closed = new Promise((res, rej) => {
    child.once('error', () => rej(new Error('DOCKER_UNAVAILABLE')))
    child.once('close', (code) => (code === 0 ? res() : rej(new Error('DOCKER_OPERATION_FAILED'))))
  }).finally(() => clearTimeout(timer))
  const incoming = input
    ? pipeline(createReadStream(input), child.stdin)
    : (child.stdin.end(), Promise.resolve())
  return Promise.all([closed, incoming])
    .then(() => {
      assert.ok(!overflow, 'DOCKER_RESPONSE_LIMIT')
      return output.trim()
    })
    .catch((error) => {
      child.kill()
      throw error
    })
}
async function inspect(id) {
  return JSON.parse(await operation(['inspect', id]))[0]
}
async function sourceOffline() {
  const info = await inspect('student-service-postgres')
  assertOfflineDevelopmentSource(info, original?.Id || preservation?.sourceContainerId)
  const ids = (await operation(['ps', '-aq', '--filter', 'volume=' + developmentVolume]))
    .split(/\s+/)
    .filter(Boolean)
  assertDevelopmentVolumeQuiescent(
    ids.length ? JSON.parse(await operation(['inspect', ...ids])) : [],
  )
  return info
}
async function owned(clone) {
  const info = await inspect(clone.id)
  assertDevelopmentAuditContainer(info, runId, clone.id, clone.kind, preservation.imageId)
  return info
}
async function create(kind) {
  const password = randomBytes(24).toString('hex'),
    database = 'student_service_development_audit'
  const id = await operation(
    [
      'create',
      '--name',
      'student-service-dev-audit-' + runId + '-' + kind,
      '--label',
      'student-service.development-audit-id=' + runId,
      '--tmpfs',
      '/var/lib/postgresql/data:rw,size=536870912',
      '--publish',
      '127.0.0.1::5432',
      '--memory',
      '768m',
      '--cpus',
      '1',
      '--env',
      'POSTGRES_PASSWORD',
      '--env',
      'POSTGRES_DB=' + database,
      preservation.imageId,
    ],
    { POSTGRES_PASSWORD: password },
  )
  const clone = { id, kind, database, password }
  clones.push(clone)
  await owned(clone)
  await operation(['start', id])
  let ready = false
  for (let i = 0; i < 100; i++) {
    try {
      await operation([
        'exec',
        id,
        'pg_isready',
        '-h',
        '127.0.0.1',
        '-U',
        'postgres',
        '-d',
        database,
      ])
      ready = true
      break
    } catch {
      assert.equal((await owned(clone)).State.Running, true, 'CLONE_EXITED')
      await pause(250)
    }
  }
  assert.ok(ready, 'CLONE_START_TIMEOUT')
  return clone
}
async function client(clone) {
  const info = await owned(clone),
    ports = info.NetworkSettings.Ports['5432/tcp']
  assert.ok(
    ports?.length === 1 &&
      ports[0].HostIp === '127.0.0.1' &&
      !['5433', '5434'].includes(ports[0].HostPort),
    'PRIVATE_PORT_REQUIRED',
  )
  const url = new URL('postgres://127.0.0.1:' + ports[0].HostPort + '/' + clone.database)
  url.username = 'postgres'
  url.password = clone.password
  const sql = postgres(url.toString(), {
    max: 1,
    connect_timeout: 5,
    onnotice: () => {},
    connection: { statement_timeout: 30000 },
  })
  clients.push(sql)
  await sql`SELECT 1`
  return sql
}
async function save(name, data) {
  await writeFile(join(root, name + '.json'), JSON.stringify(data, null, 2) + '\n', {
    flag: 'wx',
    mode: 0o600,
  })
}
async function load(path, maximum = 2097152) {
  return JSON.parse((await readRecoveryPrivateFile(path, maximum)).toString('utf8'))
}
async function readHistory(sql) {
  return [
    ...(await sql`SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at,id`),
  ]
}
async function migration(clone, folder) {
  await owned(clone)
  const sql = await client(clone)
  await migrate(drizzle(sql), { migrationsFolder: folder })
  await sql.end({ timeout: 5 }) // drizzle changes serializers: never reuse this client for snapshots.
}
try {
  await assertRecoveryDirectory(project)
  await assertRecoveryDirectory(backup)
  preservation = await load(join(backup, 'report.json'))
  assert.ok(
    preservation.runId === options.preservationRun &&
      preservation.preservationStatus === 'VERIFIED_PREUPGRADE_COPY' &&
      preservation.sourceModified === false &&
      preservation.cleanup === true &&
      preservation.systemPreservationReady === true &&
      [
        'sourcePhysicalBytesStable',
        'physicalCopyOpened',
        'syntheticColumnAndFunctionChangesDetected',
        'logicalRestoreMatchesEveryTableAndSchema',
        'sourceAndAssetsUnchanged',
      ].every((key) => preservation.checks[key] === true),
    'VERIFIED_PRESERVATION_REQUIRED',
  )
  original = await sourceOffline()
  assert.equal(original.Image, preservation.imageId, 'SOURCE_IMAGE_CHANGED')
  const dump = join(backup, 'database.dump')
  assert.deepEqual(
    await fileDigest(dump, 536870912),
    preservation.logical,
    'PRESERVED_DUMP_CHANGED',
  )
  const savedBaseline = await load(join(backup, 'source-digests.json'))
  assert.deepEqual(
    await load(join(backup, 'restored-digests.json')),
    savedBaseline,
    'SAVED_RESTORE_BASELINE_MISMATCH',
  )
  await assertRecoveryDirectory(join(project, 'run'))
  await mkdir(join(project, 'run/development-upgrade'), { recursive: true })
  await assertRecoveryDirectory(join(project, 'run/development-upgrade'))
  await mkdir(root)
  await assertRecoveryDirectory(root)
  console.log(JSON.stringify({ event: 'DEVELOPMENT_UPGRADE_AUDIT_STARTED', runId }))
  phase = 'restore-verified-private-copy'
  const privateDump = join(root, 'verified-database.dump')
  await copyRecoveryPrivateFile(dump, privateDump, preservation.logical, 536870912)
  const target = await create('upgrade')
  await operation(
    [
      'exec',
      '-i',
      target.id,
      'pg_restore',
      '-U',
      'postgres',
      '-d',
      target.database,
      '--exit-on-error',
      '--no-owner',
      '--no-privileges',
    ],
    {},
    privateDump,
  )
  const restored = await client(target)
  assert.deepEqual(
    await snapshotDevelopment(restored),
    savedBaseline,
    'RESTORED_BACKUP_BASELINE_CHANGED',
  )
  const before = await snapshotDevelopment(restored, { detailed: true })
  await save('before-digests', before)
  report.checks.restoredVerifiedBackupMatches = true
  const migrations = readMigrationFiles({ migrationsFolder: join(api, 'drizzle') })
  const history = await readHistory(restored)
  report.history = inspectMigrationHistory(history, migrations)
  const knownLegacy = inspectKnownLegacyHistory(history, migrations)
  // This tool deliberately supports exactly the observed 0022 state, not arbitrary legacy ledgers.
  assert.ok(
    knownLegacy || (report.history.canonical && history.length === 23),
    'UNRECOGNIZED_DEVELOPMENT_HISTORY',
  )
  report.knownLegacyShapeCandidate = knownLegacy
  phase = 'create-canonical-through-0022'
  const canonical = await create('canonical'),
    folder = join(root, 'canonical-through-0022')
  await mkdir(folder)
  await mkdir(join(folder, 'meta'))
  const journal = await load(join(api, 'drizzle/meta/_journal.json'))
  assert.equal(journal.entries.length, 25, 'EXPECTED_JOURNAL_REQUIRED')
  const selectedJournal = { ...journal, entries: journal.entries.slice(0, 23) }
  await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify(selectedJournal), {
    flag: 'wx',
    mode: 0o600,
  })
  for (const entry of selectedJournal.entries) {
    assert.match(entry.tag, /^\d{4}_[a-z0-9_-]+$/)
    const source = join(api, 'drizzle', entry.tag + '.sql')
    await copyRecoveryPrivateFile(
      source,
      join(folder, entry.tag + '.sql'),
      await fileDigest(source, 1048576),
      1048576,
    )
  }
  const prefix = readMigrationFiles({ migrationsFolder: folder })
  assert.deepEqual(prefix, migrations.slice(0, 23), 'CANONICAL_PREFIX_COPY_CHANGED')
  await migration(canonical, folder)
  const clean = await client(canonical)
  const canonicalBefore = await snapshotDevelopment(clean, { detailed: true })
  await save('canonical-0022-digests', canonicalBefore)
  phase = 'synthetic-catalog-fault-check'
  await clean.unsafe(`CREATE TABLE public.dev_upgrade_probe(id integer);
    ALTER TABLE public.dev_upgrade_probe ADD CONSTRAINT dev_upgrade_probe_check CHECK(id > 0) NOT VALID;
    CREATE SEQUENCE public.dev_upgrade_probe_seq;
    CREATE FUNCTION public.dev_upgrade_probe_fn() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NEW; END$$;
    CREATE TRIGGER dev_upgrade_probe_trigger BEFORE INSERT ON public.dev_upgrade_probe FOR EACH ROW EXECUTE FUNCTION public.dev_upgrade_probe_fn()`)
  const initialProbe = await snapshotDevelopment(clean, { detailed: true })
  await clean.unsafe(`ALTER TABLE public.dev_upgrade_probe ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.dev_upgrade_probe DISABLE TRIGGER dev_upgrade_probe_trigger;
    ALTER TABLE public.dev_upgrade_probe VALIDATE CONSTRAINT dev_upgrade_probe_check;
    ALTER SEQUENCE public.dev_upgrade_probe_seq INCREMENT BY 2`)
  const changedProbe = await snapshotDevelopment(clean, { detailed: true })
  const faultComparison = compareDevelopmentSchema(changedProbe, initialProbe)
  for (const group of [
    'detail.relations',
    'detail.triggers',
    'detail.constraints',
    'detail.sequences',
  ])
    assert.ok(faultComparison.differences[group], 'SYNTHETIC_CATALOG_DRIFT_NOT_DETECTED')
  await clean.unsafe(`DROP TABLE public.dev_upgrade_probe;
    DROP FUNCTION public.dev_upgrade_probe_fn(); DROP SEQUENCE public.dev_upgrade_probe_seq`)
  assert.deepEqual(
    await snapshotDevelopment(clean, { detailed: true }),
    canonicalBefore,
    'PROBE_CLEANUP_CHANGED_BASELINE',
  )
  report.checks.syntheticSecurityTriggerConstraintAndSequenceDriftDetected = true
  const rawComparison = compareDevelopmentSchema(before, canonicalBefore)
  await save('canonical-0022-difference', rawComparison)
  report.canonicalDifferenceGroups = Object.keys(rawComparison.differences)
  if (knownLegacy) {
    assert.equal(
      before.tables.find((t) => t.table === 'public.account_activation_tokens')?.count,
      0,
      'LEGACY_TOKEN_TABLE_MUST_BE_EMPTY',
    )
    // Model only the observed extra table. This does not reconstruct or execute the missing historical SQL.
    for (const statement of legacyShapeSql) await clean.unsafe(statement)
  }
  const expectedBefore = await snapshotDevelopment(clean, { detailed: true })
  const comparison = compareDevelopmentSchema(before, expectedBefore)
  await save('expected-legacy-0022-digests', expectedBefore)
  await save('verified-legacy-0022-difference', comparison)
  phase = 'verify-canonical-legacy-schema-equivalence'
  assert.ok(comparison.matches, 'DEVELOPMENT_SCHEMA_DRIFT')
  report.checks.schemaMatchesCanonicalPlusExactLegacyShape = true
  report.status = 'AUDIT_PASS'
  if (options.rehearse) {
    const catalogs = {}
    for (const name of ['permissions', 'role_permissions'])
      catalogs[name] = (
        await restored.unsafe(
          'SELECT to_jsonb(t) AS value FROM public."' + name + '" t ORDER BY to_jsonb(t)::text',
        )
      ).map((r) => r.value)
    phase = 'migrate-private-copies-to-0024'
    await migration(canonical, join(api, 'drizzle'))
    await migration(target, join(api, 'drizzle'))
    const upgraded = await client(target),
      expected = await client(canonical)
    const current = await snapshotDevelopment(upgraded, { detailed: true })
    await save('upgraded-digests', current)
    const upgradedHistory = await readHistory(upgraded)
    if (knownLegacy) assertLegacyLedgerPreserved(history, upgradedHistory, migrations)
    else {
      assert.ok(
        inspectMigrationHistory(upgradedHistory, migrations).canonical &&
          upgradedHistory.length === migrations.length,
        'UPGRADE_LEDGER_CHANGED',
      )
      assert.deepEqual(
        upgradedHistory.slice(0, history.length),
        history,
        'UPGRADE_OLD_LEDGER_CHANGED',
      )
    }
    report.checks.originalLedgerRowsRetained = true
    const schema = compareDevelopmentSchema(
      current,
      await snapshotDevelopment(expected, { detailed: true }),
    )
    await save('upgraded-schema-difference', schema)
    assert.ok(schema.matches, 'UPGRADED_SCHEMA_DRIFT')
    report.checks.upgradedSchemaMatchesCanonicalPlusExactLegacyShape = true
    phase = 'verify-existing-data-and-sequences'
    const catalogAdditions = {}
    for (const old of before.tables) {
      if (old.table === 'drizzle.__drizzle_migrations') continue
      const after = current.tables.find((t) => t.table === old.table)
      assert.ok(after, 'UPGRADE_OLD_TABLE_MISSING')
      if (['public.permissions', 'public.role_permissions'].includes(old.table)) {
        const name = old.table.split('.')[1]
        const oldRows = await restored.unsafe(
          'SELECT to_jsonb(t) AS value FROM public."' + name + '" t ORDER BY to_jsonb(t)::text',
        )
        const originals = catalogs[name]
        const [permission] = await upgraded`SELECT id FROM permissions WHERE code='document.retry'`
        const [role] = await upgraded`SELECT id FROM roles WHERE code='SYSTEM_ADMIN'`
        catalogAdditions[name] = assertPreservedCatalogRows(
          originals,
          oldRows.map((r) => r.value),
          (r) =>
            name === 'permissions'
              ? r.code === 'document.retry'
              : r.permission_id === permission?.id && r.role_id === role?.id,
        )
      } else assert.deepEqual(after, old, 'UPGRADE_EXISTING_ROWS_CHANGED')
    }
    for (const name of [
      'submission_document_sets',
      'submission_documents',
      'submission_document_jobs',
      'submission_document_retries',
    ])
      assert.equal(
        current.tables.find((t) => t.table === 'public.' + name)?.count,
        0,
        'NEW_REGISTRY_NOT_EMPTY',
      )
    assertUpgradeSequences(before.sequences, current.sequences)
    report.catalogAdditions = catalogAdditions
    report.permissionSequence = {
      before: before.sequences.find((s) => s.name === 'public.permissions_id_seq'),
      after: current.sequences.find((s) => s.name === 'public.permissions_id_seq'),
    }
    report.tablesBefore = before.tables.length
    report.tablesAfter = current.tables.length
    report.ledgerRowsBefore = history.length
    report.ledgerRowsAfter = upgradedHistory.length
    report.checks.existingRowsAndApplicationSequencesPreserved = true
    phase = 'verify-rollback-after-upgrade'
    await owned(target)
    await operation(['rm', '--force', target.id])
    clones.splice(clones.indexOf(target), 1)
    const rollback = await create('rollback')
    await operation(
      [
        'exec',
        '-i',
        rollback.id,
        'pg_restore',
        '-U',
        'postgres',
        '-d',
        rollback.database,
        '--exit-on-error',
        '--no-owner',
        '--no-privileges',
      ],
      {},
      privateDump,
    )
    const rolledBack = await client(rollback)
    assert.deepEqual(
      await snapshotDevelopment(rolledBack, { detailed: true }),
      before,
      'ROLLBACK_BASELINE_CHANGED',
    )
    assert.deepEqual(await readHistory(rolledBack), history, 'ROLLBACK_LEDGER_CHANGED')
    report.checks.rollbackAfterPrivateUpgradeMatchesOriginalBackup = true
    report.status = 'PRIVATE_UPGRADE_PASS'
  }
  phase = 'final-offline-source-and-backup-check'
  await sourceOffline()
  assert.deepEqual(
    await fileDigest(dump, 536870912),
    preservation.logical,
    'PRESERVED_DUMP_CHANGED',
  )
  assert.deepEqual(
    await fileDigest(privateDump, 536870912),
    preservation.logical,
    'PRIVATE_DUMP_CHANGED',
  )
  report.checks.sourceRemainsOfflineAndBackupUnchanged = true
} catch (error) {
  report.status = 'FAILED'
  report.phase = phase
  const code = error.message.split('\n')[0]
  report.code = /^[A-Z0-9_]+$/.test(code) ? code : 'DEVELOPMENT_AUDIT_OPERATION_FAILED'
  process.exitCode = 1
} finally {
  for (const sql of clients) await sql.end({ timeout: 5 }).catch(() => {})
  report.cleanup = true
  for (const clone of clones.reverse()) {
    try {
      await owned(clone)
      await operation(['rm', '--force', clone.id])
    } catch {
      report.cleanup = false
      report.status = 'FAILED'
      report.code = 'OWNED_CLONE_CLEANUP_FAILED'
      process.exitCode = 1
    }
  }
  try {
    await save('report', report)
  } catch {
    process.exitCode = 1
  }
  console.log(
    JSON.stringify({
      event: 'DEVELOPMENT_UPGRADE_AUDIT_RESULT',
      runId,
      status: report.status,
      phase: report.phase,
      code: report.code,
      checks: report.checks,
      cleanup: report.cleanup,
    }),
  )
}
