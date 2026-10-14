// One-shot, parent-owned acceptance. Synthetic workflow only, never a legal signature.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
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
  demoPassword,
} from './workflow-demo.contract.mjs'
import {
  collectDocumentRegistryAssets,
  readDocumentRegistrySnapshot,
  registrySnapshotDigest,
} from './document-registry-inventory.mjs'
assert.ok(process.send && process.connected, 'REQUIRES_SPRINT7_DEMO_PARENT')
assert.equal(process.argv.length, 2, 'NO_SPRINT7_CHECKER_ARGUMENTS')
const project = fileURLToPath(new URL('../../../', import.meta.url))
const statePath = process.env.WORKFLOW_SPRINT7_STATE_PATH
const state = JSON.parse((await readRecoveryPrivateFile(statePath, 65536)).toString('utf8'))
const root = assertDemoState(state, project, statePath, 'sprint7')
assert.equal(state.status, 'READY')
const notice = 'DEMO – KHÔNG CÓ GIÁ TRỊ PHÁP LÝ'
const report = {
  version: 1,
  fakeDataOnly: true,
  status: 'RUNNING',
  runId: state.runId,
  checks: {},
  responsive: [],
  pageErrors: [],
  screenshots: [],
  legalEffect: false,
  technicalSignatureStatus: 'NOT_VERIFIED',
  productionReadiness: 'NOT_READY',
}
let sql,
  browser,
  phase = 'base-workflow'
try {
  process.argv.push('--fake-data-only', '--sprint7')
  await import('./check-workflow-demo.mjs')
  assert.ok(!process.exitCode, 'SPRINT7_BASE_BROWSER_FAILED')
  const base = JSON.parse(
    (await readRecoveryPrivateFile(join(root, 'browser-report.json'), 1048576)).toString('utf8'),
  )
  assert.ok(
    base.status === 'PASS' &&
      base.runId === state.runId &&
      Object.values(base.checks).every((v) => v === true),
  )
  report.checks.baseWorkflowPassed = true
  const { stdout } = await promisify(execFile)(
    'docker',
    ['inspect', 'student-service-workflow-demo-' + state.runId],
    { windowsHide: true, timeout: 15000, maxBuffer: 1048576 },
  )
  const info = JSON.parse(stdout)[0]
  assertDemoContainer(info, state.runId, info.Id)
  assert.equal(info.State.Running, true)
  // Only read the already-verified owned synthetic container's random credential, in memory.
  const ports = info.NetworkSettings.Ports['5432/tcp']
  assert.equal(ports.length, 1)
  assert.equal(ports[0].HostIp, '127.0.0.1')
  const passwords = info.Config.Env.filter((v) => v.startsWith('POSTGRES_PASSWORD='))
  assert.equal(passwords.length, 1)
  const secret = passwords[0].slice('POSTGRES_PASSWORD='.length)
  assert.ok(/^[a-f0-9]{48}$/.test(secret), 'INVALID_OWNED_SYNTHETIC_CREDENTIAL')
  const url = new URL('postgres://postgres@127.0.0.1:' + ports[0].HostPort + '/' + demoDatabase)
  url.password = secret
  assertDemoDatabase(url.href)
  sql = postgres(url.href, { max: 1, connect_timeout: 5, onnotice: () => {} })
  const inventoryOptions = {
    sql,
    templateRoot: join(root, 'vault/templates'),
    documentRoot: join(root, 'vault/documents'),
    stagingRoot: join(root, 'vault/staging'),
  }
  const before = await readDocumentRegistrySnapshot(sql)
  const assetsBefore = await collectDocumentRegistryAssets(inventoryOptions)
  assert.equal(assetsBefore.documents.length, 6)
  assert.equal(before.jobs.length, 6)
  assert.ok(
    before.jobs.every((j) => j.state === 'COMPLETE' && j.attempts === 1 && j.errorCode === null),
  )
  assert.equal(before.retries.length, 0)
  const sourceSnapshot = async () => {
    const result = {}
    for (const table of ['submissions', 'submission_rounds', 'submission_files'])
      result[table] = [...(await sql.unsafe('SELECT * FROM ' + table + ' ORDER BY id'))]
    return registrySnapshotDigest(result)
  }
  const sourceBefore = await sourceSnapshot()
  const approved = base.cases.find((c) => c.status === 'APPROVED'),
    rejected = base.cases.find((c) => c.status === 'REJECTED')
  assert.equal(approved.rounds, 2)
  assert.equal(rejected.rounds, 1)
  for (const [id, number] of [
    [approved.id, 1],
    [approved.id, 2],
    [rejected.id, 1],
  ]) {
    const pair = assetsBefore.documents.filter(
      (d) => d.submissionId === id && d.roundNumber === number,
    )
    assert.equal(pair.length, 2)
    assert.equal(
      pair.find((d) => d.format === 'PDF').sourceDocxSha256,
      pair.find((d) => d.format === 'DOCX').sha256,
    )
  }
  const require = createRequire(import.meta.url)
  const { chromium } = require(process.env.WORKFLOW_PLAYWRIGHT_MODULE || 'playwright')
  browser = await chromium.launch({
    headless: true,
    ...(process.env.WORKFLOW_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.WORKFLOW_CHROMIUM_EXECUTABLE }
      : {}),
  })
  async function actor(username, admin = false) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
      page = await context.newPage()
    page.on('pageerror', (error) => report.pageErrors.push(error.message))
    await context.route('**/*', (route) =>
      new URL(route.request().url()).hostname === new URL(state.webUrl).hostname
        ? route.continue()
        : route.abort(),
    )
    await page.goto(state.webUrl + (admin ? '/admin/login' : '/login'))
    await page.waitForFunction(() => Boolean(document.querySelector('#__nuxt')?.__vue_app__))
    await page.waitForLoadState('networkidle')
    await page.getByLabel('Tên đăng nhập', { exact: true }).fill(username)
    await page.getByLabel('Mật khẩu', { exact: true }).fill(demoPassword)
    await page
      .getByRole('button', { name: admin ? 'Đăng nhập' : 'Đăng nhập vào hệ thống', exact: true })
      .click()
    await page.waitForURL(admin ? /\/admin\/?$/ : '**/portal')
    return { context, page }
  }
  async function get(actor, path, expected = 200) {
    const response = await actor.context.request.get(state.apiUrl + '/api/v1/' + path)
    assert.equal(response.status(), expected, path)
    if (expected === 200) assert.match(response.headers()['cache-control'], /no-store/)
    return response.json()
  }
  async function post(actor, path, data, expected = 200) {
    const response = await actor.context.request.post(state.apiUrl + '/api/v1/' + path, {
      headers: { Origin: state.webUrl },
      data,
    })
    assert.equal(response.status(), expected, path)
    return response.json()
  }
  async function panel(actor, portal) {
    await actor.page.goto(
      state.webUrl +
        (portal === 'admin' ? '/admin' : '') +
        (portal === 'owner' ? '/submissions/' : '/review-submissions/') +
        approved.id,
    )
    const documents = actor.page
      .getByRole('region', { name: 'Phiếu hồ sơ lần gửi 2', exact: true })
      .first()
    await documents
      .getByRole('button', { name: 'Kiểm tra tình trạng tài liệu', exact: true })
      .click()
    const region = documents.getByRole('region', { name: 'Ký mô phỏng lần gửi 2', exact: true })
    await region.waitFor()
    await region.getByRole('heading', { name: 'Word', exact: true }).waitFor()
    assert.ok((await region.innerText()).includes(notice))
    return region
  }
  async function action(actor, region, label, suffix) {
    const pending = actor.page.waitForResponse(
      (r) => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith(suffix),
    )
    await region.getByRole('button', { name: label, exact: true }).click()
    const response = await pending
    assert.equal(response.status(), 200, await response.text())
    const value = await response.json()
    assert.equal(value.legalEffect, false)
    assert.equal(value.technicalSignatureStatus, 'NOT_VERIFIED')
    assert.equal(value.notice, notice)
    await region.getByRole('button', { name: 'Tải lại kết quả mô phỏng', exact: true }).waitFor()
    return { value, request: response.request().postDataJSON() }
  }
  async function responsive(actor, region, label) {
    for (const width of [375, 768, 1024, 1440]) {
      await actor.page.setViewportSize({ width, height: 1100 })
      await region.scrollIntoViewIfNeeded()
      const size = await actor.page.evaluate(() => ({
        viewport: innerWidth,
        document: document.documentElement.scrollWidth,
      }))
      assert.ok(size.document <= size.viewport + 1, label + ' overflow ' + width)
      report.responsive.push({ screen: label, width, overflow: false })
      if (width === 375 || width === 1440) {
        const name = 'sprint7-' + label + '-' + width + '.png'
        await region.screenshot({ path: join(root, name), animations: 'disabled' })
        report.screenshots.push(name)
      }
    }
  }
  phase = 'signing-workflow'
  const reviewer = await actor('demo.canbo'),
    owner = await actor('demo.sinhvien'),
    foreign = await actor('demo.ngoai'),
    admin = await actor('demo.canbo', true)
  const reviewBase = 'user/review-submissions/' + approved.id + '/rounds/2'
  const ownerBase = 'user/submissions/' + approved.id + '/rounds/2'
  let region = await panel(reviewer, 'user')
  const status = await get(reviewer, reviewBase + '/mock-signatures')
  assert.ok(status.documents.every((d) => d.stored && d.canSign && !d.receipt))
  const revision = status.documents[0].expectedRevision
  await post(
    reviewer,
    reviewBase + '/documents/docx/mock-sign',
    { requestId: randomUUID(), expectedRevision: revision - 1 },
    409,
  )
  await post(
    owner,
    reviewBase + '/documents/docx/mock-sign',
    { requestId: randomUUID(), expectedRevision: revision },
    403,
  )
  await post(
    foreign,
    reviewBase + '/documents/docx/mock-sign',
    { requestId: randomUUID(), expectedRevision: revision },
    404,
  )
  await post(
    reviewer,
    'user/review-submissions/' + approved.id + '/rounds/1/documents/docx/mock-sign',
    { requestId: randomUUID(), expectedRevision: revision },
    403,
  )
  report.checks.staleOwnerScopeAndOldRoundDenied = true
  const signs = []
  for (const [format, label] of [
    ['docx', 'Word'],
    ['pdf', 'PDF'],
  ]) {
    await region.getByRole('button', { name: 'Xem lại ký mô phỏng ' + label, exact: true }).click()
    const confirmation = region.getByRole('group', { name: 'Xem lại ký mô phỏng', exact: true })
    assert.equal(await confirmation.evaluate((el) => el === document.activeElement), true)
    assert.equal(
      await confirmation
        .getByRole('button', { name: 'Xác nhận ký mô phỏng ' + label, exact: true })
        .isDisabled(),
      true,
    )
    if (format === 'docx') await responsive(reviewer, region, 'confirmation')
    await confirmation.getByRole('checkbox').check()
    signs.push(
      await action(
        reviewer,
        region,
        'Xác nhận ký mô phỏng ' + label,
        '/documents/' + format + '/mock-sign',
      ),
    )
    await region.getByRole('button', { name: 'Đối chiếu mô phỏng ' + label, exact: true }).waitFor()
  }
  report.checks.explicitConfirmationAndFocus = true
  assert.equal(
    (await post(reviewer, reviewBase + '/documents/docx/mock-sign', signs[0].request)).replayed,
    true,
  )
  await post(
    admin,
    reviewBase + '/documents/docx/mock-sign',
    { requestId: randomUUID(), expectedRevision: revision },
    401,
  )
  report.checks.signReplayAndPortalIsolation = true
  assert.equal(await region.getByRole('button', { name: /^Xem lại ký mô phỏng/ }).count(), 0)
  for (const label of ['Word', 'PDF'])
    assert.equal(
      (
        await action(
          reviewer,
          region,
          'Đối chiếu mô phỏng ' + label,
          label === 'Word' ? '/documents/docx/mock-verify' : '/documents/pdf/mock-verify',
        )
      ).value.outcome,
      'SIMULATION_MATCH',
    )
  await responsive(reviewer, region, 'reviewer-signed')
  report.checks.reviewerVerifiedPinnedBytes = true
  phase = 'owner-and-admin-verification'
  region = await panel(owner, 'owner')
  assert.equal(await region.getByRole('button', { name: /^Xem lại ký mô phỏng/ }).count(), 0)
  let ownerCheck
  for (const label of ['Word', 'PDF']) {
    const check = await action(
      owner,
      region,
      'Đối chiếu mô phỏng ' + label,
      label === 'Word' ? '/documents/docx/mock-verify' : '/documents/pdf/mock-verify',
    )
    assert.equal(check.value.outcome, 'SIMULATION_MATCH')
    if (label === 'Word') ownerCheck = check
  }
  assert.equal(
    (await post(owner, ownerBase + '/documents/docx/mock-verify', ownerCheck.request)).replayed,
    true,
  )
  await post(
    owner,
    ownerBase + '/documents/pdf/mock-verify',
    { requestId: randomUUID(), receiptId: signs[0].value.id },
    404,
  )
  await responsive(owner, region, 'owner-verified')
  report.checks.ownerVerifiesWithoutSigningRights = true
  region = await panel(admin, 'admin')
  for (const label of ['Word', 'PDF'])
    assert.equal(
      (
        await action(
          admin,
          region,
          'Đối chiếu mô phỏng ' + label,
          label === 'Word' ? '/documents/docx/mock-verify' : '/documents/pdf/mock-verify',
        )
      ).value.outcome,
      'SIMULATION_MATCH',
    )
  await responsive(admin, region, 'admin-verified')
  report.checks.adminVerificationAndWrongReceiptDenied = true
  phase = 'read-only-final-inventory'
  const assets = await collectDocumentRegistryAssets(inventoryOptions)
  assert.equal(
    registrySnapshotDigest(await readDocumentRegistrySnapshot(sql)),
    registrySnapshotDigest(before),
  )
  assert.equal(registrySnapshotDigest(assets), registrySnapshotDigest(assetsBefore))
  assert.equal(await sourceSnapshot(), sourceBefore)
  const receipts = [...(await sql`SELECT * FROM mock_signature_receipts ORDER BY id`)]
  const checks = [...(await sql`SELECT * FROM mock_signature_checks ORDER BY id`)]
  const audits = [
    ...(await sql`SELECT action,resource_id,outcome,metadata FROM audit_logs WHERE action IN ('document.mock_signed','document.mock_verified') ORDER BY action,resource_id`),
  ]
  assert.equal(receipts.length, 2)
  assert.equal(checks.length, 6)
  assert.equal(audits.length, 8)
  for (const receipt of receipts) {
    const d = assets.documents.find((d) => d.documentId === receipt.document_id)
    assert.equal(d.submissionId, approved.id)
    assert.equal(d.roundNumber, 2)
    assert.deepEqual(receipt.receipt.document, {
      documentId: d.documentId,
      submissionId: d.submissionId,
      roundId: d.roundId,
      format: d.format,
      size: d.size,
      sha256: d.sha256,
    })
    assert.equal(receipt.receipt.notice, notice)
    assert.equal(receipt.receipt.fakeDataOnly, true)
    assert.equal(
      audits.filter((a) => a.action === 'document.mock_signed' && a.resource_id === receipt.id)
        .length,
      1,
    )
  }
  for (const check of checks) {
    assert.equal(check.result.outcome, 'SIMULATION_MATCH')
    assert.equal(check.result.legalEffect, false)
    assert.equal(check.result.technicalSignatureStatus, 'NOT_VERIFIED')
    assert.equal(
      audits.filter((a) => a.action === 'document.mock_verified' && a.resource_id === check.id)
        .length,
      1,
    )
  }
  assert.ok(
    audits.every(
      (a) =>
        a.metadata.legalEffect === false &&
        a.metadata.fakeDataOnly === true &&
        a.outcome === 'SUCCESS',
    ),
  )
  assert.deepEqual(report.pageErrors, [])
  report.checks.originalFilesAndDossierUnchanged = true
  report.checks.receiptsChecksAndAuditExactCounts = true
  report.checks.noLegalSignatureOrIssuance = true
  report.counts = { documents: 6, jobs: 6, signatures: 2, verifications: 6, audits: 8 }
  await writeFile(
    join(root, 'sprint7-document-inventory.json'),
    JSON.stringify(
      {
        version: 1,
        status: 'PASS',
        fakeDataOnly: true,
        runId: state.runId,
        mode: 'OBSERVATIONAL_READ_ONLY',
        signaturesChecked: false,
        mockWorkflowChecked: true,
        legalEffect: false,
        productionReadiness: 'NOT_READY',
        sourceSnapshotSha256: sourceBefore,
        registry: before,
        assets,
        receipts,
        checks,
        audits,
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx', mode: 0o600 },
  )
  report.status = 'PASS'
} catch (error) {
  report.status = 'FAIL'
  report.failure = { phase, message: error.message.slice(0, 1200) }
  console.error('SPRINT7_ACCEPTANCE_FAILED ' + phase + ' ' + error.message.slice(0, 800))
  process.exitCode = 1
} finally {
  if (browser) await browser.close()
  if (sql) await sql.end()
  report.finishedAt = new Date().toISOString()
  await writeFile(
    join(root, 'sprint7-browser-report.json'),
    JSON.stringify(report, null, 2) + '\n',
    { flag: 'wx', mode: 0o600 },
  )
  console.log(
    'SPRINT7_ACCEPTANCE_RESULT ' +
      JSON.stringify({ status: report.status, runId: state.runId, counts: report.counts }),
  )
  if (process.connected) process.disconnect()
}
