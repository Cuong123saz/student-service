// Parent-owned, synthetic, one-shot acceptance. Never activates a signer.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { readRecoveryPrivateFile } from './recovery-private-file.mjs'
import {
  assertDemoState,
  assertDemoContainer,
  assertDemoDatabase,
  demoDatabase,
} from './workflow-demo.contract.mjs'
import {
  collectDocumentRegistryAssets,
  readDocumentRegistrySnapshot,
  registrySnapshotDigest,
} from './document-registry-inventory.mjs'
assert.ok(process.send && process.connected, 'REQUIRES_SPRINT6_DEMO_PARENT')
assert.equal(process.argv.length, 2, 'NO_SPRINT6_CHECKER_ARGUMENTS')
const project = fileURLToPath(new URL('../../../', import.meta.url))
const statePath = process.env.WORKFLOW_SPRINT6_STATE_PATH
const state = JSON.parse((await readRecoveryPrivateFile(statePath, 65536)).toString('utf8'))
const root = assertDemoState(state, project, statePath, 'sprint6')
assert.equal(state.status, 'READY')
let sql
try {
  process.argv.push('--fake-data-only', '--sprint6')
  await import('./check-workflow-demo.mjs')
  assert.ok(!process.exitCode, 'SPRINT6_BROWSER_FAILED')
  const browser = JSON.parse(
    (await readRecoveryPrivateFile(join(root, 'browser-report.json'), 1048576)).toString('utf8'),
  )
  assert.ok(
    browser.status === 'PASS' &&
      browser.runId === state.runId &&
      Object.values(browser.checks).every((v) => v === true),
  )
  const { stdout } = await promisify(execFile)(
    'docker',
    ['inspect', 'student-service-workflow-demo-' + state.runId],
    { windowsHide: true, timeout: 15000, maxBuffer: 1048576 },
  )
  const info = JSON.parse(stdout)[0]
  assertDemoContainer(info, state.runId, info.Id)
  assert.equal(info.State.Running, true)
  // The empty dotenv marker disables inherited source configuration; it contains no URL.
  // Read only the already-verified, owned synthetic container's random credential in memory.
  const ports = info.NetworkSettings.Ports['5432/tcp']
  assert.equal(ports.length, 1)
  assert.equal(ports[0].HostIp, '127.0.0.1')
  const password = info.Config.Env.filter((v) => v.startsWith('POSTGRES_PASSWORD='))
  assert.equal(password.length, 1)
  const secret = password[0].slice('POSTGRES_PASSWORD='.length)
  assert.match(secret, /^[a-f0-9]{48}$/)
  const url = new URL('postgres://postgres@127.0.0.1:' + ports[0].HostPort + '/' + demoDatabase)
  url.password = secret
  assertDemoDatabase(url.href)
  sql = postgres(url.href, { max: 1, connect_timeout: 5, onnotice: () => {} })
  const inventory = await sql.begin('isolation level repeatable read read only', async (tx) => {
    const before = await readDocumentRegistrySnapshot(tx)
    const assets = await collectDocumentRegistryAssets({
      sql: tx,
      templateRoot: join(root, 'vault/templates'),
      documentRoot: join(root, 'vault/documents'),
      stagingRoot: join(root, 'vault/staging'),
    })
    assert.equal(assets.documents.length, 6)
    assert.equal(before.jobs.length, 6)
    assert.ok(
      before.jobs.every((j) => j.state === 'COMPLETE' && j.attempts === 1 && j.errorCode === null),
    )
    assert.equal(before.retries.length, 0)
    const approved = browser.cases.find((c) => c.status === 'APPROVED')
    assert.equal(approved.rounds, 2)
    const rejected = browser.cases.find((c) => c.status === 'REJECTED')
    assert.equal(rejected.rounds, 1)
    for (const [caseId, number] of [
      [approved.id, 1],
      [approved.id, 2],
      [rejected.id, 1],
    ]) {
      const pair = assets.documents.filter(
        (d) => d.submissionId === caseId && d.roundNumber === number,
      )
      assert.equal(pair.length, 2)
      const word = pair.find((d) => d.format === 'DOCX'),
        pdf = pair.find((d) => d.format === 'PDF')
      assert.ok(word && pdf)
      assert.equal(pdf.sourceDocxSha256, word.sha256)
    }
    assert.equal(
      registrySnapshotDigest(await readDocumentRegistrySnapshot(tx)),
      registrySnapshotDigest(before),
    )
    return {
      version: 1,
      fakeDataOnly: true,
      status: 'PASS',
      runId: state.runId,
      mode: 'OBSERVATIONAL_READ_ONLY',
      signaturesChecked: false,
      productionReadiness: 'NOT_READY',
      registry: before,
      assets,
    }
  })
  await writeFile(
    join(root, 'sprint6-document-inventory.json'),
    JSON.stringify(inventory, null, 2) + '\n',
    { flag: 'wx', mode: 0o600 },
  )
  console.log(
    'SPRINT6_DOCUMENT_INVENTORY ' +
      JSON.stringify({
        status: 'PASS',
        documents: 6,
        jobs: 6,
        attemptsPerJob: 1,
        signerActivated: false,
      }),
  )
} catch (error) {
  console.error(
    'SPRINT6_ACCEPTANCE_FAILED ' +
      (/^[A-Z0-9_]+$/.test(error.message) ? error.message : 'CHECK_FAILED'),
  )
  process.exitCode = 1
} finally {
  if (sql) await sql.end()
  if (process.connected) process.disconnect()
}
