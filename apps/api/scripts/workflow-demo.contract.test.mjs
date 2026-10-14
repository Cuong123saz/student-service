import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { test } from 'node:test'
import {
  assertDemoContainer,
  assertDemoDatabase,
  assertDemoState,
  claimDemoBrowserRun,
  demoAction,
  demoChildExitFailed,
  demoApi,
  demoOrigin,
  demoRunRoot,
  demoProfile,
  documentDemoApi,
  documentDemoOrigin,
} from './workflow-demo.contract.mjs'
test('fake-only launcher accepts start and stop without arbitrary paths or databases', () => {
  assert.equal(demoAction(['--fake-data-only'], {}), 'start')
  assert.equal(demoAction(['--fake-data-only', 'stop'], {}), 'stop')
  assert.equal(demoAction(['--fake-data-only', '--documents'], {}), 'start')
  assert.equal(demoAction(['--fake-data-only', '--documents', 'stop'], {}), 'stop')
  for (const args of [
    [],
    ['stop'],
    ['--fake-data-only', 'reset'],
    ['--fake-data-only', 'stop', 'extra'],
  ])
    assert.throws(() => demoAction(args, {}))
  for (const env of [
    { DATABASE_URL: 'fake' },
    { SUBMISSION_STORAGE_ROOT: 'fake' },
    { APP_ENV: 'production' },
  ])
    assert.throws(() => demoAction(['--fake-data-only'], env))
})
test('demo database cannot use application/test ports, remote hosts or other database names', () => {
  assert.doesNotThrow(() =>
    assertDemoDatabase('postgres://postgres:fake@127.0.0.1:55432/student_service_workflow_demo'),
  )
  for (const url of [
    'postgres://postgres:fake@127.0.0.1:5433/student_service_workflow_demo',
    'postgres://postgres:fake@127.0.0.1:5434/student_service_workflow_demo',
    'postgres://postgres:fake@example.invalid:55432/student_service_workflow_demo',
    'postgres://postgres:fake@127.0.0.1:55432/student_service',
    'postgres://postgres:fake@127.0.0.1:55432/student_service_workflow_demo?options=fake',
  ])
    assert.throws(() => assertDemoDatabase(url))
})
test('cleanup requires matching container ID, label, name, image and only tmpfs storage', () => {
  const runId = randomUUID(),
    id = 'a'.repeat(64)
  const info = {
    Id: id,
    Name: '/student-service-workflow-demo-' + runId,
    Config: { Labels: { 'student-service.workflow-demo-id': runId }, Image: 'postgres:17-alpine' },
    Mounts: [{ Type: 'tmpfs' }],
  }
  assert.doesNotThrow(() => assertDemoContainer(info, runId, id))
  for (const change of [
    { Id: 'b'.repeat(64) },
    { Name: '/student-service-postgres' },
    { Config: { ...info.Config, Image: 'postgres:latest' } },
    { Config: { ...info.Config, Labels: {} } },
    { Mounts: [{ Type: 'volume' }] },
    { Mounts: [{ Type: 'bind' }] },
    { Mounts: undefined },
  ])
    assert.throws(() => assertDemoContainer({ ...info, ...change }, runId, id))
})
test('stop state is bounded by the project UUID folder and separate loopback origin', () => {
  const project = resolve('fixture-project'),
    runId = randomUUID(),
    root = demoRunRoot(project, runId)
  const state = { version: 1, fakeDataOnly: true, runId, webUrl: demoOrigin, apiUrl: demoApi }
  assert.equal(assertDemoState(state, project, resolve(root, 'state.json')), root)
  for (const change of [
    { fakeDataOnly: false },
    { runId: '../../other' },
    { webUrl: 'http://localhost:3001' },
    { apiUrl: 'http://localhost:3000' },
    { webUrl: 'http://127.0.0.2:3013' },
    { profile: 'documents' },
  ])
    assert.throws(() =>
      assertDemoState({ ...state, ...change }, project, resolve(root, 'state.json')),
    )
  assert.throws(() => assertDemoState(state, project, resolve(project, 'state.json')))
})

test('document demo keeps its active state and both URLs separate from the existing workflow', () => {
  const workflow = demoProfile(['--fake-data-only'])
  const documents = demoProfile(['--fake-data-only', '--documents'])
  assert.notEqual(workflow.activeFile, documents.activeFile)
  assert.equal(documents.apiUrl, documentDemoApi)
  assert.equal(documents.webUrl, documentDemoOrigin)
  const project = resolve('fixture-project'),
    runId = randomUUID(),
    root = demoRunRoot(project, runId)
  const state = {
    version: 1,
    fakeDataOnly: true,
    runId,
    profile: 'documents',
    webUrl: documentDemoOrigin,
    apiUrl: documentDemoApi,
  }
  assert.equal(assertDemoState(state, project, resolve(root, 'state.json')), root)
})

test('bundle demo isolates cookies, state and ports and rejects mismatched stop profiles', () => {
  assert.equal(demoAction(['--fake-data-only', '--bundles'], {}), 'start')
  assert.equal(demoAction(['--fake-data-only', '--bundles', 'stop'], {}), 'stop')
  assert.throws(() => demoAction(['--fake-data-only', '--bundles', '--documents'], {}))
  const all = [
    demoProfile(['--fake-data-only']),
    demoProfile(['--fake-data-only', '--documents']),
    demoProfile(['--fake-data-only', '--bundles']),
  ]
  assert.equal(new Set(all.map((p) => new URL(p.webUrl).hostname)).size, 3)
  assert.equal(new Set(all.map((p) => p.activeFile)).size, 3)
  const profile = all[2],
    project = resolve('fixture-project'),
    runId = randomUUID(),
    root = demoRunRoot(project, runId)
  const state = {
    version: 1,
    fakeDataOnly: true,
    runId,
    profile: profile.kind,
    webUrl: profile.webUrl,
    apiUrl: profile.apiUrl,
  }
  assert.equal(assertDemoState(state, project, resolve(root, 'state.json'), 'bundles'), root)
  assert.throws(() => assertDemoState(state, project, resolve(root, 'state.json'), 'workflow'))
  assert.throws(() =>
    assertDemoState({ ...state, profile: 'unknown' }, project, resolve(root, 'state.json')),
  )
})

test('vault profile has its own origin, state and stop request', () => {
  assert.equal(demoAction(['--fake-data-only', '--vault'], {}), 'start')
  assert.equal(demoAction(['--fake-data-only', '--vault', 'stop'], {}), 'stop')
  assert.throws(() => demoAction(['--fake-data-only', '--vault', '--bundles'], {}))
  const all = ['--documents', '--bundles', '--vault'].map((flag) =>
    demoProfile(['--fake-data-only', flag]),
  )
  assert.equal(new Set(all.map((p) => p.webUrl)).size, 3)
  assert.equal(new Set(all.map((p) => p.activeFile)).size, 3)
  const p = all.at(-1),
    project = resolve('fixture-project'),
    id = randomUUID(),
    root = demoRunRoot(project, id)
  const state = {
    version: 1,
    fakeDataOnly: true,
    runId: id,
    profile: 'vault',
    webUrl: p.webUrl,
    apiUrl: p.apiUrl,
  }
  assert.equal(assertDemoState(state, project, resolve(root, 'state.json'), 'vault'), root)
  assert.throws(() => assertDemoState(state, project, resolve(root, 'state.json'), 'bundles'))
})

test('browser claim refuses an existing report and atomically prevents concurrent repeat checks', async (t) => {
  const parent = resolve(tmpdir()),
    project = await mkdtemp(join(parent, 'student-demo-claim-'))
  t.after(async () => {
    assert.equal(dirname(project), parent)
    assert.ok(project.startsWith(join(parent, 'student-demo-claim-')))
    await rm(project, { recursive: true, force: true })
  })
  const id = randomUUID(),
    root = demoRunRoot(project, id)
  await mkdir(root, { recursive: true })
  const outcomes = await Promise.allSettled([
    claimDemoBrowserRun(project, id),
    claimDemoBrowserRun(project, id),
  ])
  assert.equal(outcomes.filter((r) => r.status === 'fulfilled').length, 1)
  assert.equal(outcomes.filter((r) => r.status === 'rejected').length, 1)
  const marker = await readFile(join(root, 'browser-check.claim.json'), 'utf8')
  assert.equal(JSON.parse(marker).runId, id)
  await assert.rejects(claimDemoBrowserRun(project, id))
  assert.equal(await readFile(join(root, 'browser-check.claim.json'), 'utf8'), marker)
  const checked = randomUUID(),
    checkedRoot = demoRunRoot(project, checked)
  await mkdir(checkedRoot)
  await writeFile(join(checkedRoot, 'browser-report.json'), 'existing practice evidence')
  await assert.rejects(claimDemoBrowserRun(project, checked), /WORKFLOW_DEMO_ALREADY_CHECKED/)
  assert.equal(
    await readFile(join(checkedRoot, 'browser-report.json'), 'utf8'),
    'existing practice evidence',
  )
})

test('retry rehearsal has a fifth isolated origin and refuses arbitrary mixed options', () => {
  const p = demoProfile(['--fake-data-only', '--retry'])
  assert.equal(p.kind, 'retry')
  assert.equal(demoAction(['--fake-data-only', '--retry'], {}), 'start')
  assert.equal(demoAction(['--fake-data-only', '--retry', 'stop'], {}), 'stop')
  assert.throws(() => demoAction(['--fake-data-only', '--retry', '--vault'], {}))
  const all = [undefined, '--documents', '--bundles', '--vault', '--retry'].map((flag) =>
    demoProfile(['--fake-data-only', flag]),
  )
  assert.equal(new Set(all.map((p) => new URL(p.webUrl).hostname)).size, 5)
  assert.equal(new Set(all.map((p) => p.activeFile)).size, 5)
  const project = resolve('fixture-project'),
    id = randomUUID(),
    root = demoRunRoot(project, id)
  const state = {
    version: 1,
    fakeDataOnly: true,
    runId: id,
    profile: p.kind,
    webUrl: p.webUrl,
    apiUrl: p.apiUrl,
  }
  assert.equal(assertDemoState(state, project, resolve(root, 'state.json'), 'retry'), root)
  assert.throws(() => assertDemoState(state, project, resolve(root, 'state.json'), 'vault'))
})

test('only a successful one-shot checker exit is normal; server death remains a failure', () => {
  assert.equal(demoChildExitFailed('retry-browser', 0), false)
  assert.equal(demoChildExitFailed('sprint4-browser', 0), false)
  for (const [label, code] of [
    ['api', 0],
    ['web', 0],
    ['retry-browser', 1],
    ['retry-browser', null],
  ])
    assert.equal(demoChildExitFailed(label, code), true)
})

test('workspace demo has separate fixed origins/state and cannot stop the historical vault demo', () => {
  const profile = demoProfile(['--fake-data-only', '--workspace-vault'])
  assert.equal(profile.kind, 'workspace-vault')
  assert.equal(demoAction(['--fake-data-only', '--workspace-vault'], {}), 'start')
  assert.throws(() => demoAction(['--fake-data-only', '--workspace-vault', '--vault'], {}))
  const project = resolve('fixture-project'),
    runId = randomUUID(),
    root = demoRunRoot(project, runId)
  const state = {
    version: 1,
    fakeDataOnly: true,
    profile: profile.kind,
    runId,
    webUrl: profile.webUrl,
    apiUrl: profile.apiUrl,
  }
  assert.equal(
    assertDemoState(state, project, resolve(root, 'state.json'), 'workspace-vault'),
    root,
  )
  assert.throws(() => assertDemoState(state, project, resolve(root, 'state.json'), 'vault'))
})

test('Sprint 4 rehearsal has fixed isolated origins/state and refuses mixed profiles or foreign stop state', () => {
  const profile = demoProfile(['--fake-data-only', '--sprint4'])
  assert.equal(profile.kind, 'sprint4')
  assert.equal(profile.webUrl, 'http://127.0.0.7:3023')
  assert.equal(profile.apiUrl, 'http://127.0.0.7:3022')
  assert.equal(demoAction(['--fake-data-only', '--sprint4'], {}), 'start')
  for (const extra of ['--workspace-vault', '--vault', 'reset'])
    assert.throws(() => demoAction(['--fake-data-only', '--sprint4', extra], {}))
  const project = resolve('fixture-project'),
    runId = randomUUID(),
    root = demoRunRoot(project, runId)
  const state = {
    version: 1,
    fakeDataOnly: true,
    profile: 'sprint4',
    runId,
    webUrl: profile.webUrl,
    apiUrl: profile.apiUrl,
  }
  assert.equal(assertDemoState(state, project, resolve(root, 'state.json'), 'sprint4'), root)
  assert.throws(() =>
    assertDemoState(state, project, resolve(root, 'state.json'), 'workspace-vault'),
  )
  assert.equal(demoChildExitFailed('sprint4-browser', 1), true)
  assert.equal(demoChildExitFailed('sprint4-browser', null), true)
})

test('mock signature rehearsal has a separate origin, state and successful one-shot exit', () => {
  const p = demoProfile(['--fake-data-only', '--mock-signature'])
  assert.equal(p.kind, 'mock-signature')
  assert.equal(demoAction(['--fake-data-only', '--mock-signature'], {}), 'start')
  assert.throws(() => demoAction(['--fake-data-only', '--mock-signature', '--vault'], {}))
  const project = resolve('fixture-project'),
    runId = randomUUID(),
    root = demoRunRoot(project, runId)
  const state = {
    version: 1,
    fakeDataOnly: true,
    runId,
    profile: p.kind,
    webUrl: p.webUrl,
    apiUrl: p.apiUrl,
  }
  assert.equal(assertDemoState(state, project, join(root, 'state.json'), 'mock-signature'), root)
  for (const flag of ['--vault', '--workspace-vault', '--retry', '--sprint4']) {
    const old = demoProfile(['--fake-data-only', flag])
    assert.notEqual(old.activeFile, p.activeFile)
    assert.notEqual(new URL(old.webUrl).hostname, new URL(p.webUrl).hostname)
    assert.throws(() =>
      assertDemoState(
        { ...state, profile: old.kind },
        project,
        join(root, 'state.json'),
        'mock-signature',
      ),
    )
  }
  assert.equal(demoChildExitFailed('mock-signature-browser', 0), false)
  assert.equal(demoChildExitFailed('mock-signature-browser', 1), true)
  assert.equal(demoChildExitFailed('api', 0), true)
})

test('Sprint 5 acceptance owns isolated state, origin, port and one-shot lifecycle', () => {
  const profile = demoProfile(['--fake-data-only', '--sprint5'])
  assert.equal(profile.kind, 'sprint5')
  assert.equal(profile.webUrl, 'http://127.0.0.9:3027')
  assert.equal(profile.apiUrl, 'http://127.0.0.9:3026')
  assert.equal(demoAction(['--fake-data-only', '--sprint5'], {}), 'start')
  assert.equal(demoAction(['--fake-data-only', '--sprint5', 'stop'], {}), 'stop')
  for (const extra of ['--sprint4', '--vault', '--mock-signature', 'reset'])
    assert.throws(() => demoAction(['--fake-data-only', '--sprint5', extra], {}))
  for (const env of [{ DATABASE_URL: 'existing' }, { SUBMISSION_STORAGE_ROOT: 'existing' }])
    assert.throws(() => demoAction(['--fake-data-only', '--sprint5'], env))
  const project = resolve('fixture-project'),
    runId = randomUUID(),
    root = demoRunRoot(project, runId)
  const state = {
    version: 1,
    fakeDataOnly: true,
    runId,
    profile: 'sprint5',
    webUrl: profile.webUrl,
    apiUrl: profile.apiUrl,
  }
  assert.equal(assertDemoState(state, project, join(root, 'state.json'), 'sprint5'), root)
  for (const flag of [undefined, '--sprint4', '--mock-signature', '--workspace-vault']) {
    const old = demoProfile(['--fake-data-only', flag])
    assert.notEqual(old.activeFile, profile.activeFile)
    assert.notEqual(new URL(old.webUrl).hostname, new URL(profile.webUrl).hostname)
    assert.throws(() => assertDemoState(state, project, join(root, 'state.json'), old.kind))
  }
  assert.equal(demoChildExitFailed('sprint5-browser', 0), false)
  assert.equal(demoChildExitFailed('sprint5-browser', 1), true)
  assert.equal(demoChildExitFailed('sprint5-browser', null), true)
})

test('queue totals rehearsal cannot share origins, stop state or caller configuration', () => {
  const p = demoProfile(['--fake-data-only', '--queue-counts'])
  assert.equal(p.kind, 'queue-counts')
  assert.equal(p.webUrl, 'http://127.0.0.10:3029')
  assert.equal(p.apiUrl, 'http://127.0.0.10:3028')
  assert.equal(demoAction(['--fake-data-only', '--queue-counts'], {}), 'start')
  assert.throws(() => demoAction(['--fake-data-only', '--queue-counts', '--sprint5'], {}))
  assert.throws(() =>
    demoAction(['--fake-data-only', '--queue-counts'], { DATABASE_URL: 'existing' }),
  )
  const project = resolve('fixture-project'),
    id = randomUUID(),
    root = demoRunRoot(project, id)
  const state = {
    version: 1,
    fakeDataOnly: true,
    runId: id,
    profile: p.kind,
    webUrl: p.webUrl,
    apiUrl: p.apiUrl,
  }
  assert.equal(assertDemoState(state, project, join(root, 'state.json'), p.kind), root)
  for (const flag of ['--sprint5', '--sprint4', '--mock-signature', '--workspace-vault']) {
    const old = demoProfile(['--fake-data-only', flag])
    assert.notEqual(old.activeFile, p.activeFile)
    assert.notEqual(new URL(old.webUrl).hostname, new URL(p.webUrl).hostname)
    assert.throws(() => assertDemoState(state, project, join(root, 'state.json'), old.kind))
  }
  assert.equal(demoChildExitFailed('queue-counts-browser', 0), false)
  assert.equal(demoChildExitFailed('queue-counts-browser', 1), true)
})
