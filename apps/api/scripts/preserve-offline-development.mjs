// Preservation of an existing offline development database; never starts or writes the source.
// Existing data is unclassified, not silently labeled synthetic. Tests use fake contract fixtures.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID, randomBytes, createHash } from 'node:crypto'
import { createWriteStream, createReadStream } from 'node:fs'
import { mkdir, readFile, readdir, writeFile, open } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Transform, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { setTimeout as pause } from 'node:timers/promises'
import postgres from 'postgres'
import { parse } from 'dotenv'
import {
  developmentVolume,
  assertOfflineDevelopmentInvocation,
  assertOfflineDevelopmentSource,
  assertDevelopmentVolumeQuiescent,
  assertPreservationContainer,
} from './offline-development.contract.mjs'
import {
  assertRecoveryDirectory,
  fileDigest,
  normalizeRecoveryDefinition,
} from './recovery-bundle.mjs'
import { copyRecoveryPrivateFile } from './recovery-private-file.mjs'
import { auditEvidence, readEvidenceReferences } from './evidence-integrity.mjs'
assertOfflineDevelopmentInvocation(process.argv.slice(2), process.env)
assert.equal(process.versions.node.split('.')[0], '22', 'NODE_22_REQUIRED')
const project = fileURLToPath(new URL('../../../', import.meta.url)),
  api = join(project, 'apps/api')
const runId = randomUUID(),
  root = join(project, 'run/offline-development', runId)
const clones = [],
  clients = []
let original,
  report,
  phase = 'preflight'
function command(args, env = {}) {
  const child = spawn('docker', args, {
    windowsHide: true,
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  child.stderr.resume()
  const timer = setTimeout(() => child.kill(), 180000)
  const closed = new Promise((res, rej) => {
    child.once('error', () => rej(new Error('DOCKER_UNAVAILABLE')))
    child.once('close', (code) => (code === 0 ? res() : rej(new Error('DOCKER_OPERATION_FAILED'))))
  }).finally(() => clearTimeout(timer))
  return { child, closed }
}
async function docker(args, env) {
  const { child, closed } = command(args, env)
  child.stdin.end()
  let text = '',
    overflow = false
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (part) => {
    if (text.length + part.length <= 1048576) text += part
    else overflow = true
  })
  await closed
  assert.ok(!overflow, 'DOCKER_RESPONSE_LIMIT')
  return text.trim()
}
async function streamDocker(args, destination, maximum, input) {
  const { child, closed } = command(args)
  let size = 0
  const hash = createHash('sha256')
  const bounded = new Transform({
    transform(part, encoding, callback) {
      size += part.length
      if (size > maximum) return callback(new Error('ARCHIVE_SIZE_LIMIT'))
      hash.update(part)
      callback(null, part)
    },
  })
  const output = destination
    ? createWriteStream(destination, { flags: 'wx', mode: 0o600 })
    : new Writable({
        write(part, encoding, callback) {
          callback()
        },
      })
  const incoming = input
    ? pipeline(createReadStream(input), child.stdin)
    : (child.stdin.end(), Promise.resolve())
  try {
    await Promise.all([pipeline(child.stdout, bounded, output), incoming, closed])
  } catch (error) {
    child.kill()
    throw error
  }
  const result = { size, sha256: hash.digest('hex') }
  if (destination) {
    const file = await open(destination, 'r+')
    try {
      await file.sync()
    } finally {
      await file.close()
    }
    assert.deepEqual(await fileDigest(destination, maximum), result)
  }
  return result
}
async function inspect(id) {
  return JSON.parse(await docker(['inspect', id]))[0]
}
async function sourceOffline() {
  const info = await inspect('student-service-postgres')
  assertOfflineDevelopmentSource(info, original?.Id)
  const ids = (await docker(['ps', '-aq', '--filter', 'volume=' + developmentVolume]))
    .split(/\s+/)
    .filter(Boolean)
  const infos = ids.length ? JSON.parse(await docker(['inspect', ...ids])) : []
  assertDevelopmentVolumeQuiescent(infos)
  return info
}
async function owned(clone) {
  const info = await inspect(clone.id)
  assertPreservationContainer(info, runId, clone.id, clone.kind, original.Image)
  return info
}
async function create(kind, args, extraEnv) {
  const id = await docker(
    [
      'create',
      '--name',
      'student-service-dev-preserve-' + runId + '-' + kind,
      '--label',
      'student-service.development-preservation-id=' + runId,
      ...args,
    ],
    extraEnv,
  )
  const clone = { kind, id }
  clones.push(clone)
  await owned(clone)
  return clone
}
async function ready(clone, database) {
  for (let i = 0; i < 80; i++) {
    try {
      await docker([
        'exec',
        clone.id,
        'pg_isready',
        '-h',
        '127.0.0.1',
        '-U',
        'postgres',
        '-d',
        database,
      ])
      return
    } catch {
      assert.equal((await owned(clone)).State.Running, true, 'CLONE_EXITED')
      await pause(250)
    }
  }
  throw new Error('CLONE_START_TIMEOUT')
}
async function client(clone, database, password) {
  const info = await owned(clone),
    ports = info.NetworkSettings.Ports['5432/tcp']
  assert.ok(
    ports?.length === 1 &&
      ports[0].HostIp === '127.0.0.1' &&
      !['5433', '5434'].includes(ports[0].HostPort),
    'PRIVATE_CLONE_PORT_REQUIRED',
  )
  const url = new URL('postgres://127.0.0.1:' + ports[0].HostPort + '/' + database)
  url.username = 'postgres'
  url.password = password
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
async function inventory(path, pattern, maximum, missingAllowed = false) {
  try {
    await assertRecoveryDirectory(path)
  } catch (error) {
    if (missingAllowed && error.code === 'ENOENT') return []
    throw error
  }
  const entries = (await readdir(path)).sort()
  assert.ok(
    entries.length <= 5000 && entries.every((name) => pattern.test(name)),
    'UNEXPECTED_FILE_LAYOUT',
  )
  const result = []
  for (const key of entries) result.push({ key, ...(await fileDigest(join(path, key), maximum)) })
  return result
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
    const columns = await sql`SELECT n.nspname,c.relname,a.attnum,a.attname,
      format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull,a.attidentity,a.attgenerated,
      pg_get_expr(d.adbin,d.adrelid) AS default_expression
      FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE n.nspname IN ('public','drizzle') AND c.relkind IN ('r','p','v','m') AND a.attnum>0 AND NOT a.attisdropped
      ORDER BY n.nspname,c.relname,a.attnum`
    const functions =
      await sql`SELECT n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,pg_get_functiondef(p.oid) AS definition
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname IN ('public','drizzle') AND p.prokind IN ('f','p') ORDER BY n.nspname,p.proname,arguments`
    const types =
      await sql`SELECT n.nspname,t.typname,t.typtype,format_type(t.typbasetype,t.typtypmod) AS base_type,t.typnotnull,t.typdefault,
      COALESCE((SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid=t.oid),'[]'::jsonb) AS labels
      FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname IN ('public','drizzle') AND t.typtype IN ('d','e') ORDER BY n.nspname,t.typname`
    const views =
      await sql`SELECT schemaname,viewname,definition FROM pg_views WHERE schemaname IN ('public','drizzle') ORDER BY schemaname,viewname`
    const policies =
      await sql`SELECT schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname IN ('public','drizzle') ORDER BY schemaname,tablename,policyname`
    return {
      tables: rows,
      sequences,
      columns: [...columns],
      functions: [...functions],
      types: [...types],
      views: [...views],
      policies: [...policies],
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

try {
  await assertRecoveryDirectory(project)
  await fileDigest(join(api, '.env'), 65536)
  const config = parse(await readFile(join(api, '.env'))),
    url = new URL(config.DATABASE_URL)
  assert.ok(
    config.APP_ENV === 'development' &&
      ['localhost', '127.0.0.1'].includes(url.hostname) &&
      url.port === '5433' &&
      url.pathname === '/student_service' &&
      url.username === 'postgres' &&
      url.password &&
      !url.search &&
      !url.hash,
    'KNOWN_DEVELOPMENT_CONFIG_REQUIRED',
  )
  original = await sourceOffline()
  await assertRecoveryDirectory(join(project, 'run'))
  await mkdir(join(project, 'run/offline-development'), { recursive: true })
  await assertRecoveryDirectory(join(project, 'run/offline-development'))
  await mkdir(root)
  await assertRecoveryDirectory(root)
  report = {
    version: 1,
    runId,
    status: 'RUNNING',
    sourceClassification: 'EXISTING_DEVELOPMENT_UNCLASSIFIED',
    sourceContainerId: original.Id,
    imageId: original.Image,
    checks: {},
    sourceModified: false,
  }
  console.log(JSON.stringify({ event: 'OFFLINE_PRESERVATION_STARTED', runId }))
  phase = 'physical-snapshot'
  const reader = await create('reader', [
    '--network',
    'none',
    '--tmpfs',
    '/var/lib/postgresql/data:rw,size=1048576',
    '--read-only',
    '--mount',
    'type=volume,source=' + developmentVolume + ',target=/source,readonly',
    '--entrypoint',
    'sh',
    original.Image,
    '-c',
    'test -f /source/PG_VERSION && test -z "$(find /source -mindepth 1 ! -type f ! -type d -print -quit)" && tar -C /source -cf - .',
  ])
  report.physical = await streamDocker(
    ['start', '-a', reader.id],
    join(root, 'database-physical.tar'),
    450 * 1048576,
  )
  assert.equal((await owned(reader)).State.ExitCode, 0, 'PHYSICAL_READER_FAILED')
  await sourceOffline()
  const verification = await streamDocker(['start', '-a', reader.id], null, 450 * 1048576)
  assert.deepEqual(verification, report.physical)
  assert.equal((await owned(reader)).State.ExitCode, 0, 'PHYSICAL_READER_FAILED')
  report.checks.sourcePhysicalBytesStable = true
  phase = 'open-independent-physical-copy'
  const copied = await create('source', [
    '--tmpfs',
    '/var/lib/postgresql/data:rw,size=536870912',
    '--publish',
    '127.0.0.1::5432',
    '--entrypoint',
    'sh',
    original.Image,
    '-c',
    'tar -xpf /tmp/development.tar -C /var/lib/postgresql/data && exec docker-entrypoint.sh postgres',
  ])
  await docker(['cp', join(root, 'database-physical.tar'), copied.id + ':/tmp/development.tar'])
  await docker(['start', copied.id])
  await ready(copied, 'student_service')
  const sql = await client(copied, 'student_service', decodeURIComponent(url.password))
  const before = await snapshot(sql)
  await writeFile(join(root, 'source-digests.json'), JSON.stringify(before, null, 2) + '\n', {
    flag: 'wx',
    mode: 0o600,
  })
  report.checks.physicalCopyOpened = true
  phase = 'preserve-evidence-and-templates'
  const evidenceRoot = resolve(api, config.SUBMISSION_STORAGE_ROOT || '.local/submission-files')
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
  const files = await inventory(evidenceRoot, uuid, 5242880, true)
  const templates = await inventory(
    join(api, 'templates'),
    /^(?:submission-summary-v[1-9][0-9]*\.docx|\.gitattributes)$/,
    1048576,
  )
  await mkdir(join(root, 'files'))
  await mkdir(join(root, 'templates'))
  for (const [kind, source, entries, maximum] of [
    ['files', evidenceRoot, files, 5242880],
    ['templates', join(api, 'templates'), templates, 1048576],
  ])
    for (const item of entries)
      await copyRecoveryPrivateFile(
        join(source, item.key),
        join(root, kind, item.key),
        item,
        maximum,
      )
  const evidenceAudit = await sql.begin('isolation level repeatable read read only', (tx) =>
    auditEvidence({ root: join(root, 'files'), references: readEvidenceReferences(tx) }),
  )
  report.evidence = {
    status: evidenceAudit.status,
    counts: evidenceAudit.counts,
    issuesByCode: evidenceAudit.issuesByCode,
  }
  report.assets = { files, templates }
  const hasRegistry = before.tables.some((t) => t.table === 'public.submission_documents')
  report.registryDocuments = hasRegistry
    ? Number((await sql`SELECT count(*)::int AS count FROM submission_documents`)[0].count)
    : 0
  phase = 'logical-backup-and-restore'
  report.logical = await streamDocker(
    [
      'exec',
      copied.id,
      'pg_dump',
      '-U',
      'postgres',
      '-d',
      'student_service',
      '--format=custom',
      '--no-owner',
      '--no-privileges',
    ],
    join(root, 'database.dump'),
    536870912,
  )
  assert.deepEqual(await snapshot(sql), before)
  const password = randomBytes(24).toString('hex'),
    targetDatabase = 'student_service_preservation_target'
  phase = 'create-logical-restore-target'
  const target = await create(
    'target',
    [
      '--tmpfs',
      '/var/lib/postgresql/data:rw,size=536870912',
      '--publish',
      '127.0.0.1::5432',
      '--env',
      'POSTGRES_PASSWORD',
      '--env',
      'POSTGRES_DB=' + targetDatabase,
      original.Image,
    ],
    { POSTGRES_PASSWORD: password },
  )
  await docker(['start', target.id])
  phase = 'wait-logical-target-tcp'
  await ready(target, targetDatabase)
  phase = 'restore-logical-dump'
  await streamDocker(
    [
      'exec',
      '-i',
      target.id,
      'pg_restore',
      '-U',
      'postgres',
      '-d',
      targetDatabase,
      '--exit-on-error',
      '--no-owner',
      '--no-privileges',
    ],
    null,
    1048576,
    join(root, 'database.dump'),
  )
  phase = 'compare-restored-schema'
  const restored = await client(target, targetDatabase, password),
    after = await snapshot(restored)
  await writeFile(join(root, 'restored-digests.json'), JSON.stringify(after, null, 2) + '\n', {
    flag: 'wx',
    mode: 0o600,
  })
  assert.deepEqual(after, before)
  phase = 'synthetic-snapshot-fault-check'
  const [probe] =
    await restored`SELECT to_regclass('public.dev_preservation_probe') IS NULL AND to_regprocedure('public.dev_preservation_probe()') IS NULL AS absent`
  assert.equal(probe.absent, true, 'PROBE_NAME_COLLISION')
  await restored`CREATE TABLE public.dev_preservation_probe(id integer)`
  await restored.unsafe(
    'CREATE FUNCTION public.dev_preservation_probe() RETURNS integer LANGUAGE sql IMMUTABLE AS $$SELECT 1$$',
  )
  const initialProbe = await snapshot(restored)
  await restored`ALTER TABLE public.dev_preservation_probe ADD COLUMN extra text`
  await restored.unsafe(
    'CREATE OR REPLACE FUNCTION public.dev_preservation_probe() RETURNS integer LANGUAGE sql IMMUTABLE AS $$SELECT 2$$',
  )
  const changedProbe = await snapshot(restored)
  assert.notDeepEqual(changedProbe.columns, initialProbe.columns)
  assert.notDeepEqual(changedProbe.functions, initialProbe.functions)
  await restored`DROP TABLE public.dev_preservation_probe`
  await restored.unsafe('DROP FUNCTION public.dev_preservation_probe()')
  assert.deepEqual(await snapshot(restored), before)
  report.checks.syntheticColumnAndFunctionChangesDetected = true
  report.checks.logicalRestoreMatchesEveryTableAndSchema = true
  report.tables = before.tables.length
  report.sequences = before.sequences.length
  phase = 'final-source-and-file-check'
  await sourceOffline()
  assert.deepEqual(
    await streamDocker(['start', '-a', reader.id], null, 450 * 1048576),
    report.physical,
  )
  assert.deepEqual(await inventory(evidenceRoot, uuid, 5242880, true), files)
  assert.deepEqual(
    await inventory(
      join(api, 'templates'),
      /^(?:submission-summary-v[1-9][0-9]*\.docx|\.gitattributes)$/,
      1048576,
    ),
    templates,
  )
  for (const [kind, entries, maximum] of [
    ['files', files, 5242880],
    ['templates', templates, 1048576],
  ])
    for (const item of entries)
      assert.deepEqual(await fileDigest(join(root, kind, item.key), maximum), {
        size: item.size,
        sha256: item.sha256,
      })
  report.checks.sourceAndAssetsUnchanged = true
  report.systemPreservationReady = evidenceAudit.status === 'OK' && report.registryDocuments === 0
  report.status = report.systemPreservationReady
    ? 'VERIFIED_PREUPGRADE_COPY'
    : 'DATABASE_ONLY_ATTENTION'
  report.offDeviceBackup = false
} catch (error) {
  if (!report) report = { version: 1, runId, checks: {}, sourceModified: false }
  report.status = 'FAILED'
  report.phase = phase
  report.code = /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'PRESERVATION_OPERATION_FAILED'
  process.exitCode = 1
} finally {
  for (const sql of clients) await sql.end({ timeout: 5 }).catch(() => {})
  report.cleanup = true
  for (const clone of clones.reverse()) {
    try {
      await owned(clone)
      await docker(['rm', '--force', clone.id])
    } catch {
      report.cleanup = false
      process.exitCode = 1
    }
  }
  if (report.status === 'DATABASE_ONLY_ATTENTION') process.exitCode = 2
  try {
    await writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2) + '\n', {
      flag: 'wx',
      mode: 0o600,
    })
  } catch {
    process.exitCode = 1
  }
  console.log(
    JSON.stringify({
      event: 'OFFLINE_PRESERVATION_RESULT',
      runId,
      status: report.status,
      phase: report.phase,
      code: report.code,
      tables: report.tables,
      sequences: report.sequences,
      cleanup: report.cleanup,
    }),
  )
}
