// Private, one-shot browser child. Real API/DB/LibreOffice; no intercepted responses.
import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'
import { assertDemoState, claimDemoBrowserRun, demoPassword } from './workflow-demo.contract.mjs'
import { recoveryValues } from './recovery-fixture.mjs'
const projectRoot = fileURLToPath(new URL('../../../', import.meta.url))
assert.ok(process.send && process.connected, 'REQUIRES_RETRY_DEMO_PARENT')
const statePath = process.env.WORKFLOW_RETRY_STATE_PATH
const state = JSON.parse(await readFile(statePath, 'utf8'))
const root = assertDemoState(state, projectRoot, statePath, 'retry')
assert.equal(state.status, 'READY')
await claimDemoBrowserRun(projectRoot, state.runId)
const pending = new Map()
process.on('message', (m) => {
  if (m?.type !== 'RETRY_REHEARSAL_RESULT') return
  pending.get(m.requestId)?.(m)
})
async function control(type, values = {}) {
  const requestId = randomUUID()
  try {
    return await new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error('RETRY_CONTROL_TIMEOUT')), 15000)
      pending.set(requestId, (m) => {
        clearTimeout(timer)
        m.ok ? res(m.snapshot) : rej(new Error('RETRY_CONTROL_REFUSED'))
      })
      process.send({ type, requestId, ...values })
    })
  } finally {
    pending.delete(requestId)
  }
}
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
  runId: state.runId,
  status: 'RUNNING',
  checks: {},
  pageErrors: [],
  responsive: [],
}
let phase = 'login'
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
async function actor(username) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await context.newPage()
  page.on('pageerror', (e) => report.pageErrors.push(e.message))
  await context.route('**/*', (route) =>
    new URL(route.request().url()).hostname === new URL(state.webUrl).hostname
      ? route.continue()
      : route.abort(),
  )
  await page.goto(state.webUrl + '/login')
  await page.waitForFunction(() => Boolean(document.querySelector('#__nuxt')?.__vue_app__))
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Tên đăng nhập', { exact: true }).fill(username)
  await page.getByLabel('Mật khẩu', { exact: true }).fill(demoPassword)
  await page.getByRole('button', { name: 'Đăng nhập vào hệ thống', exact: true }).click()
  await page.waitForURL('**/portal')
  return { context, page }
}
async function action(page, method, suffix, perform, expected = 200) {
  const pending = page.waitForResponse(
    (r) => r.request().method() === method && new URL(r.url()).pathname.endsWith(suffix),
    { timeout: 120000 },
  )
  await perform()
  const response = await pending
  assert.equal(response.status(), expected, await response.text())
  return response.json()
}
const panel = (page) =>
  page.getByRole('region', { name: 'Phiếu hồ sơ lần gửi 1', exact: true }).first()
async function inspect(page) {
  return action(page, 'GET', '/document-status', () =>
    panel(page).getByRole('button', { name: 'Kiểm tra tình trạng tài liệu', exact: true }).click(),
  )
}
async function exported(page, format, label) {
  const event = page.waitForEvent('download', { timeout: 150000 })
  await panel(page)
    .getByRole('button', { name: format === 'docx' ? 'Tải Word' : 'Tải PDF', exact: true })
    .click()
  const download = await event
  const path = join(root, label + '.' + format)
  await download.saveAs(path)
  return readFile(path)
}
try {
  const owner = await actor('demo.sinhvien'),
    reviewer = await actor('demo.canbo'),
    foreign = await actor('demo.ngoai')
  phase = 'submit-typed-fake-case'
  await owner.page.goto(
    state.webUrl + '/services/' + state.services.find((s) => s.purpose === 'approve').id,
  )
  await owner.page.getByRole('button', { name: 'Kê khai / tiếp tục bản nháp', exact: true }).click()
  await owner.page.waitForURL('**/submissions/*')
  await owner.page.locator('#field-fullName').waitFor()
  const id = new URL(owner.page.url()).pathname.split('/').at(-1)
  report.submissionId = id
  const values = recoveryValues(1)
  for (const key of ['reference', 'purpose', 'completedCredits', 'neededOn'])
    await owner.page.locator('#field-' + key).fill(String(values[key]))
  for (const key of ['purposeType', 'instructionsReceived'])
    await owner.page.locator('#field-' + key).selectOption(String(values[key]))
  const saved = await action(owner.page, 'PUT', '/submissions/' + id, () =>
    owner.page.getByRole('button', { name: 'Lưu bản nháp', exact: true }).click(),
  )
  assert.equal(saved.values.completedCredits, 0)
  assert.equal(saved.values.instructionsReceived, false)
  await action(owner.page, 'POST', '/attachments/proof', () =>
    owner.page
      .locator('#upload-proof')
      .setInputFiles(
        fileURLToPath(new URL('./fixtures/recovery/evidence-round-1.pdf', import.meta.url)),
      ),
  )
  await owner.page.getByRole('button', { name: 'Xem lại thông tin', exact: true }).click()
  await owner.page.locator('#confirm-submission').check()
  const submitted = await action(owner.page, 'POST', '/submit', () =>
    owner.page.getByRole('button', { name: 'Gửi hồ sơ', exact: true }).click(),
  )
  assert.equal(submitted.status, 'SUBMITTED')
  const word = await exported(owner.page, 'docx', 'original')
  report.wordSha256 = digest(word)
  report.checks.typedSubmissionAndWord = true
  phase = 'exhaust-real-pdf-requests'
  await control('ARM', { wordSha: report.wordSha256 })
  for (let i = 0; i < 3; i++) {
    if (i) await pause(3200)
    const result = await action(
      owner.page,
      'GET',
      '/documents/pdf',
      () => panel(owner.page).getByRole('button', { name: 'Tải PDF', exact: true }).click(),
      503,
    )
    assert.equal(result.code, 'DOCUMENT_PDF_UNAVAILABLE')
  }
  const exhausted = await inspect(owner.page),
    pdf = exhausted.documents.find((d) => d.format === 'pdf')
  assert.equal(pdf.state, 'EXHAUSTED')
  assert.equal(pdf.attempts, 3)
  assert.equal(pdf.attemptLimit, 3)
  assert.equal(pdf.retryAllowed, false)
  assert.equal(
    await owner.page.getByRole('button', { name: 'Mở thêm một lượt tạo PDF', exact: true }).count(),
    0,
  )
  assert.deepEqual(await exported(owner.page, 'docx', 'after-failures'), word)
  report.checks.exhaustedKeepsWordAndStudentCannotGrant = true
  phase = 'scope-and-reviewer'
  const path = state.apiUrl + '/api/v1/user/review-submissions/' + id + '/rounds/1'
  assert.equal((await foreign.context.request.get(path + '/document-status')).status(), 404)
  const denied = await foreign.context.request.post(path + '/documents/pdf/retry', {
    headers: { Origin: state.webUrl },
    data: {
      requestId: randomUUID(),
      expectedAttemptId: pdf.attemptId,
      reasonCode: 'CONVERTER_FIXED',
    },
  })
  assert.equal(denied.status(), 404)
  assert.equal(
    (
      await owner.context.request.post(path + '/documents/pdf/retry', {
        headers: { Origin: state.webUrl },
        data: {
          requestId: randomUUID(),
          expectedAttemptId: pdf.attemptId,
          reasonCode: 'CONVERTER_FIXED',
        },
      })
    ).status(),
    403,
  )
  await reviewer.page.goto(state.webUrl + '/review-submissions/' + id)
  await action(reviewer.page, 'POST', '/claim', () =>
    reviewer.page.getByRole('button', { name: 'Nhận xử lý', exact: true }).click(),
  )
  const reviewStatus = await inspect(reviewer.page)
  assert.equal(reviewStatus.documents.find((d) => d.format === 'pdf').retryAllowed, true)
  const button = reviewer.page.getByRole('button', {
    name: 'Mở thêm một lượt tạo PDF',
    exact: true,
  })
  const confirmation = reviewer.page.getByRole('checkbox', {
    name: 'Tôi đã kiểm tra và khắc phục bộ chuyển PDF.',
    exact: true,
  })
  assert.equal(await confirmation.isChecked(), false)
  assert.equal(await button.isDisabled(), true)
  report.checks.scopeAndUncheckedConfirmation = true
  phase = 'repair-and-grant'
  await control('REPAIR')
  for (const width of [375, 1440]) {
    await reviewer.page.setViewportSize({ width, height: 1000 })
    assert.ok(
      await reviewer.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    )
    await reviewer.page.screenshot({
      path: join(root, 'retry-confirm-' + width + '.png'),
      fullPage: true,
    })
    report.responsive.push({ width, overflow: false })
  }
  await confirmation.check()
  const grantRequest = reviewer.page.waitForRequest(
    (r) => r.method() === 'POST' && new URL(r.url()).pathname.endsWith('/documents/pdf/retry'),
  )
  const grant = await action(reviewer.page, 'POST', '/documents/pdf/retry', () => button.click())
  assert.equal(grant.attemptLimit, 4)
  const retryInput = (await grantRequest).postDataJSON()
  const postReplay = () =>
    reviewer.context.request.post(path + '/documents/pdf/retry', {
      headers: { Origin: state.webUrl },
      data: retryInput,
    })
  const limited = await postReplay()
  assert.equal(limited.status(), 429)
  const retryAfter = Number(limited.headers()['retry-after'])
  assert.ok(Number.isInteger(retryAfter) && retryAfter > 0 && retryAfter <= 60)
  const throttled = await control('INSPECT')
  assert.equal(throttled.retries.length, 1)
  assert.equal(throttled.audits.length, 1)
  report.checks.rateLimitKeepsSingleGrant = true
  let remainingMs = retryAfter * 1000 + 250
  while (remainingMs > 0) {
    const delay = Math.min(30000, remainingMs)
    await pause(delay)
    remainingMs -= delay
  }
  const replay = await postReplay()
  assert.equal(replay.status(), 200)
  assert.equal((await replay.json()).alreadyApplied, true)
  report.checks.sameRequestReplayDoesNotGrantTwice = true
  const afterGrant = await control('INSPECT')
  const grantedJob = afterGrant.jobs.find((j) => j.format === 'PDF')
  assert.equal(grantedJob.attempts, 3)
  assert.equal(grantedJob.retry_allowance, 1)
  assert.equal(afterGrant.retries.length, 1)
  assert.equal(afterGrant.audits.length, 1)
  assert.equal(afterGrant.retries[0].reason_code, 'CONVERTER_FIXED')
  assert.equal(afterGrant.audits[0].actor_user_id, afterGrant.retries[0].actor_user_id)
  assert.equal(afterGrant.audits[0].actor_type, 'USER')
  report.checks.oneGrantAndAtomicAuditWithoutReset = true
  phase = 'real-pdf-from-original-word'
  await pause(3200)
  const bytes = await exported(owner.page, 'pdf', 'recovered')
  assert.equal(bytes.subarray(0, 5).toString('ascii'), '%PDF-')
  report.pdfSha256 = digest(bytes)
  const final = await inspect(owner.page)
  assert.equal(final.documents.find((d) => d.format === 'pdf').state, 'READY')
  assert.equal(final.documents.find((d) => d.format === 'pdf').attempts, 4)
  assert.deepEqual(await exported(owner.page, 'docx', 'after-recovery'), word)
  report.snapshot = await control('INSPECT')
  const storedPdf = report.snapshot.documents.find((d) => d.format === 'PDF')
  assert.equal(storedPdf.source_docx_sha256, report.wordSha256)
  assert.equal(storedPdf.sha256, report.pdfSha256)
  assert.equal(storedPdf.status, 'UNSIGNED_DECLARATION')
  assert.deepEqual(
    storedPdf.renderer,
    report.snapshot.documents.find((d) => d.format === 'DOCX').renderer,
  )
  assert.equal(report.snapshot.retries.length, 1)
  assert.equal(report.snapshot.audits.length, 1)
  assert.equal(report.pageErrors.length, 0)
  report.checks.realPdfSameWordFourthAttempt = true
  report.status = 'PASS'
} catch (error) {
  report.status = 'FAILED'
  report.phase = phase
  report.failure = String(error.message).slice(0, 1500)
  try {
    report.snapshot = await control('INSPECT')
  } catch {}
  process.exitCode = 1
} finally {
  await browser.close()
  await writeFile(join(root, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n', {
    flag: 'wx',
  })
  console.log(
    JSON.stringify({
      event: 'RETRY_BROWSER_RESULT',
      status: report.status,
      phase,
      runId: state.runId,
      checks: report.checks,
    }),
  )
  if (process.connected) process.disconnect()
}
