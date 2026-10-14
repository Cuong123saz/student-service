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
    workspace = env.WORKFLOW_VAULT_MODE === 'workspace',
    signature = env.WORKFLOW_VAULT_MODE === 'signature',
    sprint6 = env.WORKFLOW_VAULT_MODE === 'sprint6'
  assert.ok(
    !env.WORKFLOW_VAULT_MODE || retry || workspace || signature || sprint6,
    'INVALID_VAULT_DEMO_MODE',
  )
  const host = sprint6
    ? '127.0.0.11'
    : signature
      ? '127.0.0.8'
      : workspace
        ? '127.0.0.6'
        : retry
          ? '127.0.0.5'
          : '127.0.0.4'
  const port = sprint6 ? '3030' : signature ? '3024' : workspace ? '3020' : retry ? '3018' : '3016'
  const origin = 'http://' + host + ':' + (Number(port) + 1)
  assert.ok(
    env.API_HOST === host &&
      env.API_PORT === port &&
      env.CORS_ORIGIN === origin &&
      env.WEB_BASE_URL === origin,
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
