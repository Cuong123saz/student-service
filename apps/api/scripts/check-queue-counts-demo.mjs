// Private one-shot rehearsal: actual browser/API/SQL, synthetic records only.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readRecoveryPrivateFile } from './recovery-private-file.mjs'
import { assertRecoveryDirectory } from './recovery-bundle.mjs'
import { assertDemoState, claimDemoBrowserRun, demoPassword } from './workflow-demo.contract.mjs'
import { recoveryValues } from './recovery-fixture.mjs'
assert.ok(process.send && process.connected, 'REQUIRES_QUEUE_COUNTS_PARENT')
const project = fileURLToPath(new URL('../../../', import.meta.url))
const statePath = process.env.WORKFLOW_COUNTS_STATE_PATH
const state = JSON.parse((await readRecoveryPrivateFile(statePath, 65536)).toString('utf8'))
const root = assertDemoState(state, project, statePath, 'queue-counts')
await assertRecoveryDirectory(root)
assert.equal(state.status, 'READY')
await claimDemoBrowserRun(project, state.runId)
const services = state.services.filter((s) => s.purpose === 'queue-counts')
assert.equal(services.length, 25)
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
  scope: 'SCOPED_REVIEW_QUEUE_COUNTS',
  checks: {},
  responsive: [],
  pageErrors: [],
}
let phase = 'login'
async function actor(username, admin = false) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  context.on('page', (p) => p.on('pageerror', (e) => report.pageErrors.push(e.message)))
  await context.route('**/*', (route) =>
    [state.webUrl, state.apiUrl].includes(new URL(route.request().url()).origin)
      ? route.continue()
      : route.abort(),
  )
  const page = await context.newPage()
  await page.goto(state.webUrl + (admin ? '/admin/login' : '/login'))
  await ready(page)
  await page.getByLabel('Tên đăng nhập', { exact: true }).fill(username)
  await page.getByLabel('Mật khẩu', { exact: true }).fill(demoPassword)
  await page
    .getByRole('button', { name: admin ? 'Đăng nhập' : 'Đăng nhập vào hệ thống', exact: true })
    .click()
  await page.waitForURL(admin ? /\/admin\/?$/ : '**/portal')
  return { context, page }
}
async function ready(page) {
  await page.waitForFunction(() => Boolean(document.querySelector('#__nuxt')?.__vue_app__))
  await page.waitForLoadState('networkidle')
}
async function api(ctx, path, method = 'GET', data, expected = 200, portal = 'user') {
  const response = await ctx.request.fetch(state.apiUrl + '/api/v1/' + portal + path, {
    method,
    data,
    headers: { origin: state.webUrl },
  })
  assert.equal(response.status(), expected, method + ' ' + path)
  return response.json()
}
async function queueAction(page, perform) {
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.request().method() === 'GET' && new URL(r.url()).pathname.endsWith('/review-submissions'),
    ),
    perform(),
  ])
  assert.equal(response.status(), 200)
  const result = await response.json()
  await page.waitForLoadState('networkidle')
  return result
}
async function counts(page, expected) {
  for (const [status, number] of Object.entries(expected)) {
    const text = (await page.locator('#queue-count-' + status).textContent())
      .replace(/\s+/g, ' ')
      .trim()
    assert.equal(text, number + ' hồ sơ')
  }
}
async function responsive(page, screen) {
  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      true,
      screen + ' ' + width,
    )
    report.responsive.push({ screen, width, overflow: false })
    if (width === 375 || width === 1440)
      await page.screenshot({
        path: join(root, screen + '-' + width + '.png'),
        animations: 'disabled',
      })
  }
}
try {
  const owner = await actor('demo.sinhvien'),
    reviewer = await actor('demo.canbo'),
    outsider = await actor('demo.ngoai'),
    admin = await actor('demo.canbo', true)
  const cases = []
  phase = 'create-real-submissions'
  for (const service of services) {
    let draft = await api(owner.context, '/submissions', 'POST', {
      serviceId: service.id,
      versionId: service.versionId,
    })
    draft = await api(owner.context, '/submissions/' + draft.id, 'PUT', {
      expectedRevision: draft.revision,
      values: recoveryValues(1),
    })
    cases.push(
      await api(owner.context, '/submissions/' + draft.id + '/submit', 'POST', {
        expectedRevision: draft.revision,
      }),
    )
  }
  for (const [index, action] of [
    [1, null],
    [2, 'REQUEST_SUPPLEMENT'],
    [3, 'APPROVE'],
    [4, 'REJECT'],
  ]) {
    const item = cases[index]
    const claimed = await api(
      reviewer.context,
      '/review-submissions/' + item.id + '/claim',
      'POST',
      { expectedRevision: item.revision },
    )
    if (action)
      await api(reviewer.context, '/review-submissions/' + item.id + '/resolve', 'POST', {
        expectedRevision: claimed.revision,
        action,
        note: 'Lý do giả định để kiểm chứng tổng hàng đợi.',
      })
  }
  const expected = { SUBMITTED: 21, IN_REVIEW: 1, NEEDS_SUPPLEMENT: 1, APPROVED: 1, REJECTED: 1 }
  phase = 'scoped-pagination'
  const page = reviewer.page
  await page.goto(state.webUrl + '/review-submissions')
  await ready(page)
  await counts(page, expected)
  assert.equal(await page.locator('.intake-list > li').count(), 20)
  const more = await queueAction(page, () =>
    page.getByRole('button', { name: 'Tải thêm 20 hồ sơ', exact: true }).click(),
  )
  assert.equal(more.items.length, 1)
  assert.deepEqual(more.counts, expected)
  assert.equal(await page.locator('.intake-list > li').count(), 21)
  assert.ok((await page.locator('.queue-totals').innerText()).includes('21 hồ sơ'))
  await responsive(page, 'queue-counts-paginated')
  report.checks.totalsBeyondFirstTwentyAndStableAcrossCursor = true
  phase = 'filters'
  await page.locator('#queue-search').fill('Lô giả 01')
  const filtered = await queueAction(page, () =>
    page.getByRole('button', { name: 'Áp dụng bộ lọc', exact: true }).click(),
  )
  const single = { SUBMITTED: 1, IN_REVIEW: 0, NEEDS_SUPPLEMENT: 0, APPROVED: 0, REJECTED: 0 }
  assert.deepEqual(filtered.counts, single)
  await counts(page, single)
  assert.equal(await page.locator('.intake-list > li').count(), 1)
  await responsive(page, 'queue-counts-filtered')
  await queueAction(page, () =>
    page.getByRole('button', { name: 'Xóa bộ lọc', exact: true }).click(),
  )
  await page.locator('#queue-assignment').selectOption('MINE')
  await queueAction(page, () =>
    page.getByRole('button', { name: 'Áp dụng bộ lọc', exact: true }).click(),
  )
  const mine = { SUBMITTED: 0, IN_REVIEW: 1, NEEDS_SUPPLEMENT: 1, APPROVED: 1, REJECTED: 1 }
  await counts(page, mine)
  await queueAction(page, () =>
    page.getByRole('button', { name: 'Đang xử lý', exact: true }).click(),
  )
  await counts(page, mine)
  assert.equal(await page.locator('.intake-list > li').count(), 1)
  await responsive(page, 'queue-counts-mine')
  report.checks.searchAndAssignmentApplyToAllStatusCounts = true
  phase = 'refresh-after-state-change'
  await queueAction(page, () =>
    page.getByRole('button', { name: 'Xóa bộ lọc', exact: true }).click(),
  )
  await queueAction(page, () =>
    page.getByRole('button', { name: 'Chờ tiếp nhận', exact: true }).click(),
  )
  await api(reviewer.context, '/review-submissions/' + cases[0].id + '/claim', 'POST', {
    expectedRevision: cases[0].revision,
  })
  await counts(page, expected)
  const refreshed = await queueAction(page, () =>
    page.getByRole('button', { name: 'Tải lại', exact: true }).click(),
  )
  const latest = { ...expected, SUBMITTED: 20, IN_REVIEW: 2 }
  assert.deepEqual(refreshed.counts, latest)
  await counts(page, latest)
  report.checks.manualRefreshReflectsActualClaim = true
  phase = 'portals-and-visibility'
  const outside = await api(outsider.context, '/review-submissions')
  assert.equal(outside.items.length, 0)
  assert.ok(Object.values(outside.counts).every((n) => n === 0))
  await api(owner.context, '/review-submissions', 'GET', undefined, 403)
  await api(admin.context, '/review-submissions', 'GET', undefined, 401)
  const adminList = await api(
    admin.context,
    '/review-submissions?status=SUBMITTED',
    'GET',
    undefined,
    200,
    'admin',
  )
  assert.deepEqual(adminList.counts, latest)
  await admin.page.goto(state.webUrl + '/admin/review-submissions')
  await ready(admin.page)
  await counts(admin.page, latest)
  await responsive(admin.page, 'queue-counts-admin')
  report.checks.foreignScopeStudentAndWrongPortalCannotReadTotals = true
  const offline = state.services.find((s) => s.purpose === 'offline')
  const publicResult = await owner.context.request.get(
    state.apiUrl + '/services/' + offline.id + '/procedure',
  )
  assert.equal((await publicResult.json()).procedure.processingMode, 'OFFLINE')
  report.checks.studentConfirmationRemainsOffline = true
  assert.deepEqual(report.pageErrors, [])
  report.checks.noBrowserJavascriptErrors = true
  report.finalCounts = latest
  report.caseCount = cases.length
  report.status = 'PASS'
} catch (error) {
  report.status = 'FAILED'
  report.phase = phase
  report.failure = String(error.message).slice(0, 1000)
  process.exitCode = 1
} finally {
  await browser.close()
  await writeFile(join(root, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n', {
    flag: 'wx',
    mode: 0o600,
  })
  console.log(
    JSON.stringify({
      event: 'QUEUE_COUNTS_BROWSER_RESULT',
      runId: state.runId,
      status: report.status,
      phase,
      checks: report.checks,
      responsive: report.responsive.length,
      pageErrors: report.pageErrors.length,
    }),
  )
  if (process.connected) process.disconnect()
}
