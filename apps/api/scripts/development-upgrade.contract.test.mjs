import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  inspectMigrationHistory,
  assertPreservedCatalogRows,
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
