import assert from 'node:assert/strict'
import { isAbsolute, resolve } from 'node:path'
import { assertDrillInvocation } from './recovery-bundle.mjs'
export const demoDatabase = 'student_service_workflow_demo'
export const demoOrigin = 'http://127.0.0.1:3011'
export const demoApi = 'http://127.0.0.1:3010'
export const demoPassword = 'DemoSinhVien#2026!'
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
export function demoAction(args, env) {
  assertDrillInvocation(args.slice(0, 1), env)
  if (args.length === 1) return 'start'
  if (args.length === 2 && args[1] === 'stop') return 'stop'
  throw new Error('INVALID_WORKFLOW_DEMO_OPTIONS')
}
export function assertDemoDatabase(url) {
  const parsed = new URL(url)
  assert.ok(
    parsed.protocol === 'postgres:' &&
      parsed.hostname === '127.0.0.1' &&
      parsed.port &&
      !['5433', '5434'].includes(parsed.port) &&
      parsed.pathname === '/' + demoDatabase &&
      !parsed.search &&
      !parsed.hash,
    'INVALID_WORKFLOW_DEMO_DATABASE',
  )
}
export function assertDemoContainer(info, runId, containerId) {
  assert.ok(
    uuid.test(runId) &&
      /^[a-f0-9]{64}$/.test(containerId) &&
      info.Id === containerId &&
      info.Name === '/student-service-workflow-demo-' + runId &&
      info.Config?.Labels?.['student-service.workflow-demo-id'] === runId &&
      info.Config?.Image === 'postgres:17-alpine' &&
      Array.isArray(info.Mounts) &&
      !info.Mounts.some((m) => m.Type !== 'tmpfs'),
    'WORKFLOW_DEMO_OWNERSHIP_MISMATCH',
  )
}
export function demoRunRoot(projectRoot, runId) {
  assert.ok(isAbsolute(projectRoot) && uuid.test(runId), 'INVALID_WORKFLOW_DEMO_STATE')
  return resolve(projectRoot, 'run/workflow-demo', runId)
}
export function assertDemoState(state, projectRoot, statePath) {
  const root = demoRunRoot(projectRoot, state?.runId || '')
  assert.ok(
    state?.version === 1 &&
      state.fakeDataOnly === true &&
      state.webUrl === demoOrigin &&
      state.apiUrl === demoApi &&
      isAbsolute(statePath) &&
      resolve(statePath) === resolve(root, 'state.json'),
    'INVALID_WORKFLOW_DEMO_STATE',
  )
  return root
}
