import assert from 'node:assert/strict'
export function inspectMigrationHistory(rows, migrations) {
  const mismatches = []
  if (rows.length > migrations.length) mismatches.push('EXCESS_ROWS')
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i],
      expected = migrations[i]
    if (!expected || Number(row.created_at) !== expected.folderMillis || row.hash !== expected.hash)
      mismatches.push(i)
  }
  const recognized = rows.map((r) =>
    migrations.findIndex((m) => Number(r.created_at) === m.folderMillis && r.hash === m.hash),
  )
  const unknownRecords = rows
    .filter((r, i) => recognized[i] < 0)
    .map((r) => ({ id: r.id, createdAt: r.created_at, hash: r.hash }))
  return {
    canonical: mismatches.length === 0,
    recordCount: rows.length,
    expectedTotal: migrations.length,
    mismatches,
    recognizedRecords: recognized.filter((i) => i >= 0).length,
    unknownRecords,
  }
}
export function assertPreservedCatalogRows(before, after, allowedExtra) {
  const counts = new Map()
  for (const row of after) {
    const key = JSON.stringify(row)
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  for (const row of before) {
    const key = JSON.stringify(row),
      count = counts.get(key) || 0
    assert.ok(count > 0, 'UPGRADE_EXISTING_CATALOG_ROW_CHANGED')
    counts.set(key, count - 1)
  }
  const extras = []
  for (const row of after) {
    const key = JSON.stringify(row),
      count = counts.get(key) || 0
    if (count > 0) {
      extras.push(row)
      counts.set(key, count - 1)
    }
  }
  assert.ok(extras.length <= 1 && extras.every(allowedExtra), 'UPGRADE_UNEXPECTED_CATALOG_ROWS')
  return extras.length
}

// This describes the observed legacy state, not a recovered historical migration.
export const legacyRecord = Object.freeze({
  id: 3,
  createdAt: 1788422683657,
  hash: 'a8f239a60d54744ce6019b4be0b8dfdb96b50e13050ca8cb49b8bfcf10c8105e',
})
export const legacyShapeSql = [
  `CREATE TABLE public.account_activation_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  token_hash varchar(64) NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  used_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT account_activation_tokens_token_hash_unique UNIQUE(token_hash),
  CONSTRAINT account_activation_tokens_user_id_users_id_fk FOREIGN KEY(user_id) REFERENCES public.users(id) ON DELETE CASCADE
)`,
  `CREATE INDEX account_activation_tokens_user_id_idx ON public.account_activation_tokens USING btree(user_id)`,
]
export function inspectKnownLegacyHistory(rows, migrations) {
  const unknown = rows[2]
  if (
    migrations.length !== 25 ||
    rows.length !== 24 ||
    !unknown ||
    unknown.id !== legacyRecord.id ||
    Number(unknown.created_at) !== legacyRecord.createdAt ||
    unknown.hash !== legacyRecord.hash ||
    migrations[22]?.folderMillis !== 1791704855792
  )
    return false
  const canonical = rows.filter((_, i) => i !== 2)
  return (
    inspectMigrationHistory(canonical, migrations).canonical &&
    canonical.length === 23 &&
    rows.every((r, i) => r.id === i + 1)
  )
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])]),
    )
  return value
}
export function schemaProjection(snapshot) {
  assert.ok(snapshot.details, 'DETAILED_SCHEMA_REQUIRED')
  const result = {
    tables: snapshot.tables.map((r) => r.table),
    sequences: snapshot.sequences.map((r) => r.name),
  }
  for (const key of [
    'columns',
    'functions',
    'types',
    'views',
    'policies',
    'indexes',
    'triggers',
    'constraints',
    'extensions',
  ])
    result[key] = snapshot[key]
  for (const [key, value] of Object.entries(snapshot.details)) result['detail.' + key] = value
  return Object.fromEntries(
    Object.entries(result).map(([key, rows]) => [
      key,
      rows.map((r) => JSON.stringify(stable(r))).sort(),
    ]),
  )
}
export function compareDevelopmentSchema(actual, expected) {
  const a = schemaProjection(actual),
    b = schemaProjection(expected)
  const differences = {}
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    // Multisets also detect duplicates rather than silently collapsing them.
    const left = [...(a[key] || [])],
      right = [...(b[key] || [])]
    const unexpected = []
    for (const row of left) {
      const index = right.indexOf(row)
      if (index < 0) unexpected.push(JSON.parse(row))
      else right.splice(index, 1)
    }
    if (unexpected.length || right.length)
      differences[key] = { unexpected, missing: right.map((r) => JSON.parse(r)) }
  }
  return { matches: Object.keys(differences).length === 0, differences }
}
export function assertLegacyLedgerPreserved(before, after, migrations) {
  assert.ok(inspectKnownLegacyHistory(before, migrations), 'KNOWN_LEGACY_HISTORY_REQUIRED')
  assert.equal(after.length, before.length + 2, 'UPGRADE_LEDGER_COUNT_CHANGED')
  assert.deepEqual(after.slice(0, before.length), before, 'UPGRADE_OLD_LEDGER_CHANGED')
  assert.deepEqual(
    after.slice(before.length).map((r) => ({
      id: r.id,
      hash: r.hash,
      created_at: Number(r.created_at),
    })),
    migrations.slice(23).map((m, i) => ({
      id: before.length + i + 1,
      hash: m.hash,
      created_at: m.folderMillis,
    })),
    'UPGRADE_NEW_LEDGER_MISMATCH',
  )
}
export function assertDevelopmentAuditInvocation(args, env) {
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
  assert.ok(
    args[0] === '--offline-development-only' &&
      args[1] === '--preservation-run' &&
      uuid.test(args[2] || '') &&
      (args.length === 3 || (args.length === 4 && args[3] === '--rehearse-upgrade')),
    'DEVELOPMENT_AUDIT_FLAGS_REQUIRED',
  )
  assert.ok(
    !env.DATABASE_URL && !env.SUBMISSION_STORAGE_ROOT && env.APP_ENV !== 'production',
    'EXTERNAL_CONFIGURATION_REFUSED',
  )
  return { preservationRun: args[2], rehearse: args.length === 4 }
}
export function assertDevelopmentAuditContainer(info, run, id, kind, image) {
  assert.match(run, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/)
  assert.ok(
    ['canonical', 'upgrade', 'rollback'].includes(kind) &&
      /^[a-f0-9]{64}$/.test(id) &&
      info.Id === id &&
      info.Name === '/student-service-dev-audit-' + run + '-' + kind &&
      info.Image === image &&
      info.Config?.Labels?.['student-service.development-audit-id'] === run &&
      Array.isArray(info.Mounts) &&
      info.Mounts.every((m) => m.Type === 'tmpfs') &&
      Object.keys(info.HostConfig?.Tmpfs || {}).length === 1 &&
      info.HostConfig.Tmpfs['/var/lib/postgresql/data'] === 'rw,size=536870912' &&
      Object.keys(info.HostConfig.PortBindings || {}).length === 1 &&
      info.HostConfig.PortBindings?.['5432/tcp']?.length === 1 &&
      info.HostConfig.PortBindings['5432/tcp'][0].HostIp === '127.0.0.1',
    'DEVELOPMENT_AUDIT_CONTAINER_MISMATCH',
  )
}

// 0024 evaluates exactly one nextval for document.retry, including ON CONFLICT.
// An uncalled sequence returns its current value on that first call.
export function assertUpgradeSequences(before, after, { permissionNextval = true } = {}) {
  assert.equal(typeof permissionNextval, 'boolean', 'PERMISSION_NEXTVAL_POLICY_REQUIRED')
  const application = (rows) => rows.filter((r) => r.name !== 'drizzle.__drizzle_migrations_id_seq')
  const expected = structuredClone(application(before))
  const permission = expected.find((r) => r.name === 'public.permissions_id_seq')
  assert.ok(permission && /^-?\d+$/.test(permission.last_value), 'PERMISSION_SEQUENCE_REQUIRED')
  if (permissionNextval) {
    permission.last_value = String(BigInt(permission.last_value) + (permission.is_called ? 1n : 0n))
    permission.is_called = true
  }
  assert.deepEqual(application(after), expected, 'UPGRADE_APPLICATION_SEQUENCE_CHANGED')
}
