import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  inspectMigrationHistory,
  assertPreservedCatalogRows,
  assertUpgradeSequences,
  legacyRecord,
  inspectKnownLegacyHistory,
  assertLegacyLedgerPreserved,
  compareDevelopmentSchema,
  assertDevelopmentAuditInvocation,
  assertDevelopmentAuditContainer,
} from './development-upgrade.contract.mjs'
test('migration ledger must be an exact canonical prefix; duplicates, changed hashes, missing predecessors and future records fail', () => {
  const migrations = [
    { folderMillis: 1, hash: 'a' },
    { folderMillis: 2, hash: 'b' },
  ]
  assert.equal(
    inspectMigrationHistory([{ created_at: '1', hash: 'a' }], migrations).canonical,
    true,
  )
  for (const rows of [
    [{ created_at: '2', hash: 'b' }],
    [{ created_at: '1', hash: 'changed' }],
    [
      { created_at: '1', hash: 'a' },
      { created_at: '1', hash: 'a' },
    ],
    [{ created_at: '3', hash: 'c' }],
  ])
    assert.equal(inspectMigrationHistory(rows, migrations).canonical, false)
})
test('catalog migration keeps every old row and only permits the single declared addition', () => {
  const old = [{ id: 'a', code: 'existing' }],
    extra = { id: 'b', code: 'document.retry' }
  assert.equal(
    assertPreservedCatalogRows(old, [...old, extra], (r) => r.code === 'document.retry'),
    1,
  )
  for (const after of [
    [extra],
    [{ id: 'a', code: 'changed' }],
    [...old, { id: 'c', code: 'unrelated' }],
    [...old, extra, extra],
  ])
    assert.throws(() => assertPreservedCatalogRows(old, after, (r) => r.code === 'document.retry'))
})

test('a retired extra record is diagnosed but never silently accepted or deleted', () => {
  const result = inspectMigrationHistory(
    [
      { id: 1, created_at: 1, hash: 'a' },
      { id: 2, created_at: 2, hash: 'retired' },
      { id: 3, created_at: 3, hash: 'b' },
    ],
    [
      { folderMillis: 1, hash: 'a' },
      { folderMillis: 3, hash: 'b' },
    ],
  )
  assert.equal(result.canonical, false)
  assert.equal(result.recognizedRecords, 2)
  assert.equal(result.unknownRecords.length, 1)
  assert.equal(result.unknownRecords[0].hash, 'retired')
})

const fakeMigrations = () =>
  Array.from({ length: 25 }, (_, i) => ({
    hash: 'fake-' + i,
    folderMillis:
      i < 2
        ? legacyRecord.createdAt - (2 - i) * 1000
        : i < 22
          ? legacyRecord.createdAt + (i - 1) * 1000
          : 1791704855792 + (i - 22) * 1000,
  }))
const fakeLegacyHistory = () => {
  const rows = fakeMigrations()
    .slice(0, 23)
    .map((m) => ({ hash: m.hash, created_at: String(m.folderMillis) }))
  rows.splice(2, 0, { hash: legacyRecord.hash, created_at: String(legacyRecord.createdAt) })
  return rows.map((r, i) => ({ id: i + 1, ...r }))
}
test('known legacy candidate is exact, ordered and limited to the observed prefix; default gate remains strict', () => {
  const rows = fakeLegacyHistory(),
    migrations = fakeMigrations()
  assert.equal(inspectKnownLegacyHistory(rows, migrations), true)
  assert.equal(inspectMigrationHistory(rows, migrations).canonical, false)
  for (const change of [
    (r) => {
      r[2].hash = 'different'
    },
    (r) => {
      r[2].created_at = '1788422683658'
    },
    (r) => {
      r[2].id = 99
    },
    (r) => {
      r[4].hash = 'changed'
    },
    (r) => {
      ;[r[4], r[5]] = [r[5], r[4]]
    },
    (r) => {
      r.pop()
    },
    (r) => {
      r.push({ ...r[23] })
    },
  ]) {
    const changed = structuredClone(rows)
    change(changed)
    assert.equal(inspectKnownLegacyHistory(changed, migrations), false)
  }
})
test('upgrade ledger retains every old id/hash/timestamp and only appends the two exact new records', () => {
  const before = fakeLegacyHistory(),
    migrations = fakeMigrations()
  const after = [
    ...before,
    ...migrations
      .slice(23)
      .map((m, i) => ({ id: 25 + i, hash: m.hash, created_at: String(m.folderMillis) })),
  ]
  assertLegacyLedgerPreserved(before, after, migrations)
  for (const change of [
    (r) => {
      r.splice(2, 1)
    },
    (r) => {
      r[2].hash = 'rewritten'
    },
    (r) => {
      r[24].id = 30
    },
    (r) => {
      r[25].hash = 'wrong'
    },
    (r) => {
      r.push(r[25])
    },
  ]) {
    const changed = structuredClone(after)
    change(changed)
    assert.throws(() => assertLegacyLedgerPreserved(before, changed, migrations))
  }
})
const fakeSnapshot = () => ({
  tables: [{ table: 'public.fake', count: 1, sha256: 'a' }],
  sequences: [{ name: 'public.fake_seq', last_value: '9', is_called: true }],
  columns: [{ nspname: 'public', relname: 'fake', attname: 'id', attnotnull: true }],
  functions: [{ proname: 'guard', definition: 'body1' }],
  types: [],
  views: [],
  policies: [],
  indexes: [{ indexname: 'key', indexdef: 'definition1' }],
  triggers: [{ tgname: 'guard', definition: 'enabled' }],
  constraints: [{ conname: 'key', definition: 'check1' }],
  extensions: [{ extname: 'plpgsql', extversion: '1.0' }],
  details: {
    relations: [{ relname: 'fake', relrowsecurity: false }],
    sequences: [{ sequencename: 'fake_seq', increment_by: '1' }],
    constraints: [{ conname: 'key', convalidated: true }],
    triggers: [{ tgname: 'guard', tgenabled: 'O' }],
    indexes: [{ indexname: 'key', indisvalid: true }],
    collations: [],
    extensions: [],
  },
})
test('structural projection ignores row contents/sequence state, but detects extra/removed/duplicate objects and metadata drift', () => {
  const baseline = fakeSnapshot(),
    differentData = fakeSnapshot()
  differentData.tables[0].count = 200
  differentData.tables[0].sha256 = 'b'
  differentData.sequences[0].last_value = '80'
  assert.equal(compareDevelopmentSchema(differentData, baseline).matches, true)
  for (const change of [
    (s) => {
      s.tables.push({ table: 'public.extra' })
    },
    (s) => {
      s.columns[0].attnotnull = false
    },
    (s) => {
      s.functions[0].definition = 'body2'
    },
    (s) => {
      s.constraints = []
    },
    (s) => {
      s.indexes.push(s.indexes[0])
    },
    (s) => {
      s.policies.push({ policyname: 'unexpected' })
    },
    (s) => {
      s.details.relations[0].relrowsecurity = true
    },
    (s) => {
      s.details.sequences[0].increment_by = '2'
    },
    (s) => {
      s.details.constraints[0].convalidated = false
    },
    (s) => {
      s.details.triggers[0].tgenabled = 'D'
    },
    (s) => {
      s.details.indexes[0].indisvalid = false
    },
  ]) {
    const changed = fakeSnapshot()
    change(changed)
    assert.equal(compareDevelopmentSchema(changed, baseline).matches, false)
  }
  const missingDetails = fakeSnapshot()
  delete missingDetails.details
  assert.throws(() => compareDevelopmentSchema(missingDetails, baseline))
})
test('audit only accepts a preservation UUID in the project, never arbitrary database/path/production options', () => {
  const args = [
    '--offline-development-only',
    '--preservation-run',
    '11111111-1111-4111-8111-111111111111',
  ]
  assert.equal(assertDevelopmentAuditInvocation(args, {}).rehearse, false)
  assert.equal(assertDevelopmentAuditInvocation([...args, '--rehearse-upgrade'], {}).rehearse, true)
  for (const invalid of [
    [],
    ['--fake-data-only', ...args.slice(1)],
    [...args, '--force'],
    [...args.slice(0, 2), '../../foreign'],
    [...args, '--rehearse-upgrade', 'anything'],
  ])
    assert.throws(() => assertDevelopmentAuditInvocation(invalid, {}))
  for (const env of [
    { DATABASE_URL: 'fake' },
    { SUBMISSION_STORAGE_ROOT: 'fake' },
    { APP_ENV: 'production' },
  ])
    assert.throws(() => assertDevelopmentAuditInvocation(args, env))
})
test('audit cleanup only recognizes its own pinned-image tmpfs clones with loopback publishing and no persistent mounts', () => {
  const run = '11111111-1111-4111-8111-111111111111',
    id = 'a'.repeat(64),
    image = 'sha256:' + 'b'.repeat(64)
  const info = {
    Id: id,
    Image: image,
    Name: '/student-service-dev-audit-' + run + '-upgrade',
    Config: { Labels: { 'student-service.development-audit-id': run } },
    Mounts: [],
    HostConfig: {
      Tmpfs: { '/var/lib/postgresql/data': 'rw,size=536870912' },
      PortBindings: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '' }] },
    },
  }
  assertDevelopmentAuditContainer(info, run, id, 'upgrade', image)
  for (const change of [
    (i) => {
      i.Id = 'c'.repeat(64)
    },
    (i) => {
      i.Name = '/student-service-postgres'
    },
    (i) => {
      i.Image = 'sha256:' + 'c'.repeat(64)
    },
    (i) => {
      i.Config.Labels = {}
    },
    (i) => {
      i.Mounts = [{ Type: 'volume' }]
    },
    (i) => {
      i.Mounts = [{ Type: 'bind' }]
    },
    (i) => {
      i.HostConfig.PortBindings['5432/tcp'][0].HostIp = '0.0.0.0'
    },
  ]) {
    const changed = structuredClone(info)
    change(changed)
    assert.throws(() => assertDevelopmentAuditContainer(changed, run, id, 'upgrade', image))
  }
})

test('0024 permits exactly its one permission nextval while preserving every other application sequence', () => {
  const before = [
    { name: 'drizzle.__drizzle_migrations_id_seq', last_value: '24', is_called: true },
    { name: 'public.permissions_id_seq', last_value: '60', is_called: true },
    { name: 'public.services_id_seq', last_value: '27', is_called: true },
  ]
  const after = structuredClone(before)
  after[0].last_value = '26'
  after[1].last_value = '61'
  assertUpgradeSequences(before, after)
  assertUpgradeSequences(before, before, { permissionNextval: false })
  assert.throws(() => assertUpgradeSequences(before, after, { permissionNextval: false }))
  for (const change of [
    (s) => {
      s[1].last_value = '60'
    },
    (s) => {
      s[1].last_value = '62'
    },
    (s) => {
      s[2].last_value = '28'
    },
    (s) => {
      s.pop()
    },
    (s) => {
      s.push({ name: 'public.unexpected_seq', last_value: '1', is_called: true })
    },
  ]) {
    const changed = structuredClone(after)
    change(changed)
    assert.throws(() => assertUpgradeSequences(before, changed))
  }
  const uncalled = structuredClone(before)
  uncalled[1].is_called = false
  const firstCall = structuredClone(before)
  firstCall[1].is_called = true
  assertUpgradeSequences(uncalled, firstCall)
})
