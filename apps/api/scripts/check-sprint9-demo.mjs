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
assert.ok(process.send && process.connected, 'REQUIRES_SPRINT9_DEMO_PARENT')
assert.equal(process.argv.length, 2, 'NO_SPRINT9_CHECKER_ARGUMENTS')
const project = fileURLToPath(new URL('../../../', import.meta.url)),
  statePath = process.env.WORKFLOW_SPRINT9_STATE_PATH
const state = JSON.parse((await readRecoveryPrivateFile(statePath, 65536)).toString('utf8')),
  root = assertDemoState(state, project, statePath, 'sprint9')
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
  technicalSignatureStatus: 'NOT_VERIFIED',
  legalEffect: false,
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
    advisor = await actor('demo.covan'),
    faculty = await actor('demo.canbo'),
    foreign = await actor('demo.ngoai')
  phase = 'prepare-submitted-fixture'
  const catalog = await (await request(manager, 'admin', '/training-periods/catalog')).json()
  const period = await (
    await request(manager, 'admin', '/training-periods', 200, {
      method: 'POST',
      data: {
        classId: catalog.classes[0].id,
        academicYear: '2026-2027',
        semester: '1',
        name: 'Sprint 9 — Xét duyệt giả định',
        policyLabel: 'A–E giả định, chưa phải quy chế chính thức',
        startsAt: new Date(Date.now() - 300000).toISOString(),
        endsAt: new Date(Date.now() + 7 * 86400000).toISOString(),
        criteria: ['A', 'B', 'C', 'D', 'E'].map((code) => ({
          code,
          label: 'Tiêu chí giả định ' + code,
          maxPoints: 20,
          evidenceRequired: code === 'A',
        })),
      },
    })
  ).json()
  await request(manager, 'admin', '/training-periods/' + period.id + '/open', 200, {
    method: 'POST',
    data: { expectedRevision: 1 },
  })
  let declaration = await (
    await request(owner, 'user', '/training-periods/' + period.id + '/declaration', 200, {
      method: 'POST',
      data: {},
    })
  ).json()
  declaration = await (
    await request(owner, 'user', '/training-declarations/' + declaration.id, 200, {
      method: 'PUT',
      data: {
        expectedRevision: declaration.revision,
        answers: Object.fromEntries(
          ['A', 'B', 'C', 'D', 'E'].map((code) => [
            code,
            {
              points: code === 'A' ? 10 : code === 'B' ? 5 : 0,
              note: ['A', 'B'].includes(code) ? 'Giải trình giả định ' + code : '',
            },
          ]),
        ),
      },
    })
  ).json()
  const pdf = await readFile(
    join(project, 'apps/api/scripts/fixtures/recovery/evidence-round-1.pdf'),
  )
  declaration = await (
    await request(
      owner,
      'user',
      '/training-declarations/' +
        declaration.id +
        '/evidence/A?expectedRevision=' +
        declaration.revision +
        '&requestId=' +
        crypto.randomUUID(),
      200,
      {
        method: 'POST',
        multipart: { file: { name: 'proof.pdf', mimeType: 'application/pdf', buffer: pdf } },
      },
    )
  ).json()
  declaration = await (
    await request(owner, 'user', '/training-declarations/' + declaration.id + '/submit', 200, {
      method: 'POST',
      data: { expectedRevision: declaration.revision, requestId: crypto.randomUUID() },
    })
  ).json()
  await request(manager, 'admin', '/training-periods/' + period.id + '/close', 200, {
    method: 'POST',
    data: { expectedRevision: 2 },
  })
  report.checks.reviewAfterPeriodClosed = true
  const path = '/training-reviews/' + declaration.id,
    initial = await (await request(advisor, 'user', path)).json()
  await request(foreign, 'user', path, 404)
  await request(other, 'user', '/training-declarations/' + declaration.id + '/review', 404)
  await request(faculty, 'user', path + '/faculty-approve', 409, {
    method: 'POST',
    data: {
      expectedRevision: 0,
      requestId: crypto.randomUUID(),
      confirmed: true,
      comment: 'Không được bỏ qua cố vấn',
    },
  })
  report.checks.scopedQueueAndNoStageBypass = true
  phase = 'advisor-queue'
  await advisor.page.goto(state.webUrl + '/training-reviews')
  await advisor.page.getByText('Đã nộp:', { exact: false }).waitFor()
  await responsive(advisor.page, 'advisor-class-queue')
  phase = 'advisor-sign'
  await advisor.page.goto(state.webUrl + path)
  await advisor.page.getByLabel('Điểm xét duyệt A / 20', { exact: true }).fill('8')
  await advisor.page
    .getByLabel('Nhận xét nhóm A', { exact: true })
    .fill('Đối chiếu minh chứng nhóm A')
  await advisor.page.getByLabel('Nhận xét nhóm B', { exact: true }).fill('Đối chiếu nhóm B')
  await advisor.page
    .getByLabel('Nhận xét xử lý (bắt buộc)', { exact: true })
    .fill('Cố vấn đã kiểm tra lần đầu')
  const download = advisor.page.waitForEvent('download')
  await advisor.page.getByRole('button', { name: 'Tải proof.pdf', exact: true }).click()
  const native = await download
  await native.saveAs(join(root, 'review-evidence.pdf'))
  assert.deepEqual(await readFile(join(root, 'review-evidence.pdf')), pdf)
  report.checks.privateNativeEvidenceDownload = true
  await advisor.page.getByRole('button', { name: 'Kiểm tra xác nhận cố vấn', exact: true }).click()
  assert.equal(
    await advisor.page.getByRole('button', { name: 'Xác nhận cố vấn', exact: true }).isDisabled(),
    true,
  )
  await responsive(advisor.page, 'advisor-confirmation')
  await advisor.page
    .getByLabel('Tôi đã đối chiếu điểm, minh chứng và nhận xét', { exact: true })
    .check()
  await mutation(advisor.page, '/advisor-sign', () =>
    advisor.page.getByRole('button', { name: 'Xác nhận cố vấn', exact: true }).click(),
  )
  report.checks.explicitAdvisorConfirmation = true
  phase = 'faculty-return'
  await faculty.page.goto(state.webUrl + path)
  await faculty.page.getByRole('heading', { name: 'Chờ khoa', exact: true }).waitFor()
  await faculty.page
    .getByLabel('Nhận xét xử lý (bắt buộc)', { exact: true })
    .fill('Đề nghị cố vấn đối chiếu lại nhóm A')
  await faculty.page.getByRole('button', { name: 'Kiểm tra trả về cố vấn', exact: true }).click()
  await faculty.page
    .getByLabel('Tôi đã đối chiếu điểm, minh chứng và nhận xét', { exact: true })
    .check()
  await mutation(faculty.page, '/faculty-return', () =>
    faculty.page.getByRole('button', { name: 'Trả về cố vấn', exact: true }).click(),
  )
  report.checks.facultyReturnRecorded = true
  phase = 'advisor-resign'
  await advisor.page.reload()
  await advisor.page.getByRole('heading', { name: 'Khoa trả về cố vấn', exact: true }).waitFor()
  await advisor.page.getByLabel('Điểm xét duyệt A / 20', { exact: true }).fill('9')
  await advisor.page.getByLabel('Nhận xét nhóm A', { exact: true }).fill('Đã đối chiếu lại nhóm A')
  await advisor.page
    .getByLabel('Nhận xét xử lý (bắt buộc)', { exact: true })
    .fill('Cố vấn xác nhận lần hai')
  await advisor.page.getByRole('button', { name: 'Kiểm tra xác nhận cố vấn', exact: true }).click()
  await advisor.page
    .getByLabel('Tôi đã đối chiếu điểm, minh chứng và nhận xét', { exact: true })
    .check()
  await mutation(advisor.page, '/advisor-sign', () =>
    advisor.page.getByRole('button', { name: 'Xác nhận cố vấn', exact: true }).click(),
  )
  report.checks.advisorNewRoundPreservesPriorRound = true
  phase = 'faculty-approve'
  await faculty.page.reload()
  await faculty.page.getByRole('heading', { name: 'Chờ khoa', exact: true }).waitFor()
  await faculty.page
    .getByLabel('Nhận xét xử lý (bắt buộc)', { exact: true })
    .fill('Khoa đã đối chiếu và duyệt')
  await faculty.page.getByRole('button', { name: 'Kiểm tra duyệt của khoa', exact: true }).click()
  await faculty.page
    .getByLabel('Tôi đã đối chiếu điểm, minh chứng và nhận xét', { exact: true })
    .check()
  const final = await mutation(faculty.page, '/faculty-approve', () =>
    faculty.page.getByRole('button', { name: 'Duyệt của khoa', exact: true }).click(),
  )
  assert.equal(final.state, 'APPROVED')
  assert.equal(final.revision, 4)
  assert.equal(final.decisions.length, 4)
  assert.equal(final.decisions[3].totalPoints, 14)
  assert.equal(final.declarationSha256, initial.declarationSha256)
  assert.deepEqual(final.answers, initial.answers)
  assert.equal(final.totalPoints, 15)
  assert.equal(final.decisions[3].legalEffect, false)
  assert.equal(final.decisions[3].technicalSignatureStatus, 'NOT_VERIFIED')
  report.checks.approvedResultAndOriginalRemainSeparate = true
  await responsive(faculty.page, 'faculty-approved-history')
  const receipt = final.decisions[3]
  await request(faculty, 'user', path + '/faculty-approve', 200, {
    method: 'POST',
    data: {
      expectedRevision: receipt.inputRevision,
      requestId: receipt.requestId,
      confirmed: true,
      comment: receipt.comment,
    },
  })
  await request(advisor, 'user', path + '/advisor-sign', 409, {
    method: 'POST',
    data: {
      expectedRevision: 4,
      requestId: crypto.randomUUID(),
      confirmed: true,
      comment: 'Không được mở lại',
      answers: final.decisions[2].answers,
    },
  })
  report.checks.idempotentApprovalAndFinality = true
  phase = 'student-result'
  await owner.page.goto(state.webUrl + '/training-points/' + declaration.id)
  await owner.page.getByText('Khoa đã duyệt', { exact: true }).waitFor()
  await responsive(owner.page, 'student-approved-result')
  report.checks.studentOwnReviewedResult = true
  const queue = await (
    await request(faculty, 'user', '/training-reviews/periods/' + period.id)
  ).json()
  assert.equal(queue.summary.approved, 1)
  assert.equal(queue.summary.approvedTotalPoints, 14)
  assert.equal(queue.summary.approvedAveragePoints, 14)
  report.checks.classAggregateOnlyApprovedPoints = true
  phase = 'responsive-accessibility'
  await faculty.page.setViewportSize({ width: 844, height: 390 })
  await faculty.page.emulateMedia({ reducedMotion: 'reduce' })
  await faculty.page.addStyleTag({
    content:
      'html, body { font-size: 20px; } button, input, select, textarea { font-size: inherit; }',
  })
  assert.ok(
    await faculty.page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    ),
  )
  await faculty.page.screenshot({
    path: join(root, 'faculty-approved-landscape-large-text.png'),
    fullPage: true,
  })
  report.screenshots.push('faculty-approved-landscape-large-text.png')
  report.checks.landscapeLargeTextReducedMotion = true
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
  report.periodId = period.id
  report.declarationId = declaration.id
  report.originalPoints = 15
  report.approvedPoints = 14
  report.reviewDecisions = final.decisions.map((d) => ({
    id: d.id,
    revision: d.revision,
    action: d.action,
    sha256: d.payloadSha256,
    actor: d.actor.roleCode,
  }))
  report.nativeDownloadSha256 = createHash('sha256').update(pdf).digest('hex')
} catch (error) {
  report.status = 'FAIL'
  report.phase = phase
  report.error = String(error?.message ?? 'BROWSER_FAILURE').slice(0, 3000)
  process.exitCode = 1
  console.error('SPRINT9_BROWSER_FAILED ' + phase)
} finally {
  await browser?.close()
  await writeFile(join(root, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n', {
    flag: 'wx',
    mode: 0o600,
  })
  console.log('SPRINT9_BROWSER_REPORT ' + report.status)
}
