// One-shot Sprint 10 export acceptance owned by the isolated fake-data launcher.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { strFromU8, unzipSync } from 'fflate'
import { readRecoveryPrivateFile } from './recovery-private-file.mjs'
import { assertDemoState, claimDemoBrowserRun, demoPassword } from './workflow-demo.contract.mjs'
assert.ok(process.send && process.connected, 'REQUIRES_SPRINT10_DEMO_PARENT')
assert.equal(process.argv.length, 2, 'NO_SPRINT10_CHECKER_ARGUMENTS')
const project = fileURLToPath(new URL('../../../', import.meta.url)),
  statePath = process.env.WORKFLOW_SPRINT10_STATE_PATH
const state = JSON.parse((await readRecoveryPrivateFile(statePath, 65536)).toString('utf8')),
  root = assertDemoState(state, project, statePath, 'sprint10')
assert.equal(state.status, 'READY')
await claimDemoBrowserRun(project, state.runId)
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
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
  downloads: [],
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
    const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        acceptDownloads: true,
      }),
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
    assert.equal(r.status(), status, path + ' ' + (await r.text()).slice(0, 500))
    if (status === 200) assert.match(r.headers()['cache-control'], /no-store/)
    return r
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
      const file = label + '-' + width + '.png'
      await page.screenshot({ path: join(root, file), fullPage: true })
      report.screenshots.push(file)
      assert.ok(size.scroll <= size.client + 1, label + ' horizontal overflow ' + width)
      const smallButtons = await page
        .locator('.training-workspace button, .training-workspace a.button')
        .evaluateAll((buttons) =>
          buttons
            .filter(
              (button) =>
                button.getBoundingClientRect().width > 0 &&
                button.getBoundingClientRect().height < 44,
            )
            .map((button) => button.textContent.trim()),
        )
      assert.deepEqual(smallButtons, [], label + ' touch targets below 44px at ' + width)
      report.responsive.push({ label, width, horizontalOverflow: false })
    }
    await page.setViewportSize({ width: 1440, height: 1000 })
  }
  const manager = await actor('demo.quantri', true),
    owner = await actor('demo.sinhvien'),
    other = await actor('demo.svkhac'),
    advisor = await actor('demo.covan'),
    faculty = await actor('demo.canbo'),
    foreign = await actor('demo.ngoai')

  phase = 'prepare-period'
  const catalog = await (await request(manager, 'admin', '/training-periods/catalog')).json()
  const period = await (
    await request(manager, 'admin', '/training-periods', 200, {
      method: 'POST',
      data: {
        classId: catalog.classes[0].id,
        academicYear: '2026-2027',
        semester: '1',
        name: 'Sprint 10 — Xuất kết quả giả định',
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
  const proof = await readFile(
    join(project, 'apps/api/scripts/fixtures/recovery/evidence-round-1.pdf'),
  )
  async function submit(student, points) {
    let d = await (
      await request(student, 'user', '/training-periods/' + period.id + '/declaration', 200, {
        method: 'POST',
        data: {},
      })
    ).json()
    d = await (
      await request(student, 'user', '/training-declarations/' + d.id, 200, {
        method: 'PUT',
        data: {
          expectedRevision: d.revision,
          answers: Object.fromEntries(
            ['A', 'B', 'C', 'D', 'E'].map((code) => [
              code,
              {
                points: points[code] ?? 0,
                note: points[code] ? 'Giải trình giả định ' + code : '',
              },
            ]),
          ),
        },
      })
    ).json()
    d = await (
      await request(
        student,
        'user',
        '/training-declarations/' +
          d.id +
          '/evidence/A?expectedRevision=' +
          d.revision +
          '&requestId=' +
          crypto.randomUUID(),
        200,
        {
          method: 'POST',
          multipart: { file: { name: 'proof.pdf', mimeType: 'application/pdf', buffer: proof } },
        },
      )
    ).json()
    return (
      await request(student, 'user', '/training-declarations/' + d.id + '/submit', 200, {
        method: 'POST',
        data: { expectedRevision: d.revision, requestId: crypto.randomUUID() },
      })
    ).json()
  }
  const approvedDeclaration = await submit(owner, { A: 10, B: 5 })
  await submit(other, { A: 6 })
  await request(manager, 'admin', '/training-periods/' + period.id + '/close', 200, {
    method: 'POST',
    data: { expectedRevision: 2 },
  })

  phase = 'approve-one-declaration'
  const reviewPath = '/training-reviews/' + approvedDeclaration.id
  const initial = await (await request(advisor, 'user', reviewPath)).json()
  // ADR 0028: the class monitor step comes first; the advisor bypasses it with a reason.
  await request(advisor, 'user', reviewPath + '/monitor-bypass', 200, {
    method: 'POST',
    data: {
      expectedRevision: 0,
      requestId: crypto.randomUUID(),
      confirmed: true,
      comment: 'Lớp giả định chưa bổ nhiệm lớp trưởng',
    },
  })
  await request(advisor, 'user', reviewPath + '/advisor-sign', 200, {
    method: 'POST',
    data: {
      expectedRevision: 1,
      requestId: crypto.randomUUID(),
      confirmed: true,
      comment: 'Cố vấn đối chiếu giả định',
      answers: {
        ...initial.answers,
        A: { points: 9, note: 'Đối chiếu minh chứng A' },
      },
    },
  })
  const approved = await (
    await request(faculty, 'user', reviewPath + '/faculty-approve', 200, {
      method: 'POST',
      data: {
        expectedRevision: 2,
        requestId: crypto.randomUUID(),
        confirmed: true,
        comment: 'Khoa duyệt giả định',
      },
    })
  ).json()
  assert.equal(approved.state, 'APPROVED')
  assert.equal(approved.decisions.at(-1).totalPoints, 14)
  report.checks.oneApprovedOnePending = true

  phase = 'scope-and-rights'
  for (const [who, status] of [
    [foreign, 404],
    [owner, 403],
  ])
    await request(who, 'user', '/training-reviews/periods/' + period.id + '/export.zip', status, {
      method: 'POST',
      data: {},
    })
  const facultyXlsx = await request(
    faculty,
    'user',
    '/training-reviews/periods/' + period.id + '/export.xlsx',
    200,
    { method: 'POST', data: {} },
  )
  assert.equal(facultyXlsx.headers()['x-export-sha256'], sha256(await facultyXlsx.body()))
  report.checks.outOfScopeAndStudentRefusedFacultyAllowed = true

  phase = 'export-panel'
  const page = advisor.page
  await page.goto(state.webUrl + '/training-reviews')
  await page.getByText('Sẽ xuất', { exact: false }).waitFor()
  const panel = page.locator('section[aria-labelledby="training-export-title"]')
  assert.match(await panel.innerText(), /Sẽ xuất 1 bản khoa đã duyệt\./)
  assert.match(await panel.innerText(), /1 bản chưa duyệt chỉ được đếm trong thống kê/)
  report.checks.previewScopeAndCounts = true
  await responsive(page, 'advisor-export-panel')

  phase = 'downloads'
  const formats = [
    ['xlsx', 'Tải Excel', 'training-points', 'xlsx'],
    ['class-sheet', 'Tải bảng điểm lớp', 'training-class-sheet', 'xlsx'],
    ['docx', 'Tải Word', 'training-minutes', 'docx'],
    ['pdf', 'Tải PDF', 'training-minutes', 'pdf'],
    ['zip', 'Tải gói ZIP', 'training-export', 'zip'],
  ]
  const snapshots = new Set()
  for (const [format, label, prefix, extension] of formats) {
    const waiting = page.waitForEvent('download', { timeout: 120000 })
    await page.getByRole('button', { name: label, exact: true }).click()
    const download = await waiting
    const name = download.suggestedFilename()
    assert.match(name, new RegExp('^' + prefix + '-' + uuid + '\\.' + extension + '$'), name)
    await download.saveAs(join(root, 'export-' + format + '.' + extension))
    const bytes = await readFile(join(root, 'export-' + format + '.' + extension))
    const digest = sha256(bytes)
    const status = panel.getByRole('status').filter({ hasText: 'Đã tải' })
    await status.waitFor()
    const text = await status.innerText()
    assert.ok(text.includes(digest), format + ' hash shown')
    assert.match(text, /đã đối chiếu trên trình duyệt/)
    const snapshotId = name.match(new RegExp(uuid))[0]
    assert.ok(text.includes(snapshotId))
    snapshots.add(snapshotId)
    if (format === 'pdf') assert.equal(bytes.subarray(0, 5).toString('ascii'), '%PDF-')
    else assert.equal(bytes.subarray(0, 2).toString('ascii'), 'PK')
    if (format === 'docx')
      assert.ok(strFromU8(unzipSync(bytes)['word/document.xml']).includes(snapshotId))
    const entry = { format, name, size: bytes.length, sha256: digest, snapshotId }
    if (format === 'zip') {
      const files = unzipSync(bytes),
        manifest = JSON.parse(strFromU8(files['manifest.json']))
      assert.equal(manifest.snapshotId, snapshotId)
      assert.equal(manifest.approvedRows, 1)
      assert.equal(manifest.legalEffect, false)
      assert.equal(manifest.files.length, 4)
      for (const f of manifest.files) assert.equal(sha256(files[f.name]), f.sha256, f.name)
      const pdfName = manifest.files.find((f) => f.name.endsWith('.pdf')).name
      await writeFile(join(root, 'zip-' + pdfName), files[pdfName], { flag: 'wx', mode: 0o600 })
      entry.manifest = manifest.files.map((f) => ({ name: f.name, sha256: f.sha256 }))
      report.checks.zipManifestMatchesEveryFile = true
    }
    report.downloads.push(entry)
  }
  // Each separate download is its own snapshot; only the ZIP ties formats together.
  assert.equal(snapshots.size, formats.length)
  report.checks.browserVerifiedHashBeforeSave = true
  report.checks.everyFormatDownloadsThroughUi = true
  await responsive(page, 'advisor-export-success')

  phase = 'session-expired-clears-data'
  // Names the panel page showed before expiry must disappear, not merely an empty selector.
  const studentNames = await page.locator('.tp-files h3').allInnerTexts()
  assert.ok(studentNames.length >= 2, 'queue rendered student rows before expiry')
  await advisor.context.clearCookies()
  await page.getByRole('button', { name: 'Tải Excel', exact: true }).click()
  await page.getByText('Phiên đăng nhập đã hết hạn', { exact: false }).first().waitFor()
  assert.equal(await page.getByText('Sẽ xuất', { exact: false }).count(), 0)
  for (const name of studentNames)
    assert.equal(await page.getByText(name, { exact: false }).count(), 0, 'still visible: ' + name)
  assert.equal(await page.locator('.tp-files h3').count(), 0)
  assert.equal(await page.locator('#review-period option[value="' + period.id + '"]').count(), 0)
  await page.screenshot({ path: join(root, 'advisor-export-session-expired.png'), fullPage: true })
  report.screenshots.push('advisor-export-session-expired.png')
  report.checks.expiredSessionClearsClassData = true

  assert.deepEqual(report.pageErrors, [])
  report.checks.noBrowserRuntimeErrors = true
  report.status = 'PASS'
  report.periodId = period.id
  report.approvedDeclarationId = approvedDeclaration.id
} catch (error) {
  report.status = 'FAIL'
  report.phase = phase
  report.error = String(error?.message ?? 'BROWSER_FAILURE').slice(0, 3000)
  process.exitCode = 1
  console.error('SPRINT10_BROWSER_FAILED ' + phase)
} finally {
  await browser?.close()
  await writeFile(join(root, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n', {
    flag: 'wx',
    mode: 0o600,
  })
  console.log('SPRINT10_BROWSER_REPORT ' + report.status)
}
