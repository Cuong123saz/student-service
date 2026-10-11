import { unzipSync, strFromU8 } from 'fflate'
import { inspectSubmissionBundle } from './verify-submission-bundle.mjs'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertRecoveryDirectory, fileDigest } from './recovery-bundle.mjs'
import {
  assertDemoState,
  demoAction,
  demoProfile,
  demoPassword,
  demoRunRoot,
} from './workflow-demo.contract.mjs'
import { oldBytes, newBytes, recoveryValues, recoveryStudent } from './recovery-fixture.mjs'
assert.equal(demoAction(process.argv.slice(2), process.env), 'start')
const profile = demoProfile(process.argv.slice(2))
const demoOrigin = profile.webUrl
const projectRoot = fileURLToPath(new URL('../../../', import.meta.url))
const active = JSON.parse(await readFile(resolve(projectRoot, 'run', profile.activeFile), 'utf8'))
const runRoot = demoRunRoot(projectRoot, active.runId)
await assertRecoveryDirectory(runRoot)
const statePath = join(runRoot, 'state.json')
await fileDigest(statePath, 65536)
const state = JSON.parse(await readFile(statePath, 'utf8'))
assertDemoState(state, projectRoot, statePath, profile.kind)
assert.equal(state.status, 'READY')
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.WORKFLOW_PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({
  headless: true,
  ...(process.env.WORKFLOW_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.WORKFLOW_CHROMIUM_EXECUTABLE }
    : {}),
})
const report = {
  version: 1,
  fakeDataOnly: true,
  status: 'RUNNING',
  runId: state.runId,
  startedAt: new Date().toISOString(),
  checks: {},
  responsive: [],
  pageErrors: [],
  cases: [],
}
let phase = 'login'
const fixturePath = (number) =>
  fileURLToPath(new URL('./fixtures/recovery/evidence-round-' + number + '.pdf', import.meta.url))
async function actor(username, admin = false) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await context.newPage()
  context.on('page', (p) => p.on('pageerror', (error) => report.pageErrors.push(error.message)))
  page.on('pageerror', (error) => report.pageErrors.push(error.message))
  await context.route('**/*', (route) =>
    new URL(route.request().url()).hostname === new URL(demoOrigin).hostname
      ? route.continue()
      : route.abort(),
  )
  await page.goto(demoOrigin + (admin ? '/admin/login' : '/login'))
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
async function get(context, path, expected = 200, portal = 'user') {
  const response = await context.request.get(state.apiUrl + '/api/v1/' + portal + path)
  assert.equal(response.status(), expected, path)
  return response.headers()['content-type']?.includes('application/json')
    ? response.json()
    : response.body()
}
async function action(page, method, suffix, perform, expected = 200) {
  const pending = page.waitForResponse(
    (r) => r.request().method() === method && new URL(r.url()).pathname.endsWith(suffix),
  )
  await perform()
  const response = await pending
  assert.equal(response.status(), expected, await response.text())
  return response.json()
}
async function save(page) {
  return action(page, 'PUT', new URL(page.url()).pathname, () =>
    page.getByRole('button', { name: /^Lưu (bản nháp|bổ sung)$/ }).click(),
  )
}
async function fill(page, round) {
  const values = recoveryValues(round)
  for (const key of ['reference', 'purpose', 'completedCredits', 'neededOn'])
    await page.locator('#field-' + key).fill(String(values[key]))
  for (const key of ['purposeType', 'instructionsReceived'])
    await page.locator('#field-' + key).selectOption(String(values[key]))
}
async function responsive(page, label) {
  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
    const dimensions = await page.evaluate(() => ({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
    }))
    assert.ok(dimensions.document <= dimensions.viewport + 1, label + ' overflows ' + width)
    report.responsive.push({ screen: label, width, overflow: false })
    if (width === 375 || width === 1440)
      await page.screenshot({
        path: join(runRoot, label + '-' + width + '.png'),
        fullPage: true,
        animations: 'disabled',
      })
  }
}
async function submit(page, supplement = false) {
  await page.getByRole('button', { name: 'Xem lại thông tin', exact: true }).click()
  assert.equal(
    await page
      .getByRole('complementary', { name: 'Xem lại thông tin' })
      .evaluate((el) => el === document.activeElement),
    true,
  )
  await page.locator('#confirm-submission').check()
  return action(page, 'POST', '/submit', () =>
    page
      .getByRole('button', { name: supplement ? 'Gửi bổ sung' : 'Gửi hồ sơ', exact: true })
      .click(),
  )
}
async function decide(page, decision, note) {
  await page.locator('#resolution-action').selectOption(decision)
  assert.equal(
    await page.getByRole('button', { name: 'Xem lại quyết định', exact: true }).isDisabled(),
    true,
  )
  await page.locator('#resolution-note').fill(note)
  await page.getByRole('button', { name: 'Xem lại quyết định', exact: true }).click()
  assert.equal(
    await page
      .locator('[aria-label="Xem lại quyết định"]')
      .evaluate((el) => el === document.activeElement),
    true,
  )
  assert.equal(
    await page.getByRole('button', { name: 'Ghi quyết định', exact: true }).isDisabled(),
    true,
  )
  await page.locator('#resolution-confirm').check()
  return action(page, 'POST', '/resolve', () =>
    page.getByRole('button', { name: 'Ghi quyết định', exact: true }).click(),
  )
}
async function create(page, serviceId) {
  await page.goto(demoOrigin + '/services/' + serviceId)
  await page.getByRole('button', { name: 'Kê khai / tiếp tục bản nháp', exact: true }).click()
  await page.waitForURL('**/submissions/*')
  await page.locator('#field-fullName').waitFor()
  assert.equal(await page.locator('#field-fullName').inputValue(), recoveryStudent.fullName)
  assert.equal(await page.locator('#field-fullName').getAttribute('readonly'), '')
  return new URL(page.url()).pathname.split('/').at(-1)
}
async function upload(page, round) {
  return action(page, 'POST', '/attachments/proof', () =>
    page.locator('#upload-proof').setInputFiles(fixturePath(round)),
  )
}
async function download(page, locator, bytes, label) {
  const pending = page.waitForEvent('download', { timeout: 120000 })
  await locator.click()
  const file = await pending,
    path = join(runRoot, label + '.pdf')
  await file.saveAs(path)
  assert.deepEqual(await readFile(path), bytes)
}
async function exportDocument(page, roundNumber, format, label) {
  const panel = page
    .getByRole('region', { name: 'Phiếu hồ sơ lần gửi ' + roundNumber, exact: true })
    .first()
  const pending = page.waitForEvent('download', { timeout: 120000 })
  await panel
    .getByRole('button', { name: format === 'docx' ? 'Tải Word' : 'Tải PDF', exact: true })
    .click()
  const download = await Promise.race([
    pending,
    panel
      .getByRole('alert')
      .waitFor({ state: 'visible', timeout: 120000 })
      .then(async () => {
        throw new Error('DOCUMENT_EXPORT_FAILED: ' + (await panel.getByRole('alert').innerText()))
      }),
  ])
  const path = join(runRoot, label + '.' + format)
  await download.saveAs(path)
  const bytes = await readFile(path)
  if (format === 'docx') {
    const content = strFromU8(unzipSync(bytes)['word/document.xml'])
    for (const value of [
      recoveryStudent.fullName,
      recoveryStudent.studentCode,
      recoveryValues(roundNumber).purpose,
      roundNumber === 1 ? 'Không' : 'Có',
    ])
      assert.ok(content.includes(value), value)
    assert.ok(!content.includes('{{fieldValue}}'))
  } else assert.equal(bytes.subarray(0, 5).toString('ascii'), '%PDF-')
  return bytes
}

async function exportBundle(page, roundNumber, label, expectedEvidence) {
  const panel = page
    .getByRole('region', { name: 'Phiếu hồ sơ lần gửi ' + roundNumber, exact: true })
    .first()
  const pending = page.waitForEvent('download', { timeout: 120000 })
  await panel.getByRole('button', { name: 'Tải trọn bộ hồ sơ', exact: true }).click()
  const downloaded = await Promise.race([
      pending,
      panel
        .getByRole('alert')
        .waitFor({ state: 'visible', timeout: 120000 })
        .then(async () => {
          throw new Error('BUNDLE_EXPORT_FAILED: ' + (await panel.getByRole('alert').innerText()))
        }),
    ]),
    path = join(runRoot, label + '.zip')
  await downloaded.saveAs(path)
  const bytes = await readFile(path),
    result = inspectSubmissionBundle(bytes)
  assert.equal(result.roundNumber, roundNumber)
  const parts = unzipSync(bytes),
    manifest = JSON.parse(strFromU8(parts['manifest.json']))
  const evidence = manifest.files.filter((item) => item.kind === 'EVIDENCE')
  assert.equal(evidence.length, 1)
  assert.deepEqual(Buffer.from(parts[evidence[0].path]), expectedEvidence)
  const content = strFromU8(unzipSync(parts['phieu-ho-so.docx'])['word/document.xml'])
  assert.ok(content.includes(recoveryValues(roundNumber).purpose))
  return { parts, manifest }
}

try {
  const owner = await actor('demo.sinhvien'),
    reviewer = await actor('demo.canbo'),
    other = await actor('demo.svkhac'),
    foreign = await actor('demo.ngoai')
  const approveService = state.services.find((s) => s.purpose === 'approve'),
    rejectService = state.services.find((s) => s.purpose === 'reject')
  phase = 'draft-and-types'
  const id = await create(owner.page, approveService.id)
  await save(owner.page)
  await owner.page.getByRole('button', { name: 'Xem lại thông tin', exact: true }).click()
  assert.equal(
    await owner.page.getByRole('button', { name: 'Gửi hồ sơ', exact: true }).isDisabled(),
    true,
  )
  assert.ok(
    (await owner.page
      .getByRole('complementary', { name: 'Xem lại thông tin' })
      .getByRole('link')
      .count()) > 0,
  )
  await fill(owner.page, 1)
  const saved = await save(owner.page)
  assert.equal(saved.values.completedCredits, 0)
  assert.equal(saved.values.instructionsReceived, false)
  await upload(owner.page, 1)
  await responsive(owner.page, 'student-draft')
  const submitted = await submit(owner.page)
  assert.equal(submitted.status, 'SUBMITTED')
  assert.equal(
    await owner.page.getByRole('button', { name: 'Lưu bản nháp', exact: true }).count(),
    0,
  )
  if (profile.kind !== 'workflow') {
    await exportDocument(owner.page, 1, 'docx', 'export-round-1')
    await exportDocument(owner.page, 1, 'pdf', 'export-round-1')
    if (profile.kind === 'bundles') await exportBundle(owner.page, 1, 'bundle-round-1', oldBytes)
    report.checks.exportAvailableImmediatelyAfterSubmit = true
  }
  report.checks.requiredFieldsProfileAndExactTypes = true
  phase = 'scope-and-ownership'
  await get(owner.context, '/review-submissions', 403)
  await get(other.context, '/submissions/' + id, 404)
  await get(other.context, '/submissions/' + id + '/files/' + submitted.files[0].id, 404)
  const foreignQueue = await get(foreign.context, '/review-submissions')
  assert.ok(!foreignQueue.items.some((item) => item.id === id))
  await foreign.page.goto(demoOrigin + '/review-submissions/' + id)
  await foreign.page.getByRole('alert').waitFor()
  assert.equal(await foreign.page.locator('#resolution-action').count(), 0)
  await get(foreign.context, '/review-submissions/' + id, 404)
  await get(foreign.context, '/review-submissions/' + id + '/files/' + submitted.files[0].id, 404)
  const anonymous = await browser.newContext()
  await get(anonymous, '/submissions/' + id, 401)
  await anonymous.close()
  if (profile.kind !== 'workflow') {
    await get(other.context, '/submissions/' + id + '/rounds/1/documents/docx', 404)
    await get(foreign.context, '/review-submissions/' + id + '/rounds/1/documents/docx', 404)
    if (profile.kind === 'bundles') {
      await get(other.context, '/submissions/' + id + '/rounds/1/bundle', 404)
      await get(foreign.context, '/review-submissions/' + id + '/rounds/1/bundle', 404)
    }
  }
  report.checks.studentAndOutsideScopeDenied = true
  phase = 'supplement-request'
  await reviewer.page.goto(demoOrigin + '/review-submissions')
  await reviewer.page.locator('a[href="/review-submissions/' + id + '"]').waitFor()
  await reviewer.page.locator('a[href="/review-submissions/' + id + '"]').click()
  const claimed = await action(reviewer.page, 'POST', '/claim', () =>
    reviewer.page.getByRole('button', { name: 'Nhận xử lý', exact: true }).click(),
  )
  assert.equal(claimed.status, 'IN_REVIEW')
  await decide(
    reviewer.page,
    'REQUEST_SUPPLEMENT',
    'DEMO: Bổ sung minh chứng lần hai và cập nhật mục đích.',
  )
  phase = 'notification-and-supplement'
  await owner.page.goto(demoOrigin + '/notifications')
  await owner.page.locator('.notice-card').first().waitFor()
  const notices = await get(owner.context, '/notifications')
  assert.ok(notices.unreadCount > 0)
  const notice = notices.items.find((n) => n.targetUrl === '/submissions/' + id && !n.readAt)
  assert.ok(notice)
  const card = owner.page.locator('[data-notification-id="' + notice.id + '"]')
  await card.getByRole('button', { name: 'Mở hồ sơ', exact: true }).click()
  await owner.page.waitForURL('**/submissions/' + id)
  await owner.page.getByText('Chờ bổ sung', { exact: true }).first().waitFor()
  assert.equal((await get(owner.context, '/notifications')).unreadCount, notices.unreadCount - 1)
  await action(owner.page, 'DELETE', '/files/' + submitted.files[0].id, () =>
    owner.page
      .getByRole('button', { name: 'Gỡ minh chứng evidence-round-1.pdf', exact: true })
      .click(),
  )
  await fill(owner.page, 2)
  await save(owner.page)
  await upload(owner.page, 2)
  const resubmitted = await submit(owner.page, true)
  assert.equal(resubmitted.status, 'IN_REVIEW')
  assert.equal(resubmitted.rounds.length, 2)
  assert.deepEqual(resubmitted.rounds[0].values, { ...recoveryStudent, ...recoveryValues(1) })
  assert.deepEqual(resubmitted.rounds[1].values, { ...recoveryStudent, ...recoveryValues(2) })
  report.checks.notificationOpenedAndRead = true
  report.checks.supplementPreservesTypedHistory = true
  phase = 'approve'
  await reviewer.page.goto(demoOrigin + '/review-submissions/' + id)
  await reviewer.page.locator('#resolution-action').waitFor()
  const approved = await decide(
    reviewer.page,
    'APPROVE',
    'DEMO: Đã đối chiếu đủ dữ liệu giả, chấp thuận nội dung; chưa cấp văn bản.',
  )
  assert.equal(approved.status, 'APPROVED')
  const duplicate = await reviewer.context.request.post(
    state.apiUrl + '/api/v1/user/review-submissions/' + id + '/resolve',
    {
      headers: { Origin: demoOrigin },
      data: {
        expectedRevision: resubmitted.revision,
        action: 'APPROVE',
        note: 'DEMO: Đã đối chiếu đủ dữ liệu giả, chấp thuận nội dung; chưa cấp văn bản.',
      },
    },
  )
  assert.equal(duplicate.status(), 200)
  assert.equal((await duplicate.json()).revision, approved.revision)
  const after = await get(reviewer.context, '/review-submissions/' + id)
  assert.equal(after.events.filter((e) => e.action === 'APPROVED').length, 1)
  assert.equal(after.events.filter((e) => e.action === 'CLAIMED').length, 1)
  assert.equal(typeof claimed.reviewerName, 'string')
  assert.ok(claimed.reviewerName.length > 0)
  assert.equal(after.reviewerName, claimed.reviewerName)
  assert.equal(after.events.find((e) => e.action === 'APPROVED').actorName, claimed.reviewerName)
  assert.deepEqual(
    after.events.map((e) => e.action),
    ['SUBMITTED', 'CLAIMED', 'SUPPLEMENT_REQUESTED', 'RESUBMITTED', 'APPROVED'],
  )
  for (const file of [...after.files, ...after.rounds.flatMap((round) => round.files)])
    assert.equal(file.signatureStatus, 'NOT_CHECKED')
  report.checks.sameReviewerAndSingleClaim = true
  report.checks.signatureRemainsUnchecked = true
  await responsive(reviewer.page, 'reviewer-approved')
  await owner.page.goto(demoOrigin + '/submissions/' + id)
  await owner.page.getByText('Đã duyệt nội dung', { exact: true }).first().waitFor()
  assert.equal(
    await owner.page.getByRole('button', { name: 'Lưu bổ sung', exact: true }).count(),
    0,
  )
  const history = owner.page.locator('section[aria-label="Lịch sử hồ sơ"]')
  await history.locator('summary').first().click()
  await download(
    owner.page,
    history.getByRole('link', { name: 'evidence-round-1.pdf', exact: true }),
    oldBytes,
    'downloaded-history-round-1',
  )
  await get(owner.context, '/submissions/' + id + '/files/' + submitted.files[0].id, 404)
  await download(
    owner.page,
    owner.page.getByRole('link', { name: 'evidence-round-2.pdf', exact: true }).first(),
    newBytes,
    'downloaded-current-round-2',
  )
  if (profile.kind !== 'workflow') {
    await exportDocument(owner.page, 2, 'docx', 'export-round-2')
    await exportDocument(owner.page, 2, 'pdf', 'export-round-2')
    const historical = await exportDocument(owner.page, 1, 'docx', 'export-history-round-1')
    assert.deepEqual(historical, await readFile(join(runRoot, 'export-round-1.docx')))
    await exportDocument(reviewer.page, 2, 'docx', 'export-reviewer-round-2')
    if (profile.kind === 'bundles') {
      await exportBundle(owner.page, 2, 'bundle-round-2', newBytes)
      const historicalBundle = await exportBundle(owner.page, 1, 'bundle-history-round-1', oldBytes)
      const originalBundle = unzipSync(await readFile(join(runRoot, 'bundle-round-1.zip')))
      assert.deepEqual(
        historicalBundle.parts['phieu-ho-so.docx'],
        originalBundle['phieu-ho-so.docx'],
      )
      await exportBundle(reviewer.page, 2, 'bundle-reviewer-round-2', newBytes)
      report.checks.bundleWordPdfEvidenceAndHistoricalIsolation = true
    }
    report.checks.wordPdfAndFrozenHistoricalExport = true
  }
  await responsive(owner.page, 'student-approved')
  report.checks.approveAndIdempotency = true
  report.checks.currentAndHistoricalPdfDownloads = true
  report.cases.push({ id, serviceId: approveService.id, status: 'APPROVED', rounds: 2 })
  phase = 'reject'
  const rejectedId = await create(owner.page, rejectService.id)
  await fill(owner.page, 1)
  await save(owner.page)
  await upload(owner.page, 1)
  await submit(owner.page)
  await reviewer.page.goto(demoOrigin + '/review-submissions/' + rejectedId)
  await action(reviewer.page, 'POST', '/claim', () =>
    reviewer.page.getByRole('button', { name: 'Nhận xử lý', exact: true }).click(),
  )
  const rejected = await decide(
    reviewer.page,
    'REJECT',
    'DEMO: Nội dung giả định không thuộc phạm vi hỗ trợ của thủ tục này.',
  )
  assert.equal(rejected.status, 'REJECTED')
  await owner.page.goto(demoOrigin + '/submissions/' + rejectedId)
  await owner.page.getByText('Không chấp thuận', { exact: true }).first().waitFor()
  assert.equal(await owner.page.getByRole('button', { name: 'Gửi hồ sơ', exact: true }).count(), 0)
  report.checks.rejectAndLock = true
  report.cases.push({ id: rejectedId, serviceId: rejectService.id, status: 'REJECTED', rounds: 1 })
  phase = 'admin-and-offline'
  const admin = await actor('demo.canbo', true)
  await admin.page.goto(demoOrigin + '/admin/review-submissions/' + id)
  await admin.page.getByText('Đã duyệt nội dung', { exact: true }).first().waitFor()
  if (profile.kind !== 'workflow') {
    await exportDocument(admin.page, 2, 'pdf', 'export-admin-round-2')
    if (profile.kind === 'bundles')
      await exportBundle(admin.page, 2, 'bundle-admin-round-2', newBytes)
    report.checks.adminDocumentExport = true
  }
  await responsive(admin.page, 'admin-approved')
  await get(owner.context, '/review-submissions/' + id, 401, 'admin')
  await get(admin.context, '/review-submissions/' + id, 401, 'user')
  const offline = state.services.find((s) => s.purpose === 'offline')
  await owner.page.goto(demoOrigin + '/services/' + offline.id)
  await owner.page
    .getByText('Sinh viên làm việc trực tiếp tại Phòng CTSV.', { exact: true })
    .waitFor()
  assert.equal(
    await owner.page
      .getByRole('button', { name: 'Kê khai / tiếp tục bản nháp', exact: true })
      .count(),
    0,
  )
  await owner.page.goto(demoOrigin + '/notifications')
  await owner.page.locator('.notice-card').first().waitFor()
  await responsive(owner.page, 'student-notifications')
  const all = await get(owner.context, '/submissions')
  assert.ok(Array.isArray(all))
  assert.deepEqual(all.map((item) => item.id).sort(), [id, rejectedId].sort())
  report.checks.portalSessionsSeparated = true
  report.checks.studentConfirmationOffline = true
  report.checks.practiceServiceUntouched = true
  assert.deepEqual(report.pageErrors, [])
  report.status = 'PASS'
} catch (error) {
  report.status = 'FAIL'
  report.failure = { phase, message: error.message.slice(0, 1200) }
  console.error('WORKFLOW_BROWSER_FAILED ' + phase + ' ' + error.message.slice(0, 800))
  process.exitCode = 1
} finally {
  report.finishedAt = new Date().toISOString()
  await browser.close()
  await writeFile(join(runRoot, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(
    'WORKFLOW_BROWSER_RESULT ' +
      JSON.stringify({ status: report.status, reportPath: join(runRoot, 'browser-report.json') }),
  )
}
