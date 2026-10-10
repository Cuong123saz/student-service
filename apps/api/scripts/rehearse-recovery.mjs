import assert from 'node:assert/strict'
import { fork, spawn } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import {
  exportRecoveryBundle,
  inspectRecoveryArchive,
  validateRecoveryArchiveDestination,
} from './recovery-archive.mjs'
import { resolve, join } from 'node:path'
import { pipeline, finished } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import {
  encryptRecoveryBundle,
  decryptRecoveryBundle,
  verifyEncryptedRecoveryBundle,
  validateEncryptedArchiveDestination,
} from './encrypted-recovery.mjs'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { auditEvidence, readEvidenceReferences } from './evidence-integrity.mjs'
import {
  parseRehearsalOptions,
  assertOwnedContainer,
  assertDrillDatabase,
  assertEmptyTarget,
  createRecoveryBundle,
  verifyRecoveryBundle,
  restoreRecoveryFiles,
  normalizeRecoveryDefinition,
  sourceDatabase,
  targetDatabase,
} from './recovery-bundle.mjs'
import {
  seedRecoveryFixture,
  recoveryHttp,
  createRecoveryDossier,
  verifyRecoveryHttp,
  newBytes,
  origin,
} from './recovery-fixture.mjs'

const repo = fileURLToPath(new URL('../../../', import.meta.url))
const api = resolve(repo, 'apps/api'),
  runId = randomUUID()
let options, archiveRoot
try {
  options = parseRehearsalOptions(process.argv.slice(2), process.env)
  archiveRoot = options.archiveRoot || resolve(tmpdir(), 'student-service-fake-archive-' + runId)
  if (options.encryptionKey)
    await validateEncryptedArchiveDestination({
      archiveRoot,
      keyPath: options.encryptionKey,
      projectRoot: repo,
    })
  else await validateRecoveryArchiveDestination({ archiveRoot, projectRoot: repo })
} catch (error) {
  console.error(/^[A-Z_]+$/.test(error.message) ? error.message : 'ARCHIVE_DESTINATION_UNAVAILABLE')
  process.exit(1)
}
const runRoot = resolve(repo, 'run/recovery-drills', runId)
const sourceRoot = join(runRoot, 'source-files'),
  restoredRoot = join(runRoot, 'restored-files'),
  bundleRoot = join(runRoot, 'bundle')
const report = {
  version: 1,
  fakeDataOnly: true,
  status: 'RUNNING',
  runId,
  startedAt: new Date().toISOString(),
  node: process.version,
  phases: [],
  http: { requests: 0, statuses: {} },
  checks: {},
  cleanup: false,
}
let containerId,
  source,
  target,
  server,
  phase = 'initialization'
const password = randomBytes(24).toString('hex'),
  secret = randomBytes(48).toString('hex')
const started = performance.now()
await mkdir(resolve(repo, 'run/recovery-drills'), { recursive: true })
await mkdir(runRoot)
await writeFile(join(runRoot, 'fake.env'), '# Empty by design: do not read project .env files.\n', {
  flag: 'wx',
})
const commandLog = createWriteStream(join(runRoot, 'commands.log'), { flags: 'wx' })

async function docker(args, { outputFile, inputFile, extraEnv = {} } = {}) {
  const child = spawn('docker', args, {
    shell: false,
    windowsHide: true,
    env: { ...process.env, ...extraEnv },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const closed = new Promise((res, rej) => {
    child.once('error', rej)
    child.once('close', (code) => res(code))
  })
  const timer = setTimeout(() => child.kill(), 60000)
  let output = ''
  child.stderr.on('data', (chunk) => commandLog.write(chunk))
  const tasks = [closed]
  if (outputFile) tasks.push(pipeline(child.stdout, createWriteStream(outputFile, { flags: 'wx' })))
  else
    child.stdout.on('data', (chunk) => {
      if (output.length < 1048576) output += chunk.toString()
    })
  if (inputFile) tasks.push(pipeline(createReadStream(inputFile), child.stdin))
  else child.stdin.end()
  const results = await Promise.allSettled(tasks)
  clearTimeout(timer)
  if (results.some((result) => result.status === 'rejected') || results[0].value !== 0)
    throw new Error('DOCKER_COMMAND_FAILED')
  return output.trim()
}
async function owned() {
  const [info] = JSON.parse(await docker(['inspect', containerId]))
  assertOwnedContainer(info, runId, containerId)
  return info
}
async function launchPostgres() {
  containerId = await docker(
    [
      'run',
      '--detach',
      '--pull=never',
      '--name',
      'student-service-recovery-' + runId,
      '--label',
      'student-service.recovery-id=' + runId,
      '--tmpfs',
      '/var/lib/postgresql/data:rw,size=536870912',
      '--publish',
      '127.0.0.1::5432',
      '--env',
      'POSTGRES_PASSWORD',
      'postgres:17-alpine',
    ],
    { extraEnv: { POSTGRES_PASSWORD: password } },
  )
  const info = await owned(),
    ports = info.NetworkSettings.Ports['5432/tcp']
  assert.equal(ports.length, 1)
  assert.equal(ports[0].HostIp, '127.0.0.1')
  const port = ports[0].HostPort
  assert.ok(!['5433', '5434'].includes(port))
  let ready = false
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      await docker([
        'exec',
        containerId,
        'pg_isready',
        '-h',
        '127.0.0.1',
        '-U',
        'postgres',
        '-d',
        'postgres',
      ])
      ready = true
      break
    } catch {
      await new Promise((res) => setTimeout(res, 500))
    }
  }
  assert.equal(ready, true, 'Private PostgreSQL must become ready')
  return { info, port }
}

function phaseStart(name) {
  phase = name
  console.log('RECOVERY_PHASE ' + name)
  return performance.now()
}
function phaseEnd(name, start) {
  report.phases.push({ name, ms: performance.now() - start })
}
async function startServer(databaseUrl, root, name) {
  assertDrillDatabase(databaseUrl, name === 'source' ? sourceDatabase : targetDatabase)
  const inherited = Object.fromEntries(
    ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP']
      .filter((key) => process.env[key])
      .map((key) => [key, process.env[key]]),
  )
  const env = {
    ...inherited,
    DATABASE_URL: databaseUrl,
    APP_ENV: 'test',
    SUBMISSION_STORAGE_ROOT: root,
    RECOVERY_DRILL_ID: runId,
    DOTENV_CONFIG_PATH: join(runRoot, 'fake.env'),
    JWT_SECRET: secret,
    CORS_ORIGIN: origin,
    WEB_BASE_URL: origin,
    API_HOST: '127.0.0.1',
    API_PORT: '1',
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: '1',
    SMTP_SECURE: 'false',
    MAIL_FROM: 'fake-recovery@example.invalid',
  }
  const child = fork(resolve(api, 'scripts/recovery-api.mjs'), [], {
    cwd: api,
    env,
    execArgv: [],
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  const log = createWriteStream(join(runRoot, name + '-api.log'), { flags: 'wx' })
  child.stdout.pipe(log, { end: false })
  child.stderr.pipe(log, { end: false })
  const closed = new Promise((res) => child.once('close', (code) => res(code)))
  const running = { child, closed, log, stopped: false }
  server = running // Cleanup also owns a child that fails during startup.
  const address = await new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error('API_START_TIMEOUT')), 20000)
    child.once('message', (message) => {
      clearTimeout(timer)
      res(message.address)
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      rej(error)
    })
    child.once('exit', () => {
      clearTimeout(timer)
      rej(new Error('API_START_FAILED'))
    })
  })
  assert.match(address, /^http:\/\/127\.0\.0\.1:\d+$/)
  return recoveryHttp(address, secret, report.http)
}
async function stopServer() {
  if (!server || server.stopped) return
  server.stopped = true
  if (server.child.connected) server.child.send('stop')
  const timer = setTimeout(() => server.child.kill(), 15000)
  const code = await server.closed
  clearTimeout(timer)
  server.log.end()
  await finished(server.log)
  server = undefined
  assert.equal(code, 0, 'Private rehearsal API must stop cleanly')
}
async function snapshot(client) {
  return client.begin('isolation level repeatable read read only', async (sql) => {
    const tables = await sql`SELECT schemaname,tablename FROM pg_tables
      WHERE schemaname IN ('public','drizzle') ORDER BY schemaname,tablename`
    const rows = []
    for (const table of tables) {
      assert.match(table.schemaname, /^[a-z_]+$/)
      assert.match(table.tablename, /^[a-z0-9_]+$/)
      const digest = createHash('sha256')
      let count = 0
      for await (const batch of sql
        .unsafe(
          `SELECT to_jsonb(t)::text AS row FROM "${table.schemaname}"."${table.tablename}" t ORDER BY to_jsonb(t)::text`,
        )
        .cursor(256))
        for (const row of batch) {
          digest.update(row.row + '\n')
          count++
        }
      rows.push({
        table: table.schemaname + '.' + table.tablename,
        count,
        sha256: digest.digest('hex'),
      })
    }
    const sequences = []
    for (const seq of await sql`SELECT schemaname,sequencename FROM pg_sequences WHERE schemaname IN ('public','drizzle') ORDER BY schemaname,sequencename`) {
      assert.match(seq.schemaname, /^[a-z_]+$/)
      assert.match(seq.sequencename, /^[a-z0-9_]+$/)
      const [state] = await sql.unsafe(
        `SELECT last_value::text,is_called FROM "${seq.schemaname}"."${seq.sequencename}"`,
      )
      sequences.push({ name: seq.schemaname + '.' + seq.sequencename, ...state })
    }
    const indexes =
      await sql`SELECT schemaname,indexname,indexdef FROM pg_indexes WHERE schemaname IN ('public','drizzle') ORDER BY schemaname,indexname`
    const triggers = await sql`SELECT n.nspname,t.tgname,pg_get_triggerdef(t.oid) AS definition
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname='public' ORDER BY t.tgname,definition`
    const constraints =
      await sql`SELECT n.nspname,c.conname,pg_get_constraintdef(c.oid) AS definition
      FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
      WHERE n.nspname IN ('public','drizzle') ORDER BY n.nspname,c.conname,definition`
    const extensions = await sql`SELECT extname,extversion FROM pg_extension ORDER BY extname`
    return {
      tables: rows,
      sequences,
      indexes: indexes.map((row) => ({
        ...row,
        indexdef: normalizeRecoveryDefinition(row.indexdef),
      })),
      triggers: [...triggers],
      constraints: constraints.map((row) => ({
        ...row,
        definition: normalizeRecoveryDefinition(row.definition),
      })),
      extensions: [...extensions],
    }
  })
}
async function audit(client, root) {
  return client.begin('isolation level repeatable read read only', async (tx) =>
    auditEvidence({ root, references: readEvidenceReferences(tx) }),
  )
}
try {
  let tick = phaseStart('create-private-postgres')
  const { info, port } = await launchPostgres()
  await docker([
    'exec',
    containerId,
    'createdb',
    '-U',
    'postgres',
    '--template=template0',
    sourceDatabase,
  ])
  const sourceUrl = `postgres://postgres:${password}@127.0.0.1:${port}/${sourceDatabase}`
  let targetUrl = `postgres://postgres:${password}@127.0.0.1:${port}/${targetDatabase}`
  assertDrillDatabase(sourceUrl, sourceDatabase)
  assertDrillDatabase(targetUrl, targetDatabase)
  const connect = (url) => postgres(url, { max: 1, connect_timeout: 5, onnotice: () => {} })
  source = connect(sourceUrl)
  const [version] = await source`SHOW server_version`
  report.postgres = version.server_version
  report.imageId = info.Image
  phaseEnd('create-private-postgres', tick)
  tick = phaseStart('migrate-and-create-fake-dossier')
  await migrate(drizzle(source), { migrationsFolder: resolve(api, 'drizzle') })
  // Drizzle changes JSON serializers on its client; use a fresh raw client for the fixture.
  await source.end()
  source = connect(sourceUrl)
  const fixture = await seedRecoveryFixture(source)
  let http = await startServer(sourceUrl, sourceRoot, 'source')
  const state = await createRecoveryDossier(http, fixture)
  await stopServer()
  await source.unsafe(`ALTER DATABASE ${sourceDatabase} SET default_transaction_read_only=on`)
  await source.end()
  source = connect(sourceUrl)
  async function assertQuiescent() {
    const [mode] = await source`SHOW default_transaction_read_only`
    assert.equal(mode.default_transaction_read_only, 'on')
    const [sessions] = await source`SELECT count(*)::int AS others FROM pg_stat_activity
      WHERE datname=current_database() AND pid<>pg_backend_pid()`
    assert.equal(sessions.others, 0, 'Controlled source must have no other sessions')
  }
  await assertQuiescent()
  const before = await snapshot(source),
    sourceAudit = await audit(source, sourceRoot)
  assert.equal(sourceAudit.status, 'OK')
  assert.equal(sourceAudit.counts.removedReferences, 1)
  assert.equal(sourceAudit.counts.historicalReferences, 2)
  const [dataset] = await source`SELECT
    (SELECT count(*)::int FROM submissions) AS submissions,
    (SELECT count(*)::int FROM submission_rounds) AS rounds,
    (SELECT count(*)::int FROM submission_files) AS files,
    (SELECT count(*)::int FROM submission_files WHERE removed_at IS NOT NULL) AS "removedFiles",
    (SELECT count(*)::int FROM submission_events) AS events`
  assert.deepEqual(
    { ...dataset },
    { submissions: 1, rounds: 2, files: 2, removedFiles: 1, events: 4 },
  )
  report.dataset = { ...dataset }
  report.checks.sourceAudit = sourceAudit.counts
  phaseEnd('migrate-and-create-fake-dossier', tick)
  tick = phaseStart('backup-database-and-evidence')
  const manifest = await createRecoveryBundle({
    bundleRoot,
    sourceRoot,
    runId,
    assertQuiescent,
    dump: (path) =>
      docker(
        [
          'exec',
          containerId,
          'pg_dump',
          '-U',
          'postgres',
          '--format=custom',
          '--no-privileges',
          '--dbname',
          sourceDatabase,
        ],
        { outputFile: path },
      ),
  })
  assert.deepEqual(await snapshot(source), before)
  report.bundle = {
    dumpBytes: manifest.database.size,
    files: manifest.files.length,
    fileBytes: manifest.files.reduce((n, f) => n + f.size, 0),
  }
  report.checks.sourceUnchanged = true
  report.checks.sourceStoppedAndReadOnly = true
  phaseEnd('backup-database-and-evidence', tick)
  tick = phaseStart('export-to-separate-fake-archive')
  let archivedBundleRoot, encryptedPackageRoot
  if (options.encryptionKey) {
    const exported = await encryptRecoveryBundle({
      bundleRoot,
      archiveRoot,
      keyPath: options.encryptionKey,
      projectRoot: repo,
    })
    encryptedPackageRoot = exported.bundleRoot
    await verifyEncryptedRecoveryBundle({
      packageRoot: encryptedPackageRoot,
      keyPath: options.encryptionKey,
      projectRoot: repo,
    })
    report.archive = {
      root: archiveRoot,
      selection: 'EXPLICIT',
      encrypted: true,
      bundleRoot: encryptedPackageRoot,
      keyId: exported.keyId,
      retentionSupported: false,
    }
    report.checks.encryptedPackageAuthenticated = true
  } else {
    const exported = await exportRecoveryBundle({ bundleRoot, archiveRoot, projectRoot: repo })
    archivedBundleRoot = exported.bundleRoot
    const archiveInspection = await inspectRecoveryArchive({
      archiveRoot,
      projectRoot: repo,
      policy: { keepLatest: 3, minAgeDays: 30 },
    })
    assert.equal(archiveInspection.status, 'OK')
    assert.ok(archiveInspection.verified >= 1)
    assert.equal(archiveInspection.entries.find((entry) => entry.runId === runId)?.proposal, 'KEEP')
    report.archive = {
      root: archiveRoot,
      selection: options.archiveRoot ? 'EXPLICIT' : 'TEMPORARY',
      encrypted: false,
      bundleRoot: archivedBundleRoot,
      inspection: archiveInspection,
    }
    await verifyRecoveryBundle(archivedBundleRoot)
  }
  report.checks.exportedCopyVerified = true
  phaseEnd('export-to-separate-fake-archive', tick)
  tick = phaseStart('restore-to-empty-private-target')
  // Simulate losing the fake source cluster; restore only from the saved bundle.
  await source.end({ timeout: 5 })
  source = undefined
  const sourceContainerId = containerId
  await owned()
  await docker(['rm', '--force', containerId])
  containerId = undefined
  const restoredPostgres = await launchPostgres()
  assert.notEqual(containerId, sourceContainerId)
  assert.equal(restoredPostgres.info.Image, report.imageId)
  targetUrl = `postgres://postgres:${password}@127.0.0.1:${restoredPostgres.port}/${targetDatabase}`
  assertDrillDatabase(targetUrl, targetDatabase)
  report.checks.sourceClusterRemovedBeforeRestore = true
  report.checks.independentPostgresCluster = true
  if (encryptedPackageRoot) {
    archivedBundleRoot = join(runRoot, 'decrypted-bundle')
    await decryptRecoveryBundle({
      packageRoot: encryptedPackageRoot,
      keyPath: options.encryptionKey,
      targetRoot: archivedBundleRoot,
      projectRoot: repo,
    })
    report.checks.decryptedAfterSourceClusterRemoved = true
  }
  await docker([
    'exec',
    containerId,
    'createdb',
    '-U',
    'postgres',
    '--template=template0',
    targetDatabase,
  ])
  target = connect(targetUrl)
  await assertEmptyTarget(target)
  await restoreRecoveryFiles({ bundleRoot: archivedBundleRoot, targetRoot: restoredRoot })
  await owned()
  await docker(
    [
      'exec',
      '--interactive',
      containerId,
      'pg_restore',
      '-U',
      'postgres',
      '--dbname',
      targetDatabase,
      '--no-owner',
      '--no-privileges',
      '--single-transaction',
      '--exit-on-error',
    ],
    { inputFile: join(archivedBundleRoot, 'database.dump') },
  )
  report.checks.restoredFromSeparateArchive = true
  phaseEnd('restore-to-empty-private-target', tick)
  tick = phaseStart('verify-data-schema-files-and-permissions')
  const after = await snapshot(target)
  await writeFile(join(runRoot, 'source-snapshot.json'), JSON.stringify(before, null, 2))
  await writeFile(join(runRoot, 'restored-snapshot.json'), JSON.stringify(after, null, 2))
  assert.deepEqual(after, before)
  await assert.rejects(assertEmptyTarget(target), /RESTORE_TARGET_NOT_EMPTY/)
  assert.deepEqual(await snapshot(target), before)
  report.checks.existingTargetRefusedWithoutChanges = true
  await assert.rejects(
    target`UPDATE submission_rounds SET source='MIGRATION' WHERE submission_id=${state.id}`,
    (error) => error.code === '23514',
  )
  await assert.rejects(
    target`DELETE FROM submission_events WHERE submission_id=${state.id}`,
    (error) => error.code === '23514',
  )
  assert.deepEqual(await snapshot(target), before)
  report.checks.immutableHistoryStillEnforced = true
  report.checks.tablesAndSequencesEqual = true
  report.checks.indexesConstraintsTriggersExtensionsEqual = true
  report.verifiedTables = before.tables.length
  report.verifiedSequences = before.sequences.length
  const restoredAudit = await audit(target, restoredRoot)
  assert.equal(restoredAudit.status, 'OK')
  assert.deepEqual(restoredAudit.counts, sourceAudit.counts)
  report.checks.restoredAudit = restoredAudit.counts
  http = await startServer(targetUrl, restoredRoot, 'restored')
  await verifyRecoveryHttp(http, fixture, state)
  report.checks.viewsHistoryNotificationsAndAccess = true
  const decisionBody = {
    expectedRevision: state.reviewView.revision,
    action: 'APPROVE',
    note: 'Quyết định giả định sau phục hồi',
  }
  const approved = await http(fixture.reviewer, `/review-submissions/${state.id}/resolve`, {
    method: 'POST',
    body: decisionBody,
  })
  assert.equal(approved.status, 'APPROVED')
  assert.deepEqual(
    await http(fixture.reviewer, `/review-submissions/${state.id}/resolve`, {
      method: 'POST',
      body: decisionBody,
    }),
    approved,
  )
  const [decision] =
    await target`SELECT count(*)::int AS count FROM submission_events WHERE submission_id=${state.id} AND action='APPROVED'`
  assert.equal(decision.count, 1)
  const [decisionAudit] = await target`SELECT count(*)::int AS count FROM audit_logs
    WHERE resource_id=${state.id} AND action='SUBMISSION_APPROVED'`
  const [decisionNotification] =
    await target`SELECT count(*)::int AS count FROM personal_notifications n
    JOIN submission_events e ON e.id=n.event_id
    WHERE e.submission_id=${state.id} AND e.action='APPROVED' AND n.recipient_user_id=${fixture.owner.id}`
  assert.equal(decisionAudit.count, 1)
  assert.equal(decisionNotification.count, 1)
  report.checks.postRestoreWriteAndIdempotency = true
  const [previousService] = await target`SELECT max(id) AS id FROM services`
  const [newService] =
    await target`INSERT INTO services(code,name,description,processing_days,status)
    VALUES ('DRILL_AFTER_RESTORE','Thủ tục giả sau phục hồi','Dữ liệu giả',1,'ACTIVE') RETURNING id`
  assert.ok(newService.id > previousService.id)
  report.checks.sequenceNextInsertWorks = true
  await target`DELETE FROM user_role_scopes WHERE user_id=${fixture.reviewer.id}`
  await http(fixture.reviewer, `/review-submissions/${state.id}/files/${state.newFileId}`, {
    expected: 403,
  })
  report.checks.currentPermissionRevocation = true
  const [file] =
    await target`SELECT storage_key AS key FROM submission_files WHERE id=${state.newFileId}`
  await writeFile(join(restoredRoot, file.key), Buffer.alloc(newBytes.length, 65))
  await http(fixture.owner, `/submissions/${state.id}/files/${state.newFileId}`, { expected: 503 })
  assert.equal((await audit(target, restoredRoot)).issuesByCode.HASH_MISMATCH, 1)
  await writeFile(join(restoredRoot, file.key), newBytes)
  assert.equal((await audit(target, restoredRoot)).status, 'OK')
  report.checks.injectedByteCorruptionDetected = true
  await stopServer()
  report.checks.bundleStillIntact = Boolean(await verifyRecoveryBundle(bundleRoot))
  report.checks.archivedBundleStillIntact = encryptedPackageRoot
    ? Boolean(
        await verifyEncryptedRecoveryBundle({
          packageRoot: encryptedPackageRoot,
          keyPath: options.encryptionKey,
          projectRoot: repo,
        }),
      )
    : Boolean(await verifyRecoveryBundle(archivedBundleRoot))
  phaseEnd('verify-data-schema-files-and-permissions', tick)
  report.status = 'VERIFIED_PENDING_CLEANUP'
} catch (error) {
  report.status = 'FAILED'
  report.failure = {
    phase,
    code: error.code || (/^[A-Z_]+$/.test(error.message) ? error.message : error.name),
  }
  report.failure.trace = String(error.stack || '')
    .split('\n')
    .filter((line) => line.trim().startsWith('at '))
    .slice(0, 8)
  console.error('RECOVERY_FAILED ' + JSON.stringify(report.failure))
  process.exitCode = 1
} finally {
  phase = 'cleanup'
  const cleanupResults = await Promise.allSettled([
    stopServer(),
    source?.end({ timeout: 5 }),
    target?.end({ timeout: 5 }),
  ])
  try {
    if (!containerId) {
      try {
        const [candidate] = JSON.parse(
          await docker(['inspect', 'student-service-recovery-' + runId]),
        )
        assertOwnedContainer(candidate, runId, candidate.Id)
        containerId = candidate.Id
      } catch {
        /* No owned container was successfully created. */
      }
    }
    if (containerId) {
      await owned()
      await docker(['rm', '--force', containerId])
    }
    if (cleanupResults.some((result) => result.status === 'rejected'))
      throw new Error('API_OR_CONNECTION_CLEANUP_FAILED')
    report.cleanup = true
  } catch (error) {
    report.status = 'FAILED'
    report.cleanup = false
    report.cleanupError = error.code || error.name
    console.error('RECOVERY_CLEANUP_FAILED')
    process.exitCode = 1
  }
  commandLog.end()
  await finished(commandLog)
  report.totalMs = performance.now() - started
  report.finishedAt = new Date().toISOString()
  if (report.status === 'VERIFIED_PENDING_CLEANUP' && report.cleanup) report.status = 'PASS'
  await writeFile(join(runRoot, 'report.json'), JSON.stringify(report, null, 2) + '\n', {
    flag: 'wx',
  })
  console.log(
    'RECOVERY_RESULT ' +
      JSON.stringify({
        status: report.status,
        reportPath: join(runRoot, 'report.json'),
        totalMs: report.totalMs,
      }),
  )
}
