// Parent-owned one-shot browser + stored-byte mock signer verification.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readRecoveryPrivateFile } from './recovery-private-file.mjs'
import { assertDemoState } from './workflow-demo.contract.mjs'
assert.ok(process.send && process.connected, 'REQUIRES_MOCK_SIGNATURE_PARENT')
const project = fileURLToPath(new URL('../../../', import.meta.url))
const statePath = process.env.WORKFLOW_SIGNATURE_STATE_PATH
const state = JSON.parse((await readRecoveryPrivateFile(statePath, 65536)).toString('utf8'))
const root = assertDemoState(state, project, statePath, 'mock-signature')
assert.equal(state.status, 'READY')
try {
  process.argv.push('--fake-data-only', '--mock-signature')
  await import('./check-workflow-demo.mjs')
  assert.ok(!process.exitCode, 'WORKFLOW_BROWSER_FAILED')
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      fileURLToPath(new URL('./rehearse-mock-signature.mjs', import.meta.url)),
      '--fake-data-only',
      '--source-run',
      state.runId,
    ],
    { env: process.env, windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024 },
  )
  const result = JSON.parse(stdout.trim())
  assert.ok(
    result.event === 'MOCK_SIGNATURE_REHEARSAL' &&
      result.status === 'PASS' &&
      /^[a-f0-9-]{36}$/.test(result.runId),
  )
  await writeFile(
    join(root, 'mock-signature-result.json'),
    JSON.stringify(
      {
        version: 1,
        fakeDataOnly: true,
        sourceRunId: state.runId,
        runId: result.runId,
        status: 'PASS',
        reportPath: join('run/mock-signature', result.runId, 'report.json'),
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx', mode: 0o600 },
  )
  console.log(stdout.trim())
} catch {
  console.error('MOCK_SIGNATURE_WORKFLOW_FAILED')
  process.exitCode = 1
} finally {
  if (process.connected) process.disconnect()
}
