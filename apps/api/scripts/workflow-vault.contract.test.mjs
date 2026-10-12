import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { vaultDemoPaths, assertVaultDemoEnvironment } from './workflow-vault.contract.mjs'
test('vault child refuses source entry, absent IPC, inherited development database and foreign roots before importing the API', () => {
  const root = resolve('fixture-project'),
    id = randomUUID(),
    p = vaultDemoPaths(root, id)
  const env = {
    WORKFLOW_VAULT_DEMO_ID: id,
    APP_ENV: 'test',
    DOTENV_CONFIG_PATH: p.fakeEnv,
    SUBMISSION_STORAGE_ROOT: p.evidence,
    API_HOST: '127.0.0.4',
    API_PORT: '3016',
    CORS_ORIGIN: 'http://127.0.0.4:3017',
    WEB_BASE_URL: 'http://127.0.0.4:3017',
    DATABASE_URL: 'postgres://postgres:fake@127.0.0.1:55555/student_service_workflow_demo',
    LIBREOFFICE_PATH: resolve('tools/soffice.com'),
  }
  assert.deepEqual(assertVaultDemoEnvironment(root, env, p.entry, true), p)
  assert.throws(() => assertVaultDemoEnvironment(root, env, p.entry, false))
  assert.throws(() =>
    assertVaultDemoEnvironment(root, env, resolve('apps/api/scripts/workflow-vault-api.mjs'), true),
  )
  for (const changes of [
    { WORKFLOW_VAULT_DEMO_ID: '../../other' },
    { APP_ENV: 'production' },
    { DOTENV_CONFIG_PATH: resolve('apps/api/.env') },
    { SUBMISSION_STORAGE_ROOT: resolve('evidence') },
    { API_PORT: '3000' },
    { CORS_ORIGIN: 'http://localhost:3001' },
    { WEB_BASE_URL: 'http://localhost:3001' },
    { LIBREOFFICE_PATH: 'soffice.com' },
    ...['0', '5433', '5434'].map((port) => ({
      DATABASE_URL: 'postgres://postgres:fake@127.0.0.1:' + port + '/student_service_workflow_demo',
    })),
    {
      DATABASE_URL: 'postgres://postgres:fake@example.invalid:55555/student_service_workflow_demo',
    },
    { DATABASE_URL: 'postgres://postgres:fake@127.0.0.1:55555/student_service' },
    { DATABASE_URL: env.DATABASE_URL + '?options=unsafe' },
  ])
    assert.throws(() => assertVaultDemoEnvironment(root, { ...env, ...changes }, p.entry, true))
})
