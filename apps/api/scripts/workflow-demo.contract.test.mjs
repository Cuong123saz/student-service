import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { test } from 'node:test'
import {
  assertDemoContainer,
  assertDemoDatabase,
  assertDemoState,
  demoAction,
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
