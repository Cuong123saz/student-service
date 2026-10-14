import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
const exec = promisify(execFile)
const env = { ...process.env }
for (const key of ['DATABASE_URL', 'SUBMISSION_STORAGE_ROOT', 'APP_ENV']) delete env[key]
const run = (name, args, changes = {}) =>
  exec(process.execPath, [fileURLToPath(new URL(name, import.meta.url)), ...args], {
    env: { ...env, ...changes },
    windowsHide: true,
    timeout: 10000,
    maxBuffer: 65536,
  })
const refused = (code) => (error) =>
  error.code === 1 && error.stdout === '' && error.stderr.includes(code)
test('mock rehearsal refuses missing opt-in, inherited real config, extra options and traversal before Docker or writes', async () => {
  await assert.rejects(
    run('./rehearse-mock-signature.mjs', []),
    refused('REQUIRES_FAKE_DATA_ONLY_FLAG'),
  )
  for (const changes of [
    { DATABASE_URL: 'postgres://fake.invalid/no-connection' },
    { SUBMISSION_STORAGE_ROOT: 'external' },
    { APP_ENV: 'production' },
  ])
    await assert.rejects(
      run('./rehearse-mock-signature.mjs', ['--fake-data-only', '--source-run', 'bad'], changes),
      refused('EXTERNAL_DATABASE_OR_STORAGE_CONFIG_REFUSED'),
    )
  await assert.rejects(
    run('./rehearse-mock-signature.mjs', ['--fake-data-only', '--source-run', 'bad', 'extra']),
    refused('REQUIRES_SOURCE_RUN'),
  )
  await assert.rejects(
    run('./rehearse-mock-signature.mjs', ['--fake-data-only', '--source-run', '../../other']),
    refused('INVALID_WORKFLOW_DEMO_STATE'),
  )
})
test('private wrapper and browser checker reject direct calls before consuming a run', async () => {
  await assert.rejects(
    run('./check-mock-signature-demo.mjs', []),
    refused('REQUIRES_MOCK_SIGNATURE_PARENT'),
  )
  await assert.rejects(
    run('./check-workflow-demo.mjs', ['--fake-data-only', '--mock-signature']),
    refused('REQUIRES_MOCK_SIGNATURE_PARENT'),
  )
})
