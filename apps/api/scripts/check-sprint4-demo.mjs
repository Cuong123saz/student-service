// Private one-shot Sprint 4 acceptance: real browser/API/database, synthetic fixtures only.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readRecoveryPrivateFile } from './recovery-private-file.mjs'
import { assertRecoveryDirectory } from './recovery-bundle.mjs'
import { assertDemoState, claimDemoBrowserRun, demoPassword } from './workflow-demo.contract.mjs'
assert.ok(process.send && process.connected, 'REQUIRES_SPRINT4_DEMO_PARENT')
const project = fileURLToPath(new URL('../../../', import.meta.url))
const statePath = process.env.WORKFLOW_SPRINT4_STATE_PATH
const state = JSON.parse((await readRecoveryPrivateFile(statePath, 65536)).toString('utf8'))
const root = assertDemoState(state, project, statePath, 'sprint4')
await assertRecoveryDirectory(root)
assert.equal(state.status, 'READY')
await claimDemoBrowserRun(project, state.runId)
const service = state.services.find((s) => s.purpose === 'configuration')
assert.ok(service && service.ownerUnitId, 'SPRINT4_FIXTURE_REQUIRED')
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
  scope: 'SPRINT_4_PROCEDURE_CONFIGURATION',
  checks: {},
  responsive: [],
  pageErrors: [],
  versions: [],
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
async function actor(username, admin = true) {
  const ctx = await context(),
    page = await ctx.newPage()
  await page.goto(state.webUrl + (admin ? '/admin/login' : '/login'))
  await ready(page)
  await page.getByLabel('Tên đăng nhập', { exact: true }).fill(username)
  await page.getByLabel('Mật khẩu', { exact: true }).fill(demoPassword)
  await page
    .getByRole('button', { name: admin ? 'Đăng nhập' : 'Đăng nhập vào hệ thống', exact: true })
    .click()
  await page.waitForURL(admin ? /\/admin\/?$/ : '**/portal')
  return { context: ctx, page }
}
async function api(ctx, path, method = 'GET', data, status = 200, admin = true) {
  const url = state.apiUrl + (admin ? '/api/v1/admin' : '') + path
  const response = await ctx.request.fetch(url, { method, data, headers: { origin: state.webUrl } })
  assert.equal(response.status(), status, 'API ' + method + ' ' + path)
  return response.json()
}
async function openEditor(page) {
  await page.goto(state.webUrl + '/admin/procedures')
  await ready(page)
  await page.locator('#procedure-service').selectOption(String(service.id))
  await page.waitForLoadState('networkidle')
}
async function action(page, method, suffix, perform, status = 200) {
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) => r.request().method() === method && new URL(r.url()).pathname.endsWith(suffix),
    ),
    perform(),
  ])
  assert.equal(response.status(), status, method + ' ' + suffix)
  const result = await response.json()
  await page.waitForLoadState('networkidle')
  return result
}
async function save(page, version, status = 200) {
  return action(
    page,
    'PUT',
    '/procedure-versions/' + version.id,
    () => page.getByRole('button', { name: 'Lưu bản nháp', exact: true }).click(),
    status,
  )
}
async function publish(page, version) {
  return action(page, 'POST', '/procedure-versions/' + version.id + '/publish', () =>
    page.getByRole('button', { name: 'Áp dụng cấu hình', exact: true }).click(),
  )
}
async function responsive(page, label) {
  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      true,
      label + ' OVERFLOW ' + width,
    )
    report.responsive.push({ screen: label, width, overflow: false })
    if (width === 375 || width === 1440)
      await page.screenshot({
        path: join(root, label + '-' + width + '.png'),
        fullPage: true,
        animations: 'disabled',
      })
  }
}
try {
  const admin = await actor('demo.quantri'),
    page = admin.page
  const catalog = await api(admin.context, '/procedure-catalog')
  assert.equal(catalog.canCreate, true)
  await openEditor(page)
  await page.locator('#procedure-owner').selectOption(service.ownerUnitId)
  phase = 'create-and-default-offline'
  let draft = await action(
    page,
    'POST',
    '/services/' + service.id + '/procedure-versions',
    () => page.getByRole('button', { name: 'Tạo cấu hình', exact: true }).click(),
    201,
  )
  assert.equal(draft.config.processingMode, 'OFFLINE')
  assert.equal(draft.config.processorUserId, null)
  assert.equal(await page.locator('#processing-mode').inputValue(), 'OFFLINE')
  const guest = await context(),
    guestPage = await guest.newPage()
  assert.equal(
    (await api(guest, '/services/' + service.id + '/procedure', 'GET', undefined, 200, false))
      .procedure,
    null,
  )
  report.checks.newDraftDefaultsOfflineAndIsNotPublic = true
  phase = 'all-field-types-attachments-and-preview'
  await page
    .locator('#contact-instructions')
    .fill('Hướng dẫn giả định: liên hệ Phòng CTSV để đối chiếu thông tin. Lần 1.')
  for (const [offset, type] of [
    'TEXT',
    'TEXTAREA',
    'NUMBER',
    'DATE',
    'SELECT',
    'BOOLEAN',
  ].entries()) {
    await page.getByRole('button', { name: 'Thêm trường', exact: true }).click()
    const index = 2 + offset
    await page.locator('#field-label-' + index).fill('Trường giả định ' + type)
    await page.locator('#field-type-' + index).selectOption(type)
    if (type === 'SELECT')
      await page.locator('#field-options-' + index).fill('Lựa chọn A\nLựa chọn B')
  }
  await page.locator('#field-label-2').fill('<script>window.sprint4Injected=true</script>')
  assert.equal(await page.evaluate(() => window.sprint4Injected), undefined)
  await page.getByRole('button', { name: 'Thêm minh chứng', exact: true }).click()
  await page.locator('#attachment-label-0').fill('Minh chứng giả định')
  await page.locator('#attachment-files-0').fill('2')
  await page.locator('#attachment-type-0').selectOption(['application/pdf', 'image/png'])
  assert.equal(
    await page.getByRole('button', { name: 'Áp dụng cấu hình', exact: true }).isDisabled(),
    true,
  )
  draft = await save(page, draft)
  assert.deepEqual(
    new Set(draft.config.fields.map((f) => f.type)),
    new Set(['TEXT', 'TEXTAREA', 'NUMBER', 'DATE', 'SELECT', 'BOOLEAN']),
  )
  assert.equal(draft.config.fields.length, 8)
  assert.equal(draft.config.attachments[0].maxFiles, 2)
  assert.deepEqual(draft.config.attachments[0].mimeTypes, ['application/pdf', 'image/png'])
  assert.equal(draft.config.fields[0].source, 'PROFILE')
  report.checks.sixTypesProfileSourcesAttachmentsAndEscapedPreview = true
  phase = 'server-validation'
  await page.locator('#field-label-2').fill('')
  await save(page, draft, 400)
  assert.ok(await page.getByRole('alert').isVisible())
  await page.locator('#field-label-2').fill('Mục đích giả định')
  draft = await save(page, draft)
  report.checks.invalidConfigurationRejectedAndCanBeCorrected = true
  phase = 'real-concurrent-edit-conflict'
  const second = await admin.context.newPage()
  await openEditor(second)
  const staleText = 'Nội dung chưa lưu của tab thứ hai — giả định'
  await second.locator('#contact-instructions').fill(staleText)
  await page.locator('#contact-instructions').fill('Hướng dẫn giả định đã được lưu ở tab thứ nhất.')
  draft = await save(page, draft)
  await save(second, draft, 409)
  assert.equal(await second.locator('#contact-instructions').inputValue(), staleText)
  assert.ok(await second.getByRole('alert').isVisible())
  await second.close()
  report.checks.revisionConflictPreservesUnsavedUserText = true
  phase = 'publish-v1-and-anonymous-view'
  const first = await publish(page, draft)
  assert.equal(first.status, 'PUBLISHED')
  assert.equal(await page.locator('#processing-mode').isDisabled(), true)
  const publicFirst = (
    await api(guest, '/services/' + service.id + '/procedure', 'GET', undefined, 200, false)
  ).procedure
  assert.equal(publicFirst.versionId, first.id)
  assert.equal(publicFirst.processingMode, 'OFFLINE')
  assert.equal(Object.hasOwn(publicFirst, 'processorUserId'), false)
  assert.equal(Object.hasOwn(publicFirst, 'ownerUnitId'), false)
  await guestPage.goto(state.webUrl + '/services/' + service.id)
  await ready(guestPage)
  assert.ok(
    (await guestPage.locator('body').innerText()).includes(first.config.contactInstructions),
  )
  assert.equal(
    await guestPage.getByRole('link', { name: 'Đăng nhập để tiếp tục', exact: true }).count(),
    0,
  )
  await responsive(page, 'sprint4-published-admin')
  await responsive(guestPage, 'sprint4-public-offline')
  await api(
    admin.context,
    '/procedure-versions/' + first.id,
    'PUT',
    { expectedRevision: first.revision, config: first.config },
    409,
  )
  report.checks.publishedConfigurationIsLockedPublicAndHidesStaffIdentity = true
  phase = 'scope-and-portal-boundaries'
  const owner = await actor('demo.canbo'),
    foreign = await actor('demo.ngoai')
  const ownerCatalog = await api(owner.context, '/procedure-catalog')
  assert.equal(ownerCatalog.canCreate, false)
  assert.ok(ownerCatalog.services.some((s) => s.id === service.id))
  const foreignCatalog = await api(foreign.context, '/procedure-catalog')
  assert.equal(
    foreignCatalog.services.some((s) => s.id === service.id),
    false,
  )
  assert.deepEqual(
    await api(foreign.context, '/services/' + service.id + '/procedure-versions'),
    [],
  )
  await api(
    foreign.context,
    '/procedure-versions/' + first.id + '/validate',
    'POST',
    undefined,
    403,
  )
  await api(guest, '/procedure-catalog', 'GET', undefined, 401)
  const student = await actor('demo.sinhvien', false)
  await api(student.context, '/procedure-catalog', 'GET', undefined, 401)
  report.checks.ownerScopeForeignScopeAnonymousAndStudentPortalEnforced = true
  phase = 'organization-clone-online-routing-and-v2'
  await openEditor(owner.page)
  let secondVersion = await action(
    owner.page,
    'POST',
    '/services/' + service.id + '/procedure-versions',
    () => owner.page.getByRole('button', { name: 'Tạo phiên bản mới', exact: true }).click(),
    201,
  )
  assert.equal(secondVersion.versionNumber, 2)
  assert.deepEqual(secondVersion.config, first.config)
  await owner.page.locator('#processing-mode').selectOption('ONLINE')
  const scopedReviewer = ownerCatalog.reviewers.find((r) => r.unitId === service.ownerUnitId)
  assert.ok(scopedReviewer)
  await owner.page.locator('#processing-person').selectOption(scopedReviewer.id)
  await owner.page
    .locator('#contact-instructions')
    .fill('Bản 2 — cấu hình trực tuyến giả định do đúng đơn vị duy trì.')
  secondVersion = await save(owner.page, secondVersion)
  const otherUnit = catalog.units.find((u) => u.id !== service.ownerUnitId)
  assert.ok(otherUnit)
  await api(
    owner.context,
    '/procedure-versions/' + secondVersion.id,
    'PUT',
    {
      expectedRevision: secondVersion.revision,
      config: { ...secondVersion.config, processingUnitId: otherUnit.id, processorUserId: null },
    },
    403,
  )
  secondVersion = await publish(owner.page, secondVersion)
  const versions = await api(admin.context, '/services/' + service.id + '/procedure-versions')
  assert.equal(versions.length, 2)
  assert.equal(versions.filter((v) => v.status === 'PUBLISHED').length, 1)
  const retired = versions.find((v) => v.id === first.id)
  assert.equal(retired.status, 'RETIRED')
  assert.deepEqual(retired.config, first.config)
  assert.equal(
    (await api(guest, '/services/' + service.id + '/procedure', 'GET', undefined, 200, false))
      .procedure.versionId,
    secondVersion.id,
  )
  await guestPage.reload()
  await ready(guestPage)
  assert.equal(
    await guestPage.getByRole('link', { name: 'Đăng nhập để tiếp tục', exact: true }).count(),
    1,
  )
  await responsive(owner.page, 'sprint4-published-v2')
  report.versions = versions.map((v) => ({
    id: v.id,
    versionNumber: v.versionNumber,
    revision: v.revision,
    status: v.status,
  }))
  report.checks.organizationCloneScopedReviewerAndImmutableHistory = true
  phase = 'student-confirmation-stays-offline'
  const offline = state.services.find((s) => s.purpose === 'offline')
  const confirmation = (
    await api(guest, '/services/' + offline.id + '/procedure', 'GET', undefined, 200, false)
  ).procedure
  assert.equal(confirmation.processingMode, 'OFFLINE')
  await guestPage.goto(state.webUrl + '/services/' + offline.id)
  await ready(guestPage)
  assert.ok((await guestPage.locator('body').innerText()).includes('Phòng CTSV'))
  assert.equal(
    await guestPage.getByRole('link', { name: 'Đăng nhập để tiếp tục', exact: true }).count(),
    0,
  )
  await responsive(guestPage, 'sprint4-confirmation-ctsv')
  report.checks.studentConfirmationRemainsDirectAtCTSV = true
  phase = 'audit-history'
  const audit = (await api(admin.context, '/audit-logs?limit=100')).auditLogs.filter((e) =>
    [first.id, secondVersion.id].includes(e.resourceId),
  )
  const actions = {}
  for (const event of audit) {
    assert.equal(event.outcome, 'SUCCESS')
    assert.equal(event.actorType, 'USER')
    assert.equal(event.metadata.serviceId, service.id)
    assert.match(event.metadata.configHash, /^[a-f0-9]{64}$/)
    assert.equal(Object.hasOwn(event.metadata, 'config'), false)
    actions[event.action] = (actions[event.action] || 0) + 1
  }
  assert.deepEqual(actions, {
    PROCEDURE_VERSION_PUBLISH: 2,
    PROCEDURE_VERSION_RETIRE: 1,
    PROCEDURE_DRAFT_UPDATE: 4,
    PROCEDURE_DRAFT_CREATE: 2,
  })
  report.audit = { count: audit.length, actions }
  report.checks.auditRecordsOnlySuccessfulVersionChanges = true
  assert.equal(report.pageErrors.length, 0)
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
      event: 'SPRINT4_BROWSER_RESULT',
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
