import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
const apiRoot = fileURLToPath(new URL('..', import.meta.url))
test('Sprint 7 checker refuses direct execution before reading any run or launching a browser', () => {
  const result = spawnSync(process.execPath, ['scripts/check-sprint7-demo.mjs'], {
    cwd: apiRoot,
    encoding: 'utf8',
    timeout: 30000,
    windowsHide: true,
    env: Object.fromEntries(
      ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP']
        .filter((k) => process.env[k])
        .map((k) => [k, process.env[k]]),
    ),
  })
  assert.equal(result.error, undefined)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /REQUIRES_SPRINT7_DEMO_PARENT/)
})

test('general workflow checker cannot consume the private Sprint 7 rehearsal', () => {
  const result = spawnSync(
    process.execPath,
    ['scripts/check-workflow-demo.mjs', '--fake-data-only', '--sprint7'],
    {
      cwd: apiRoot,
      encoding: 'utf8',
      timeout: 30000,
      windowsHide: true,
      env: Object.fromEntries(
        ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP']
          .filter((k) => process.env[k])
          .map((k) => [k, process.env[k]]),
      ),
    },
  )
  assert.equal(result.error, undefined)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /REQUIRES_SPRINT7_DEMO_PARENT/)
})
