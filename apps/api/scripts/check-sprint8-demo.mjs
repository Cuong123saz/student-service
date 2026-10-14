// One-shot acceptance owned by the isolated fake-data launcher.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readRecoveryPrivateFile } from './recovery-private-file.mjs'
import { assertDemoState, claimDemoBrowserRun, demoPassword } from './workflow-demo.contract.mjs'
assert.ok(process.send && process.connected, 'REQUIRES_SPRINT8_DEMO_PARENT')
assert.equal(process.argv.length, 2, 'NO_SPRINT8_CHECKER_ARGUMENTS')
const project = fileURLToPath(new URL('../../../', import.meta.url)),
  statePath = process.env.WORKFLOW_SPRINT8_STATE_PATH
const state = JSON.parse((await readRecoveryPrivateFile(statePath, 65536)).toString('utf8')),
  root = assertDemoState(state, project, statePath, 'sprint8')
assert.equal(state.status, 'READY')
await claimDemoBrowserRun(project, state.runId)
const report = {
  version: 1,
  testedImplementationCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: project,
    encoding: 'utf8',
    windowsHide: true,
  }).trim(),
  fakeDataOnly: true,
  runId: state.runId,
  status: 'RUNNING',
  checks: {},
  responsive: [],
  pageErrors: [],
  screenshots: [],
  productionReadiness: 'NOT_READY',
  scoreStatus: 'SELF_DECLARED_NOT_REVIEWED',
}
let browser,
  phase = 'login'
try {
  const require = createRequire(import.meta.url),
    { chromium } = require(process.env.WORKFLOW_PLAYWRIGHT_MODULE || 'playwright')
  browser = await chromium.launch({
    headless: true,
    ...(process.env.WORKFLOW_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.WORKFLOW_CHROMIUM_EXECUTABLE }
      : {}),
  })
  async function actor(username, admin = false) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
      page = await context.newPage()
    page.on('pageerror', (e) => report.pageErrors.push(e.message))
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
  async function request(actor, portal, path, status = 200, options = {}) {
    const r = await actor.context.request.fetch(state.apiUrl + '/api/v1/' + portal + path, {
      ...options,
      headers: { Origin: state.webUrl, ...options.headers },
    })
    assert.equal(r.status(), status, path + ' ' + (await r.text()))
    if (status === 200) assert.match(r.headers()['cache-control'], /no-store/)
    return r
  }
  async function mutation(page, fragment, action) {
    const pending = page.waitForResponse(
      (r) => r.url().includes(fragment) && r.request().method() !== 'GET',
    )
    await action()
    const r = await pending
    assert.equal(r.status(), 200, await r.text())
    return r.json()
  }
  async function responsive(page, label) {
    for (const width of [375, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }))
      await page.waitForTimeout(120)
      const size = await page.evaluate(() => ({
        client: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
      }))
      assert.ok(size.scroll <= size.client + 1, label + ' horizontal overflow ' + width)
      const file = label + '-' + width + '.png'
      await page.screenshot({ path: join(root, file), fullPage: true })
      report.screenshots.push(file)
      report.responsive.push({ label, width, horizontalOverflow: false })
    }
  }
  const manager = await actor('demo.quantri', true),
    owner = await actor('demo.sinhvien'),
    other = await actor('demo.svkhac'),
    unprivileged = await actor('demo.canbo', true)
  phase = 'period-management'
  await request(unprivileged, 'admin', '/training-periods', 403)
  report.checks.currentManagerPermission = true
  await manager.page.goto(state.webUrl + '/admin/training-periods')
  await manager.page.getByLabel('Tên đợt', { exact: true }).fill('Sprint 8 — Đợt kê khai giả định')
  await manager.page
    .getByLabel('Tên quy chế / ghi chú bộ tiêu chí', { exact: true })
    .fill('Bộ A–E giả định — chưa phải quy chế chính thức')
  let period = await mutation(manager.page, '/training-periods', () =>
    manager.page.getByRole('button', { name: 'Lưu đợt đánh giá', exact: true }).click(),
  )
  assert.equal(period.status, 'DRAFT')
  report.periodId = period.id
  await manager.page
    .getByLabel('Tên tiêu chí A', { exact: true })
    .fill('Ý thức học tập — thử nghiệm')
  period = await mutation(manager.page, '/training-periods/' + period.id, () =>
    manager.page.getByRole('button', { name: 'Lưu đợt đánh giá', exact: true }).click(),
  )
  assert.equal(period.criteria[0].label, 'Ý thức học tập — thử nghiệm')
  await responsive(manager.page, 'admin-period-draft')
  await manager.page.getByRole('button', { name: 'Mở đợt', exact: true }).click()
  assert.equal(
    await manager.page.getByRole('button', { name: 'Xác nhận mở đợt', exact: true }).isDisabled(),
    true,
  )
  await manager.page.getByLabel('Tôi đã kiểm tra và đồng ý', { exact: true }).check()
  period = await mutation(manager.page, '/open', () =>
    manager.page.getByRole('button', { name: 'Xác nhận mở đợt', exact: true }).click(),
  )
  assert.equal(period.status, 'OPEN')
  assert.equal(await manager.page.getByLabel('Tên tiêu chí A', { exact: true }).isDisabled(), true)
  report.checks.periodConfigurationFreezesAfterOpen = true
  phase = 'student-draft'
  await owner.page.getByRole('link', { name: /Điểm rèn luyện/ }).click()
  await owner.page.getByRole('heading', { name: 'Điểm rèn luyện của tôi', exact: true }).waitFor()
  await responsive(owner.page, 'student-period-list')
  let declaration = await mutation(owner.page, '/declaration', () =>
    owner.page.getByRole('button', { name: 'Bắt đầu kê khai', exact: true }).click(),
  )
  report.declarationId = declaration.id
  await owner.page.waitForURL('**/training-points/' + declaration.id)
  await owner.page.getByLabel('Điểm tự kê khai A / 20', { exact: true }).fill('0')
  assert.equal(await owner.page.getByLabel('Thêm minh chứng A', { exact: true }).isDisabled(), true)
  declaration = await mutation(owner.page, '/training-declarations/' + declaration.id, () =>
    owner.page.getByRole('button', { name: 'Lưu bản nháp', exact: true }).click(),
  )
  assert.equal(declaration.answers.A.points, 0)
  assert.equal(declaration.answers.B.points, null)
  await owner.page.reload()
  await owner.page.getByLabel('Điểm tự kê khai A / 20', { exact: true }).waitFor()
  assert.equal(
    await owner.page.getByLabel('Điểm tự kê khai A / 20', { exact: true }).inputValue(),
    '0',
  )
  assert.equal(
    await owner.page.getByLabel('Điểm tự kê khai B / 20', { exact: true }).inputValue(),
    '',
  )
  await owner.page.getByRole('button', { name: 'Kiểm tra và nộp', exact: true }).click()
  await owner.page.getByRole('alert').filter({ hasText: 'Hoàn thiện' }).waitFor()
  assert.equal(
    await owner.page
      .getByLabel('Điểm tự kê khai B / 20', { exact: true })
      .getAttribute('aria-invalid'),
    'true',
  )
  report.checks.partialDraftPreservesZeroAndUnknown = true
  report.checks.incompleteSubmissionBlocked = true
  for (const code of ['A', 'B', 'C', 'D', 'E']) {
    await owner.page
      .getByLabel('Điểm tự kê khai ' + code + ' / 20', { exact: true })
      .fill(code === 'A' ? '15' : code === 'B' ? '5' : '0')
    if (['A', 'B'].includes(code))
      await owner.page
        .getByLabel('Giải trình ' + code, { exact: true })
        .fill('Hoạt động giả định nhóm ' + code)
  }
  declaration = await mutation(owner.page, '/training-declarations/' + declaration.id, () =>
    owner.page.getByRole('button', { name: 'Lưu bản nháp', exact: true }).click(),
  )
  await owner.page.getByRole('button', { name: 'Kiểm tra và nộp', exact: true }).click()
  await owner.page.getByRole('alert').filter({ hasText: 'Hoàn thiện' }).waitFor()
  assert.equal(
    await owner.page
      .getByLabel('Điểm tự kê khai A / 20', { exact: true })
      .getAttribute('aria-invalid'),
    'true',
  )
  report.checks.requiredEvidenceEnforced = true
  phase = 'evidence'
  const fixture = fileURLToPath(
      new URL('./fixtures/recovery/evidence-round-1.pdf', import.meta.url),
    ),
    bytes = await readFile(fixture)
  declaration = await mutation(owner.page, '/evidence/A', () =>
    owner.page.getByLabel('Thêm minh chứng A', { exact: true }).setInputFiles(fixture),
  )
  let file = declaration.files[0]
  assert.equal(file.sha256, createHash('sha256').update(bytes).digest('hex'))
  assert.equal(file.signatureStatus, 'NOT_CHECKED')
  assert.ok(!('storageKey' in file))
  await request(other, 'user', '/training-declarations/' + declaration.id, 404)
  await request(
    other,
    'user',
    '/training-declarations/' + declaration.id + '/files/' + file.id,
    404,
  )
  const download = await request(
    owner,
    'user',
    '/training-declarations/' + declaration.id + '/files/' + file.id,
  )
  assert.deepEqual(await download.body(), bytes)
  report.checks.privateEvidenceBytesAndHash = true
  const pendingDownload = owner.page.waitForEvent('download')
  await owner.page.getByRole('button', { name: 'Tải ' + file.name, exact: true }).click()
  const nativeDownload = await pendingDownload
  assert.equal(nativeDownload.suggestedFilename(), file.name)
  const downloadPath = join(root, 'training-evidence.pdf')
  await nativeDownload.saveAs(downloadPath)
  assert.deepEqual(await readFile(downloadPath), bytes)
  report.nativeDownloadSha256 = createHash('sha256')
    .update(await readFile(downloadPath))
    .digest('hex')
  report.checks.browserDownloadRetainsOriginalBytes = true

  report.removedFileId = file.id
  declaration = await mutation(owner.page, '/files/' + file.id, () =>
    owner.page.getByRole('button', { name: 'Gỡ ' + file.name, exact: true }).click(),
  )
  assert.equal(declaration.files.length, 0)
  await request(
    owner,
    'user',
    '/training-declarations/' + declaration.id + '/files/' + file.id,
    404,
  )
  declaration = await mutation(owner.page, '/evidence/A', () =>
    owner.page.getByLabel('Thêm minh chứng A', { exact: true }).setInputFiles(fixture),
  )
  file = declaration.files[0]
  assert.notEqual(file.id, report.removedFileId)
  report.checks.evidenceRemovalAndReupload = true
  await responsive(owner.page, 'student-complete-draft')
  phase = 'submit'
  await owner.page.getByRole('button', { name: 'Kiểm tra và nộp', exact: true }).click()
  await owner.page.getByRole('region', { name: 'Xác nhận nộp kê khai' }).waitFor()
  assert.equal(
    await owner.page.getByRole('button', { name: 'Xác nhận nộp', exact: true }).isDisabled(),
    true,
  )
  await responsive(owner.page, 'student-submit-review')
  await owner.page.getByLabel('Tôi đã kiểm tra nội dung và minh chứng', { exact: true }).check()
  declaration = await mutation(owner.page, '/submit', () =>
    owner.page.getByRole('button', { name: 'Xác nhận nộp', exact: true }).click(),
  )
  assert.equal(declaration.state, 'SUBMITTED')
  assert.equal(declaration.totalPoints, 20)
  assert.equal(declaration.editable, false)
  assert.equal(declaration.scoreStatus, 'SELF_DECLARED_NOT_REVIEWED')
  await owner.page
    .getByRole('heading', { name: 'Đã nộp — nội dung đã khóa', exact: true })
    .waitFor()
  assert.equal(
    await owner.page.getByLabel('Điểm tự kê khai A / 20', { exact: true }).isDisabled(),
    true,
  )
  assert.equal(
    await owner.page.getByRole('button', { name: 'Gỡ ' + file.name, exact: true }).count(),
    0,
  )
  assert.equal(declaration.history.filter((h) => h.action === 'SUBMITTED').length, 1)
  assert.equal(declaration.history.filter((h) => h.action === 'FILE_ADDED').length, 2)
  assert.equal(declaration.history.filter((h) => h.action === 'FILE_REMOVED').length, 1)
  report.checks.explicitSubmitAndFrozenHistory = true
  await request(owner, 'user', '/training-declarations/' + declaration.id, 409, {
    method: 'PUT',
    data: { expectedRevision: declaration.revision, answers: declaration.answers },
  })
  await request(
    owner,
    'user',
    '/training-declarations/' +
      declaration.id +
      '/files/' +
      file.id +
      '?expectedRevision=' +
      declaration.revision,
    409,
    { method: 'DELETE' },
  )
  report.checks.submittedMutationsRejected = true
  await responsive(owner.page, 'student-submitted')
  phase = 'close-period'
  await manager.page.getByRole('button', { name: 'Đóng đợt', exact: true }).click()
  await manager.page.getByLabel('Tôi đã kiểm tra và đồng ý', { exact: true }).check()
  period = await mutation(manager.page, '/close', () =>
    manager.page.getByRole('button', { name: 'Xác nhận đóng đợt', exact: true }).click(),
  )
  assert.equal(period.status, 'CLOSED')
  await owner.page.reload()
  await owner.page
    .getByRole('heading', { name: 'Đã nộp — nội dung đã khóa', exact: true })
    .waitFor()
  const after = await (
    await request(owner, 'user', '/training-declarations/' + declaration.id)
  ).json()
  assert.deepEqual(after.answers, declaration.answers)
  assert.deepEqual(after.files, declaration.files)
  assert.deepEqual(after.history, declaration.history)
  assert.equal(after.totalPoints, 20)
  report.checks.closedPeriodPreservesSubmission = true
  await other.page.goto(state.webUrl + '/training-points')
  await other.page.getByRole('heading', { name: 'Điểm rèn luyện của tôi', exact: true }).waitFor()
  assert.equal(
    await other.page.getByRole('button', { name: 'Bắt đầu kê khai', exact: true }).isDisabled(),
    true,
  )
  await request(other, 'user', '/training-periods/' + period.id + '/declaration', 409, {
    method: 'POST',
    data: {},
  })
  report.checks.closedPeriodBlocksNewDeclaration = true
  phase = 'offline-unchanged'
  const offline = state.services.find((s) => s.purpose === 'offline')
  await owner.page.goto(state.webUrl + '/services/' + offline.id)
  await owner.page
    .getByText('Sinh viên làm việc trực tiếp tại Phòng CTSV.', { exact: false })
    .first()
    .waitFor()
  assert.equal(
    await owner.page
      .getByRole('button', { name: 'Kê khai / tiếp tục bản nháp', exact: true })
      .count(),
    0,
  )
  report.checks.studentConfirmationRemainsOffline = true
  assert.deepEqual(report.pageErrors, [])
  report.checks.noBrowserRuntimeErrors = true
  report.status = 'PASS'
  report.declaration = {
    id: declaration.id,
    revision: declaration.revision,
    totalPoints: declaration.totalPoints,
    fileIds: declaration.files.map((f) => f.id),
    history: declaration.history.map((h) => ({ action: h.action, revision: h.revision })),
  }
} catch (error) {
  report.status = 'FAIL'
  report.phase = phase
  report.error = String(error?.message ?? 'BROWSER_FAILURE').slice(0, 3000)
  process.exitCode = 1
  console.error('SPRINT8_BROWSER_FAILED ' + phase)
} finally {
  await browser?.close()
  await writeFile(join(root, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n', {
    flag: 'wx',
    mode: 0o600,
  })
  console.log('SPRINT8_BROWSER_REPORT ' + report.status)
}
