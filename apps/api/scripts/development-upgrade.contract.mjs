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
