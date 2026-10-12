import { lstat, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { isAbsolute, resolve } from 'node:path'
import { assertDrillInvocation } from './recovery-bundle.mjs'
export const demoDatabase = 'student_service_workflow_demo'
export const demoOrigin = 'http://127.0.0.1:3011'
export const demoApi = 'http://127.0.0.1:3010'
export const documentDemoOrigin = 'http://127.0.0.2:3013'
export const documentDemoApi = 'http://127.0.0.2:3012'
export const bundleDemoOrigin = 'http://127.0.0.3:3015'
export const bundleDemoApi = 'http://127.0.0.3:3014'
const profiles = {
  workflow: {
    kind: 'workflow',
    webUrl: demoOrigin,
    apiUrl: demoApi,
    activeFile: 'workflow-demo-active.json',
  },
  documents: {
    kind: 'documents',
    webUrl: documentDemoOrigin,
    apiUrl: documentDemoApi,
    activeFile: 'workflow-document-demo-active.json',
  },
  retry: {
    kind: 'retry',
    webUrl: 'http://127.0.0.5:3019',
    apiUrl: 'http://127.0.0.5:3018',
    activeFile: 'workflow-retry-demo-active.json',
  },
  vault: {
    kind: 'vault',
    webUrl: 'http://127.0.0.4:3017',
    apiUrl: 'http://127.0.0.4:3016',
    activeFile: 'workflow-vault-demo-active.json',
  },
  bundles: {
    kind: 'bundles',
    webUrl: bundleDemoOrigin,
    apiUrl: bundleDemoApi,
    activeFile: 'workflow-bundle-demo-active.json',
  },
}
export function demoProfile(args) {
  return profiles[
    args[1] === '--retry'
      ? 'retry'
      : args[1] === '--vault'
        ? 'vault'
        : args[1] === '--documents'
          ? 'documents'
          : args[1] === '--bundles'
            ? 'bundles'
            : 'workflow'
  ]
}
export const demoPassword = 'DemoSinhVien#2026!'
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
export function demoAction(args, env) {
  assertDrillInvocation(args.slice(0, 1), env)
  const rest = args.slice(
    ['--documents', '--bundles', '--vault', '--retry'].includes(args[1]) ? 2 : 1,
  )
  if (!rest.length) return 'start'
  if (rest.length === 1 && rest[0] === 'stop') return 'stop'
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
export function assertDemoState(state, projectRoot, statePath, expectedProfile) {
  const kind = state?.profile ?? 'workflow'
  const profile = Object.hasOwn(profiles, kind) ? profiles[kind] : undefined
  const root = demoRunRoot(projectRoot, state?.runId || '')
  assert.ok(
    state?.version === 1 &&
      state.fakeDataOnly === true &&
      profile &&
      (expectedProfile === undefined || profile.kind === expectedProfile) &&
      state.webUrl === profile.webUrl &&
      state.apiUrl === profile.apiUrl &&
      isAbsolute(statePath) &&
      resolve(statePath) === resolve(root, 'state.json'),
    'INVALID_WORKFLOW_DEMO_STATE',
  )
  return root
}

// One-shot browser checks must never consume another practice run or race each other.
export async function claimDemoBrowserRun(projectRoot, runId) {
  const root = demoRunRoot(projectRoot, runId)
  try {
    await lstat(resolve(root, 'browser-report.json'))
    throw new Error('WORKFLOW_DEMO_ALREADY_CHECKED')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  await writeFile(
    resolve(root, 'browser-check.claim.json'),
    JSON.stringify({ version: 1, fakeDataOnly: true, runId, startedAt: new Date().toISOString() }) +
      '\n',
    { flag: 'wx', mode: 0o600 },
  )
}

export function demoChildExitFailed(label, code) {
  return !(label === 'retry-browser' && code === 0)
}
