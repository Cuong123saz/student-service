// Read-only source: a verified, owned, synthetic mock-signature demo.
import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertDrillInvocation, assertRecoveryDirectory } from './recovery-bundle.mjs'
import { readRecoveryPrivateFile } from './recovery-private-file.mjs'
import {
  assertDemoState,
  assertDemoContainer,
  demoDatabase,
  demoRunRoot,
} from './workflow-demo.contract.mjs'
import { readPrivateFile } from '../dist/lib/private-file.js'
import {
  MockSignatureProvider,
  mockReceiptSha256,
  mockSignatureNotice,
} from '../dist/modules/signatures/signature-provider.js'
const args = process.argv.slice(2)
assertDrillInvocation(args.slice(0, 1), process.env)
assert.equal(args.length, 3, 'REQUIRES_SOURCE_RUN')
assert.equal(args[1], '--source-run', 'REQUIRES_SOURCE_RUN')
const sourceId = args[2],
  project = fileURLToPath(new URL('../../../', import.meta.url))
const source = demoRunRoot(project, sourceId)
await assertRecoveryDirectory(source)
const readJson = async (path) =>
  JSON.parse((await readRecoveryPrivateFile(path, 1024 * 1024)).toString('utf8'))
const statePath = join(source, 'state.json'),
  state = await readJson(statePath)
assertDemoState(state, project, statePath, 'mock-signature')
assert.equal(state.status, 'READY', 'SOURCE_MUST_BE_RUNNING')
const browser = await readJson(join(source, 'browser-report.json'))
for (const value of [browser])
  assert.ok(value.fakeDataOnly === true && value.runId === sourceId && value.status === 'PASS')
assert.ok(
  Object.values(browser.checks).every(Boolean) &&
    browser.checks.wordPdfAndFrozenHistoricalExport &&
    browser.pageErrors.length === 0,
)
const requiredChecks = [
  'requiredFieldsProfileAndExactTypes',
  'wordPdfAndFrozenHistoricalExport',
  'bundleWordPdfEvidenceAndHistoricalIsolation',
  'supplementPreservesTypedHistory',
  'signatureRemainsUnchecked',
  'approveAndIdempotency',
]
assert.ok(
  requiredChecks.every((key) => browser.checks[key] === true),
  'SOURCE_BROWSER_CHECKS_REQUIRED',
)
const approved = browser.cases.find((c) => c.status === 'APPROVED')
assert.ok(approved && /^[a-f0-9-]{36}$/.test(approved.id) && approved.rounds === 2)
const exec = promisify(execFile)
const docker = async (parameters) =>
  (
    await exec('docker', parameters, { timeout: 15000, maxBuffer: 1024 * 1024, windowsHide: true })
  ).stdout.trim()
const info = JSON.parse(await docker(['inspect', 'student-service-workflow-demo-' + sourceId]))[0]
assertDemoContainer(info, sourceId, info.Id)
assert.equal(info.State.Running, true)
const containerId = info.Id
const query = `BEGIN READ ONLY; SELECT COALESCE(json_agg(row_to_json(x) ORDER BY x.round_number,x.format),'[]') FROM (
SELECT s.id AS submission_id,s.status AS submission_status,r.id AS round_id,r.round_number,d.id AS document_id,
d.format,d.storage_key,d.size,d.sha256,d.source_docx_sha256,d.status
FROM submission_documents d JOIN submission_document_sets ds ON ds.id=d.set_id
JOIN submission_rounds r ON r.id=ds.round_id JOIN submissions s ON s.id=ds.submission_id
WHERE s.id='${approved.id}' ORDER BY r.round_number,d.format) x; COMMIT;`
const snapshot = async () => {
  const current = JSON.parse(await docker(['inspect', containerId]))[0]
  assertDemoContainer(current, sourceId, containerId)
  assert.equal(current.State.Running, true)
  return docker([
    'exec',
    containerId,
    'psql',
    '-X',
    '-qAt',
    '-v',
    'ON_ERROR_STOP=1',
    '-U',
    'postgres',
    '-d',
    demoDatabase,
    '-c',
    query,
  ])
}
const before = await snapshot(),
  documents = JSON.parse(before)
assert.equal(documents.length, 4, 'EXPECTED_TWO_STORED_PAIRS')
const sourceDigests = new Map()
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
async function remember(path, maximum) {
  const bytes = await readPrivateFile(path, maximum)
  sourceDigests.set(path, { size: bytes.length, sha256: sha(bytes) })
  return bytes
}
await remember(statePath, 65536)
await remember(join(source, 'browser-report.json'), 1024 * 1024)
await assertRecoveryDirectory(join(source, 'vault/documents'))
const outputParent = join(project, 'run/mock-signature')
await mkdir(outputParent, { recursive: true, mode: 0o700 })
await assertRecoveryDirectory(outputParent)
const runId = randomUUID(),
  output = join(outputParent, runId)
await mkdir(output, { mode: 0o700 })
await assertRecoveryDirectory(output)
const report = {
  version: 1,
  fakeDataOnly: true,
  notice: mockSignatureNotice,
  runId,
  sourceRunId: sourceId,
  status: 'RUNNING',
  scope: 'MOCK_ADAPTER_SPIKE_NOT_WORKFLOW_ISSUANCE',
  checks: {},
  documents: [],
  sourceBrowserChecks: Object.keys(browser.checks).length,
  sourceResponsiveChecks: browser.responsive.length,
}
await writeFile(join(output, 'source-inventory.json'), before + '\n', { flag: 'wx', mode: 0o600 })
const provider = new MockSignatureProvider({ fakeDataOnly: true }),
  actorId = randomUUID(),
  audit = []
let phase = 'stored-documents'
const record = (action, receipt, result) =>
  audit.push({
    action,
    simulated: true,
    receiptId: receipt.receiptId,
    actorId,
    documentId: receipt.document.documentId,
    roundId: receipt.document.roundId,
    documentSha256: receipt.document.sha256,
    receiptSha256: mockReceiptSha256(receipt),
    outcome: result,
    technicalSignatureStatus: 'NOT_VERIFIED',
    legalEffect: false,
  })
try {
  for (const document of documents) {
    assert.ok(
      document.submission_id === approved.id &&
        document.submission_status === 'APPROVED' &&
        document.status === 'UNSIGNED_DECLARATION',
    )
    assert.ok(
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(document.storage_key),
    )
    assert.ok(['DOCX', 'PDF'].includes(document.format) && [1, 2].includes(document.round_number))
    assert.ok(
      Number.isSafeInteger(document.size) && document.size > 0 && document.size <= 16 * 1024 * 1024,
    )
    const stored = await remember(
      join(source, 'vault/documents', document.storage_key),
      document.size,
    )
    assert.equal(sha(stored), document.sha256)
    const extension = document.format.toLowerCase()
    const downloaded = await remember(
      join(source, `export-round-${document.round_number}.${extension}`),
      document.size,
    )
    assert.deepEqual(downloaded, stored, 'EXPORTED_BYTES_MUST_MATCH_REGISTRY_VAULT')
    assert.equal(
      stored.subarray(0, document.format === 'PDF' ? 5 : 2).toString('ascii'),
      document.format === 'PDF' ? '%PDF-' : 'PK',
    )
    if (document.format === 'PDF')
      assert.equal(
        document.source_docx_sha256,
        documents.find((d) => d.round_id === document.round_id && d.format === 'DOCX')?.sha256,
      )
    const input = {
      bytes: stored,
      actorId,
      document: {
        documentId: document.document_id,
        submissionId: document.submission_id,
        roundId: document.round_id,
        format: document.format,
        size: document.size,
        sha256: document.sha256,
      },
    }
    phase = 'simulate-and-verify'
    const receipt = await provider.sign(input),
      pin = mockReceiptSha256(receipt)
    record('MOCK_SIGN_SIMULATED', receipt, 'SIMULATED')
    await writeFile(
      join(output, document.document_id + '.mock-receipt.json'),
      JSON.stringify(receipt, null, 2) + '\n',
      { flag: 'wx', mode: 0o600 },
    )
    const persisted = await readJson(join(output, document.document_id + '.mock-receipt.json'))
    const result = await provider.verify(persisted, input, pin)
    assert.equal(result.outcome, 'SIMULATION_MATCH')
    assert.equal(result.technicalSignatureStatus, 'NOT_VERIFIED')
    assert.equal(result.legalEffect, false)
    record('MOCK_VERIFY_SIMULATED', receipt, result.outcome)
    const tampered = Buffer.from(stored)
    tampered[tampered.length - 1] ^= 1
    const changed = await provider.verify(persisted, { ...input, bytes: tampered }, pin)
    assert.equal(changed.reason, 'DOCUMENT_CHANGED')
    record('MOCK_VERIFY_SIMULATED', receipt, changed.outcome)
    assert.equal(
      (await provider.verify(persisted, { ...input, actorId: randomUUID() }, pin)).reason,
      'ACTOR_CHANGED',
    )
    assert.equal(
      (
        await provider.verify(
          persisted,
          { ...input, document: { ...input.document, roundId: randomUUID() } },
          pin,
        )
      ).reason,
      'BINDING_CHANGED',
    )
    assert.equal(
      (await provider.verify({ ...persisted, receiptId: randomUUID() }, input, pin)).reason,
      'RECEIPT_CHANGED',
    )
    report.documents.push({
      documentId: document.document_id,
      roundId: document.round_id,
      roundNumber: document.round_number,
      format: document.format,
      size: document.size,
      sha256: document.sha256,
      sourceDocxSha256: document.source_docx_sha256,
      receiptId: receipt.receiptId,
      receiptSha256: pin,
      verification: result,
    })
  }
  report.checks.storedWordPdfMatchRealExportsAndRegistry = true
  report.checks.pdfDerivedFromSameRoundWord = true
  report.checks.persistedReceiptMatchesBothFormatsAndBothRounds = true
  report.checks.changedBytesActorRoundAndReceiptRejected = true
  report.checks.noDigitalValidityOrIssuanceClaim = true
  phase = 'source-unchanged'
  assert.equal(await snapshot(), before)
  for (const [path, digest] of sourceDigests) {
    const bytes = await readPrivateFile(path, digest.size)
    assert.equal(bytes.length, digest.size)
    assert.equal(sha(bytes), digest.sha256)
  }
  report.checks.sourceFilesAndRegistryUnchanged = true
  report.auditEvents = audit.length
  assert.equal(audit.length, 12)
  await writeFile(
    join(output, 'simulation-audit.json'),
    JSON.stringify(
      { version: 1, fakeDataOnly: true, notice: mockSignatureNotice, events: audit },
      null,
      2,
    ) + '\n',
    { flag: 'wx', mode: 0o600 },
  )
  report.checks.separateSimulationAuditSaved = true
  report.status = 'PASS'
} catch {
  report.status = 'FAILED'
  report.phase = phase
  process.exitCode = 1
} finally {
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', {
    flag: 'wx',
    mode: 0o600,
  })
  console.log(
    JSON.stringify({
      event: 'MOCK_SIGNATURE_REHEARSAL',
      runId,
      status: report.status,
      phase,
      documents: report.documents.length,
      checks: report.checks,
    }),
  )
}
