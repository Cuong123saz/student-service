import assert from 'node:assert/strict'
import { isAbsolute, join, resolve } from 'node:path'
export function vaultDemoPaths(projectRoot, runId) {
  assert.ok(
    isAbsolute(projectRoot) &&
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(runId),
    'INVALID_VAULT_DEMO_ID',
  )
  const runRoot = resolve(projectRoot, 'run/workflow-demo', runId),
    api = join(runRoot, 'runtime/api'),
    vault = join(runRoot, 'vault')
  return {
    projectRoot: resolve(projectRoot),
    runRoot,
    api,
    entry: join(api, 'workflow-vault-api.mjs'),
    evidence: join(runRoot, 'evidence'),
    fakeEnv: join(runRoot, 'fake.env'),
    vault,
    output: join(vault, 'documents'),
    staging: join(vault, 'staging'),
    templates: join(vault, 'templates'),
  }
}
export function assertVaultDemoEnvironment(projectRoot, env, entry, hasIpc) {
  const p = vaultDemoPaths(projectRoot, env.WORKFLOW_VAULT_DEMO_ID || '')
  assert.ok(
    hasIpc && env.APP_ENV === 'test' && resolve(entry) === p.entry,
    'REQUIRES_OWNED_VAULT_DEMO_PARENT',
  )
  assert.ok(
    env.DOTENV_CONFIG_PATH === p.fakeEnv && env.SUBMISSION_STORAGE_ROOT === p.evidence,
    'INVALID_VAULT_DEMO_STORAGE',
  )
  const retry = env.WORKFLOW_VAULT_MODE === 'retry',
    workspace = env.WORKFLOW_VAULT_MODE === 'workspace'
  assert.ok(!env.WORKFLOW_VAULT_MODE || retry || workspace, 'INVALID_VAULT_DEMO_MODE')
  assert.ok(
    env.API_HOST === (workspace ? '127.0.0.6' : retry ? '127.0.0.5' : '127.0.0.4') &&
      env.API_PORT === (workspace ? '3020' : retry ? '3018' : '3016') &&
      env.CORS_ORIGIN ===
        (workspace
          ? 'http://127.0.0.6:3021'
          : retry
            ? 'http://127.0.0.5:3019'
            : 'http://127.0.0.4:3017') &&
      env.WEB_BASE_URL === env.CORS_ORIGIN,
    'INVALID_VAULT_DEMO_ORIGIN',
  )
  const u = new URL(env.DATABASE_URL)
  assert.ok(
    u.protocol === 'postgres:' &&
      u.hostname === '127.0.0.1' &&
      u.pathname === '/student_service_workflow_demo' &&
      u.port &&
      Number(u.port) > 0 &&
      Number(u.port) <= 65535 &&
      !['5433', '5434'].includes(u.port) &&
      u.username === 'postgres' &&
      u.password &&
      !u.search &&
      !u.hash,
    'INVALID_VAULT_DEMO_DATABASE',
  )
  assert.ok(
    isAbsolute(env.LIBREOFFICE_PATH || '') && env.LIBREOFFICE_PATH.endsWith('soffice.com'),
    'INVALID_VAULT_DEMO_CONVERTER',
  )
  return p
}
