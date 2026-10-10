import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
const script = fileURLToPath(new URL('./check-concurrency.mjs', import.meta.url))
const local = 'postgres://test:dummy@localhost:5434/student_service_test'
for (const [name, databaseUrl, appEnv, message] of [
  [
    'development database',
    'postgres://test:dummy@localhost:5433/student_service',
    'test',
    'Requires isolated local',
  ],
  [
    'remote database',
    'postgres://test:dummy@example.invalid:5434/student_service_test',
    'test',
    'Requires isolated local',
  ],
  [
    'wrong database name',
    'postgres://test:dummy@localhost:5434/student_service',
    'test',
    'Requires isolated local',
  ],
  ['production environment', local, 'production', 'Requires APP_ENV=test'],
  ['missing database configuration', undefined, 'test', 'Requires isolated local'],
]) {
  test('concurrency runner refuses ' + name + ' before connecting or seeding', () => {
    const env = { ...process.env, APP_ENV: appEnv }
    if (databaseUrl) env.DATABASE_URL = databaseUrl
    else delete env.DATABASE_URL
    const result = spawnSync(process.execPath, [script], { env, encoding: 'utf8', timeout: 10000 })
    assert.equal(result.error, undefined)
    assert.notEqual(result.status, 0)
    assert.ok(result.stderr.includes(message))
    assert.ok(!result.stdout.includes('CONCURRENCY_PHASE'))
  })
}
