// Private one-shot Sprint 5 acceptance against real browser/API/database and private disk storage.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readRecoveryPrivateFile } from './recovery-private-file.mjs'
import { assertRecoveryDirectory } from './recovery-bundle.mjs'
import { assertDemoState, claimDemoBrowserRun, demoPassword } from './workflow-demo.contract.mjs'
import { oldBytes, recoveryValues, recoveryStudent } from './recovery-fixture.mjs'
assert.ok(process.send && process.connected, 'REQUIRES_SPRINT5_DEMO_PARENT')
const project = fileURLToPath(new URL('../../../', import.meta.url))
const statePath = process.env.WORKFLOW_SPRINT5_STATE_PATH
const state = JSON.parse((await readRecoveryPrivateFile(statePath, 65536)).toString('utf8'))
const root = assertDemoState(state, project, statePath, 'sprint5')
await assertRecoveryDirectory(root)
assert.equal(state.status, 'READY')
await claimDemoBrowserRun(project, state.runId)
const service = state.services.find((s) => s.purpose === 'draft-acceptance')
assert.ok(service?.versionId, 'SPRINT5_FIXTURE_REQUIRED')
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
  scope: 'SPRINT_5_STUDENT_SUBMISSION',
  startedAt: new Date().toISOString(),
  checks: {},
  responsive: [],
  pageErrors: [],
  cases: [],
}
let phase = 'login'
async function context() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  ctx.on('page', (p) => p.on('pageerror', (e) => report.pageErrors.push(e.message)))
  await ctx.route('**/*', (route) =>
    [state.webUrl, state.apiUrl].includes(new URL(route.request().url()).origin)
      ? route.continue()
      : route.abort(),
  )
  return ctx
}
async function ready(page) {
  await page.waitForFunction(() => Boolean(document.querySelector('#__nuxt')?.__vue_app__))
  await page.waitForLoadState('networkidle')
}
async function actor(username) {
  const ctx = await context(),
    page = await ctx.newPage()
  await page.goto(state.webUrl + '/login')
  await ready(page)
  await page.getByLabel('Tên đăng nhập', { exact: true }).fill(username)
  await page.getByLabel('Mật khẩu', { exact: true }).fill(demoPassword)
  await page.getByRole('button', { name: 'Đăng nhập vào hệ thống', exact: true }).click()
  await page.waitForURL('**/portal')
  return { context: ctx, page }
}
async function api(ctx, path, method = 'GET', data, expected = 200, origin = state.webUrl) {
  const response = await ctx.request.fetch(state.apiUrl + '/api/v1/user' + path, {
    method,
    data,
    headers: { origin },
  })
  assert.equal(response.status(), expected, method + ' ' + path)
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
  assert.equal(response.status(), expected, method + ' ' + suffix)
  const result = await response.json()
  await page.waitForLoadState('networkidle')
  return result
}
async function save(page, id, expected = 200) {
  return action(
    page,
    'PUT',
    '/submissions/' + id,
    () => page.getByRole('button', { name: 'Lưu bản nháp', exact: true }).click(),
    expected,
  )
}
async function upload(page, name, mimeType, buffer) {
  return action(page, 'POST', '/attachments/proof', () =>
    page.locator('#upload-proof').setInputFiles({ name, mimeType, buffer }),
  )
}
async function remove(page, id, file) {
  return action(page, 'DELETE', '/files/' + file.id, () =>
    page.getByRole('button', { name: 'Gỡ minh chứng ' + file.name, exact: true }).click(),
  )
}
async function rawUpload(ctx, id, revision, name, mimeType, buffer, expected) {
  const response = await ctx.request.post(
    state.apiUrl + '/api/v1/user/submissions/' + id + '/attachments/proof?revision=' + revision,
    { headers: { origin: state.webUrl }, multipart: { file: { name, mimeType, buffer } } },
  )
  assert.equal(response.status(), expected, 'UPLOAD ' + name)
}
async function responsive(page, screen) {
  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      true,
      screen + ' OVERFLOW ' + width,
    )
    report.responsive.push({ screen, width, overflow: false })
    if (width === 375 || width === 1440)
      await page.screenshot({
        path: join(root, screen + '-' + width + '.png'),
        fullPage: true,
        animations: 'disabled',
      })
  }
}
async function open(page, id) {
  await page.goto(state.webUrl + '/submissions/' + id)
  await ready(page)
  await page.locator('#field-fullName').waitFor()
}
try {
  const owner = await actor('demo.sinhvien'),
    other = await actor('demo.svkhac'),
    reviewer = await actor('demo.canbo'),
    guest = await context()
  const page = owner.page
  await api(guest, '/submissions', 'GET', undefined, 401)
  await api(reviewer.context, '/submissions', 'GET', undefined, 403)
  report.checks.activeStudentSessionRequired = true
  phase = 'profile-and-idempotent-create'
  await page.goto(state.webUrl + '/services/' + service.id)
  await ready(page)
  await page.getByRole('button', { name: 'Kê khai / tiếp tục bản nháp', exact: true }).click()
  await page.waitForURL('**/submissions/*')
  const id = new URL(page.url()).pathname.split('/').at(-1),
    path = '/submissions/' + id
  await page.locator('#field-fullName').waitFor()
  let draft = await api(owner.context, path)
  assert.equal(draft.status, 'DRAFT')
  assert.ok((await page.locator('body').innerText()).includes('Tổng tệp tối đa 8 KiB'))
  assert.ok((await page.locator('body').innerText()).includes('4 KiB/tệp'))
  for (const [key, value] of Object.entries(recoveryStudent)) {
    assert.equal(draft.values[key], value)
    assert.equal(await page.locator('#field-' + key).inputValue(), value)
    assert.equal(await page.locator('#field-' + key).getAttribute('readonly'), '')
  }
  const repeated = await api(owner.context, '/submissions', 'POST', {
    serviceId: service.id,
    versionId: service.versionId,
  })
  assert.equal(repeated.id, id)
  assert.equal(repeated.revision, draft.revision)
  report.checks.profileAutoFilledReadonlyAndCreateIdempotent = true
  phase = 'incomplete-save-preview'
  draft = await save(page, id)
  assert.ok(draft.issues.length >= 7)
  assert.equal(draft.status, 'DRAFT')
  await page.getByRole('button', { name: 'Xem lại thông tin', exact: true }).click()
  const summary = page.getByRole('complementary', { name: 'Xem lại thông tin' })
  assert.equal(await summary.evaluate((el) => el === document.activeElement), true)
  assert.ok((await summary.getByRole('link').count()) >= 7)
  assert.equal(await page.locator('#confirm-submission').isDisabled(), true)
  await api(owner.context, path + '/submit', 'POST', { expectedRevision: draft.revision }, 422)
  await responsive(page, 'sprint5-incomplete-draft')
  report.checks.partialSaveListsMissingFieldsAndBlocksSubmit = true
  phase = 'typed-values-and-unsaved-preview'
  const values = recoveryValues(1)
  values.purpose = 'Mục đích giả định <img src=x onerror=alert(1)> — thử dấu tiếng Việt.'
  for (const key of ['reference', 'purpose', 'completedCredits', 'neededOn'])
    await page.locator('#field-' + key).fill(String(values[key]))
  for (const key of ['purposeType', 'instructionsReceived'])
    await page.locator('#field-' + key).selectOption(String(values[key]))
  await page.getByRole('button', { name: 'Xem lại thông tin', exact: true }).click()
  assert.ok((await summary.innerText()).includes(values.purpose))
  assert.ok((await summary.innerText()).includes('có thay đổi chưa lưu'))
  assert.equal(await summary.locator('img').count(), 0)
  assert.equal(await page.locator('#upload-proof').isDisabled(), true)
  draft = await save(page, id)
  for (const [key, value] of Object.entries(values)) assert.equal(draft.values[key], value)
  assert.equal(typeof draft.values.completedCredits, 'number')
  assert.equal(typeof draft.values.instructionsReceived, 'boolean')
  assert.equal(draft.values.completedCredits, 0)
  assert.equal(draft.values.instructionsReceived, false)
  await api(
    owner.context,
    path,
    'PUT',
    { expectedRevision: draft.revision, values: { fullName: 'Thông tin tự giả mạo' } },
    422,
  )
  await api(
    owner.context,
    path,
    'PUT',
    { expectedRevision: draft.revision, values: { completedCredits: '0' } },
    422,
  )
  await api(
    owner.context,
    path,
    'PUT',
    { expectedRevision: draft.revision, values: {} },
    403,
    'http://example.invalid',
  )
  assert.equal((await api(owner.context, path)).revision, draft.revision)
  report.checks.sixTypesZeroFalseEscapedPreviewAndServerProfileAuthority = true
  phase = 'concurrent-tabs'
  const second = await owner.context.newPage()
  await open(second, id)
  await page.locator('#field-purpose').fill('Nội dung đã lưu từ tab thứ nhất — giả định')
  draft = await save(page, id)
  const local = 'Nội dung đang nhập ở tab thứ hai — phải giữ lại'
  await second.locator('#field-purpose').fill(local)
  await save(second, id, 409)
  assert.equal(await second.locator('#field-purpose').inputValue(), local)
  assert.equal(
    await second.getByRole('button', { name: 'Lưu bản nháp', exact: true }).isDisabled(),
    true,
  )
  await second
    .getByRole('button', { name: 'Tải bản lưu mới, giữ nội dung đang nhập', exact: true })
    .click()
  await second.waitForLoadState('networkidle')
  assert.equal(await second.locator('#field-purpose').inputValue(), local)
  draft = await save(second, id)
  assert.equal(draft.values.purpose, local)
  await second.close()
  await open(page, id)
  report.checks.conflict409KeepsLocalInputAndReloadedRevision = true
  phase = 'invalid-files'
  await rawUpload(
    owner.context,
    id,
    draft.revision,
    'wrong.pdf',
    'application/pdf',
    Buffer.from('<html>not PDF</html>'),
    422,
  )
  await rawUpload(
    owner.context,
    id,
    draft.revision,
    'large.pdf',
    'application/pdf',
    Buffer.concat([oldBytes, Buffer.alloc(4097)]),
    422,
  )
  await rawUpload(
    owner.context,
    id,
    draft.revision,
    'over-global.pdf',
    'application/pdf',
    Buffer.alloc(5 * 1048576 + 1),
    413,
  )
  assert.equal((await api(owner.context, path)).revision, draft.revision)
  report.checks.invalidContentPerFileAndGlobalSizeRejectedWithoutMutation = true
  phase = 'private-upload-and-exact-download'
  draft = await upload(page, 'minh-chung-gia.pdf', 'application/pdf', oldBytes)
  const pdf = draft.files.find((f) => f.name === 'minh-chung-gia.pdf')
  assert.equal(pdf.sha256, createHash('sha256').update(oldBytes).digest('hex'))
  assert.equal(pdf.signatureStatus, 'NOT_CHECKED')
  assert.ok((await page.locator('body').innerText()).includes('Chữ ký chưa được xác minh'))
  const filePath = path + '/files/' + pdf.id
  const response = await owner.context.request.get(state.apiUrl + '/api/v1/user' + filePath)
  assert.equal(response.status(), 200)
  assert.deepEqual(await response.body(), oldBytes)
  assert.equal(response.headers()['cache-control'], 'private, no-store')
  assert.equal(response.headers()['x-content-type-options'], 'nosniff')
  assert.match(response.headers()['content-disposition'], /^attachment;/)
  const downloadPending = page.waitForEvent('download')
  await page.getByRole('link', { name: pdf.name, exact: true }).click()
  const downloaded = await downloadPending,
    downloadedPath = join(root, 'student-evidence.pdf')
  await downloaded.saveAs(downloadedPath)
  assert.deepEqual(await readFile(downloadedPath), oldBytes)
  await api(guest, filePath, 'GET', undefined, 401)
  await api(other.context, filePath, 'GET', undefined, 404)
  await api(other.context, path, 'GET', undefined, 404)
  await api(other.context, path, 'PUT', { expectedRevision: draft.revision, values: {} }, 404)
  await api(reviewer.context, path, 'GET', undefined, 403)
  assert.equal(JSON.stringify(draft).includes('storageKey'), false)
  report.checks.privateEvidenceOriginalBytesHashAndOwnerIsolation = true
  phase = 'images-count-remove-and-reupload'
  const images = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, 1, 1)
    return {
      png: canvas.toDataURL('image/png').split(',')[1],
      jpeg: canvas.toDataURL('image/jpeg').split(',')[1],
    }
  })
  draft = await upload(page, 'gia-dinh.png', 'image/png', Buffer.from(images.png, 'base64'))
  assert.equal(draft.files.length, 2)
  assert.equal(await page.locator('#upload-proof').isDisabled(), true)
  await rawUpload(owner.context, id, draft.revision, 'third.pdf', 'application/pdf', oldBytes, 422)
  const png = draft.files.find((f) => f.name === 'gia-dinh.png')
  assert.deepEqual(
    await api(owner.context, path + '/files/' + png.id),
    Buffer.from(images.png, 'base64'),
  )
  draft = await remove(page, id, png)
  await api(owner.context, path + '/files/' + png.id, 'GET', undefined, 404)
  draft = await upload(page, 'gia-dinh.jpeg', 'image/jpeg', Buffer.from(images.jpeg, 'base64'))
  const jpeg = draft.files.find((f) => f.name === 'gia-dinh.jpeg')
  assert.equal(jpeg.mimeType, 'image/jpeg')
  assert.equal(jpeg.signatureStatus, 'NOT_CHECKED')
  assert.deepEqual(
    await api(owner.context, path + '/files/' + jpeg.id),
    Buffer.from(images.jpeg, 'base64'),
  )
  draft = await remove(page, id, jpeg)
  assert.equal(draft.files.length, 1)
  await responsive(page, 'sprint5-complete-draft')
  report.checks.pdfPngJpegCountLimitSoftRemoveAndReupload = true
  phase = 'resume-list-and-preview'
  await page.goto(state.webUrl + '/submissions')
  await ready(page)
  const link = page.locator('a[href="/submissions/' + id + '"]')
  await link.waitFor()
  assert.equal(await link.count(), 1)
  await responsive(page, 'sprint5-own-submissions')
  await link.click()
  await ready(page)
  assert.equal(await page.locator('#field-purpose').inputValue(), local)
  assert.equal(await page.locator('#field-completedCredits').inputValue(), '0')
  assert.equal(await page.locator('#field-instructionsReceived').inputValue(), 'false')
  await page.getByRole('button', { name: 'Xem lại thông tin', exact: true }).click()
  assert.equal(await summary.getByRole('link').count(), 0)
  assert.equal(await page.locator('#confirm-submission').isDisabled(), false)
  assert.equal(
    await page.getByRole('button', { name: 'Gửi hồ sơ', exact: true }).isDisabled(),
    true,
  )
  assert.equal(
    (await api(other.context, '/submissions')).some((s) => s.id === id),
    false,
  )
  report.checks.resumeOwnDraftFromListPreservesAnswersAndFiles = true
  phase = 'explicit-confirmation-and-freeze'
  await page.locator('#confirm-submission').check()
  const submitted = await action(page, 'POST', '/submit', () =>
    page.getByRole('button', { name: 'Gửi hồ sơ', exact: true }).click(),
  )
  assert.equal(submitted.status, 'SUBMITTED')
  assert.equal(submitted.rounds.length, 1)
  assert.equal(submitted.rounds[0].values.purpose, local)
  assert.equal(submitted.editable, false)
  assert.equal(submitted.files[0].sha256, pdf.sha256)
  assert.equal(submitted.files[0].signatureStatus, 'NOT_CHECKED')
  assert.equal(await page.locator('#upload-proof').count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Lưu bản nháp', exact: true }).count(), 0)
  await api(owner.context, path, 'PUT', { expectedRevision: submitted.revision, values: {} }, 409)
  const replay = await api(owner.context, path + '/submit', 'POST', {
    expectedRevision: draft.revision,
  })
  assert.equal(replay.revision, submitted.revision)
  report.checks.explicitConfirmationFreezesSubmittedSnapshotWithoutDuplicate = true
  report.cases.push({
    id,
    revision: submitted.revision,
    status: submitted.status,
    fileCount: submitted.files.length,
  })
  phase = 'offline-ctsv'
  const offline = state.services.find((s) => s.purpose === 'offline')
  await page.goto(state.webUrl + '/services/' + offline.id)
  await ready(page)
  assert.ok((await page.locator('body').innerText()).includes('Phòng CTSV'))
  assert.equal(
    await page.getByRole('button', { name: 'Kê khai / tiếp tục bản nháp', exact: true }).count(),
    0,
  )
  await api(
    owner.context,
    '/submissions',
    'POST',
    { serviceId: offline.id, versionId: offline.versionId },
    409,
  )
  await responsive(page, 'sprint5-confirmation-ctsv')
  report.checks.studentConfirmationStaysOfflineAtCTSV = true
  assert.deepEqual(report.pageErrors, [])
  report.checks.noBrowserJavascriptErrors = true
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
      event: 'SPRINT5_BROWSER_RESULT',
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
