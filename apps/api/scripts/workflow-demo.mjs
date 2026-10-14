import assert from 'node:assert/strict'
import { fork, spawn } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { resolve, join, isAbsolute } from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import argon2 from 'argon2'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { vaultDemoPaths } from './workflow-vault.contract.mjs'
import { assertRecoveryDirectory, fileDigest } from './recovery-bundle.mjs'
import {
  recoveryConfig,
  recoveryValues,
  recoveryStudent,
  seedRecoveryFixture,
} from './recovery-fixture.mjs'
import {
  assertDemoContainer,
  assertDemoDatabase,
  assertDemoState,
  demoAction,
  demoChildExitFailed,
  demoDatabase,
  demoProfile,
  demoPassword,
  demoRunRoot,
} from './workflow-demo.contract.mjs'

const projectRoot = fileURLToPath(new URL('../../../', import.meta.url)),
  apiRoot = resolve(projectRoot, 'apps/api')
const profile = demoProfile(process.argv.slice(2))
const retryRehearsal = profile.kind === 'retry'
const sprint4Rehearsal = profile.kind === 'sprint4'
const sprint5Rehearsal = profile.kind === 'sprint5'
const queueCountsRehearsal = profile.kind === 'queue-counts'
const signatureRehearsal = profile.kind === 'mock-signature'
const vaultEnabled =
  ['vault', 'workspace-vault', 'mock-signature'].includes(profile.kind) || retryRehearsal
const demoOrigin = profile.webUrl,
  demoApi = profile.apiUrl
const apiAddress = new URL(demoApi),
  webAddress = new URL(demoOrigin)
const activePath = resolve(projectRoot, 'run', profile.activeFile)
async function readJson(path) {
  await fileDigest(path, 65536)
  return JSON.parse(await readFile(path, 'utf8'))
}
let action
try {
  action = demoAction(process.argv.slice(2), process.env)
} catch {
  console.error('WORKFLOW_DEMO_GUARD_REFUSED')
  process.exit(1)
}
if (action === 'stop') {
  try {
    const active = await readJson(activePath),
      root = demoRunRoot(projectRoot, active.runId)
    await assertRecoveryDirectory(root)
    const statePath = join(root, 'state.json'),
      state = await readJson(statePath)
    assertDemoState(state, projectRoot, statePath, profile.kind)
    if (state.status !== 'STOPPED') {
      try {
        await writeFile(
          join(root, 'stop.request.json'),
          JSON.stringify({ fakeDataOnly: true, runId: state.runId }),
          { flag: 'wx' },
        )
      } catch (error) {
        if (error.code !== 'EEXIST') throw error
      }
    }
    console.log('WORKFLOW_DEMO_STOP_REQUESTED')
  } catch {
    console.error('WORKFLOW_DEMO_STOP_FAILED')
    process.exitCode = 1
  }
} else {
  const runId = randomUUID(),
    runRoot = demoRunRoot(projectRoot, runId)
  const children = [],
    logs = []
  let containerId,
    sql,
    state,
    stopping = false,
    phase = 'preflight'
  async function docker(args, extraEnv = {}) {
    const child = spawn('docker', args, {
      env: { ...process.env, ...extraEnv },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = '',
      overflow = false
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      if (output.length + chunk.length <= 16 * 1048576) output += chunk
      else overflow = true
    })
    child.stderr.resume()
    const timer = setTimeout(() => child.kill(), 60000)
    try {
      await new Promise((res, rej) => {
        child.once('error', rej)
        child.once('close', (code) =>
          code === 0 ? res() : rej(new Error('WORKFLOW_DEMO_DOCKER_FAILED')),
        )
      })
    } finally {
      clearTimeout(timer)
    }
    assert.ok(!overflow, 'WORKFLOW_DEMO_DOCKER_OUTPUT_LIMIT')
    return output.trim()
  }
  async function owned() {
    const [info] = JSON.parse(await docker(['inspect', containerId]))
    assertDemoContainer(info, runId, containerId)
    return info
  }
  async function unused(port, host) {
    const server = createServer()
    await new Promise((res, rej) => {
      server.once('error', rej)
      server.listen(port, host, res)
    })
    await new Promise((res, rej) => server.close((error) => (error ? rej(error) : res())))
  }
  function launch(path, cwd, env, label) {
    const stream = createWriteStream(join(runRoot, label + '.log'), { flags: 'wx' })
    const child = fork(path, [], {
      cwd,
      env,
      execArgv: [],
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    })
    child.stdout.pipe(stream, { end: false })
    child.stderr.pipe(stream, { end: false })
    children.push(child)
    logs.push(stream)
    child.on('error', () => {
      if (!stopping) process.exitCode = 1
      stopping = true
    })
    child.on('exit', (code) => {
      if (!stopping && demoChildExitFailed(label, code)) process.exitCode = 1
      stopping = true
    })
    return child
  }
  async function ready(url) {
    for (let i = 0; i < (vaultEnabled ? 600 : 160); i++) {
      if (stopping) throw new Error('WORKFLOW_DEMO_CHILD_EXITED')
      try {
        if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return
      } catch {}
      await pause(250)
    }
    throw new Error('WORKFLOW_DEMO_START_TIMEOUT')
  }
  async function saveState(status) {
    if (!state) return
    state.status = status
    await writeFile(join(runRoot, 'state.json'), JSON.stringify(state, null, 2) + '\n')
  }
  process.on('SIGINT', () => {
    stopping = true
  })
  process.on('SIGTERM', () => {
    stopping = true
  })
  try {
    assert.equal(process.versions.node.split('.')[0], '22', 'NODE_22_REQUIRED')
    if (vaultEnabled) {
      assert.equal(process.platform, 'win32', 'VAULT_DEMO_REQUIRES_WINDOWS')
      assert.ok(
        process.env.LIBREOFFICE_PATH &&
          process.env.LIBREOFFICE_PATH.endsWith('soffice.com') &&
          isAbsolute(process.env.LIBREOFFICE_PATH),
        'VAULT_DEMO_REQUIRES_ABSOLUTE_CONVERTER',
      )
    }
    await unused(Number(apiAddress.port), apiAddress.hostname)
    await unused(Number(webAddress.port), webAddress.hostname)
    await assertRecoveryDirectory(projectRoot)
    await mkdir(resolve(projectRoot, 'run'), { recursive: true })
    await assertRecoveryDirectory(resolve(projectRoot, 'run'))
    await mkdir(resolve(projectRoot, 'run/workflow-demo'), { recursive: true })
    await assertRecoveryDirectory(resolve(projectRoot, 'run/workflow-demo'))
    await mkdir(runRoot)
    await writeFile(join(runRoot, 'fake.env'), '# Isolated fake workflow demo.\n', { flag: 'wx' })
    phase = 'create-isolated-database'
    const dbSecret = randomBytes(24).toString('hex')
    containerId = await docker(
      [
        'run',
        '--detach',
        '--pull=never',
        '--name',
        'student-service-workflow-demo-' + runId,
        '--label',
        'student-service.workflow-demo-id=' + runId,
        '--tmpfs',
        '/var/lib/postgresql/data:rw,size=536870912',
        '--publish',
        '127.0.0.1::5432',
        '--env',
        'POSTGRES_PASSWORD',
        '--env',
        'POSTGRES_DB=' + demoDatabase,
        'postgres:17-alpine',
      ],
      { POSTGRES_PASSWORD: dbSecret },
    )
    const info = await owned(),
      ports = info.NetworkSettings.Ports['5432/tcp']
    assert.ok(ports.length === 1 && ports[0].HostIp === '127.0.0.1')
    const databaseUrl =
      'postgres://postgres:' + dbSecret + '@127.0.0.1:' + ports[0].HostPort + '/' + demoDatabase
    assertDemoDatabase(databaseUrl)
    let dbReady = false
    for (let i = 0; i < 60; i++) {
      try {
        await docker([
          'exec',
          containerId,
          'pg_isready',
          '-h',
          '127.0.0.1',
          '-U',
          'postgres',
          '-d',
          demoDatabase,
        ])
        dbReady = true
        break
      } catch {
        await pause(250)
      }
    }
    assert.ok(dbReady, 'WORKFLOW_DEMO_DATABASE_TIMEOUT')
    sql = postgres(databaseUrl, { max: 1, connect_timeout: 5, onnotice: () => {} })
    phase = 'migrate-demo'
    await migrate(drizzle(sql), { migrationsFolder: resolve(apiRoot, 'drizzle') })
    await sql.end()
    sql = postgres(databaseUrl, { max: 1, onnotice: () => {} })
    phase = 'seed-fake-data'
    const fixture = await seedRecoveryFixture(sql),
      hash = await argon2.hash(demoPassword)
    if (retryRehearsal)
      await sql`INSERT INTO role_permissions(role_id,permission_id)
        SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
        WHERE r.code='DRILL_REVIEW' AND p.code='document.retry' ON CONFLICT DO NOTHING`
    const accounts = []
    for (const [actor, username, label] of [
      [fixture.owner, 'demo.sinhvien', 'Sinh viên'],
      [fixture.other, 'demo.svkhac', 'Sinh viên khác'],
      [fixture.reviewer, 'demo.canbo', 'Cán bộ đúng đơn vị / quản trị xét hồ sơ'],
      [fixture.foreign, 'demo.ngoai', 'Cán bộ ngoài phạm vi'],
    ]) {
      await sql`UPDATE users SET username=${username},password_hash=${hash},activated_at=now() WHERE id=${actor.id}`
      actor.username = username
      accounts.push({ username, label })
    }
    await sql`UPDATE services SET name='DEMO 1 - Bổ sung và duyệt',description='Dữ liệu giả để nghiệm thu quy trình, không cấp giấy chính thức.' WHERE id=${fixture.serviceId}`
    const [first] =
      await sql`SELECT owner_unit_id FROM procedure_versions WHERE id=${fixture.versionId}`
    const config = recoveryConfig(first.owner_unit_id)
    const services = [{ id: fixture.serviceId, versionId: fixture.versionId, purpose: 'approve' }]
    for (const [code, name, purpose, mode] of [
      ['DEMO_REJECT', 'DEMO 2 - Từ chối hồ sơ', 'reject', 'ONLINE'],
      ['DEMO_TRY', 'DEMO 3 - Bạn tự thực hành', 'practice', 'ONLINE'],
      [
        'STUDENT_CONFIRMATION',
        'Giấy xác nhận sinh viên - DEMO trực tiếp CTSV',
        'offline',
        'OFFLINE',
      ],
    ]) {
      const [service] =
        await sql`INSERT INTO services(code,name,description,processing_days,status) VALUES(${code},${name},'Chỉ dùng dữ liệu giả; không cấp văn bản.',3,'ACTIVE') RETURNING id`
      const selected = {
        ...config,
        processingMode: mode,
        contactInstructions:
          mode === 'OFFLINE'
            ? 'Sinh viên làm việc trực tiếp tại Phòng CTSV.'
            : 'Môi trường demo: dùng dữ liệu giả và minh chứng mẫu, không cấp giấy chính thức.',
      }
      const [version] =
        await sql`INSERT INTO procedure_versions(service_id,owner_unit_id,version_number,status,config,created_by,updated_by,published_at) VALUES(${service.id},${first.owner_unit_id},1,'PUBLISHED',${sql.json(selected)},${fixture.reviewer.id},${fixture.reviewer.id},now()) RETURNING id`
      services.push({ id: service.id, versionId: version.id, purpose })
    }
    if (sprint5Rehearsal) {
      await sql`UPDATE organizational_units SET name='Phòng Công tác Sinh viên (CTSV) — giả định' WHERE id=${first.owner_unit_id}`
      const selected = structuredClone(config)
      selected.attachments[0].mimeTypes = ['application/pdf', 'image/png', 'image/jpeg']
      selected.attachments[0].maxFiles = 2
      const [service] = await sql`INSERT INTO services(code,name,description,processing_days,status)
        VALUES('SPRINT5_DRAFT_DEMO','SPRINT 5 - Kê khai hồ sơ giả định','Dữ liệu giả để kiểm chứng kê khai, không cấp văn bản.',3,'ACTIVE') RETURNING id`
      const [version] =
        await sql`INSERT INTO procedure_versions(service_id,owner_unit_id,version_number,status,config,created_by,updated_by,published_at)
        VALUES(${service.id},${first.owner_unit_id},1,'PUBLISHED',${sql.json(selected)},${fixture.reviewer.id},${fixture.reviewer.id},now()) RETURNING id`
      services.push({ id: service.id, versionId: version.id, purpose: 'draft-acceptance' })
    }
    if (queueCountsRehearsal) {
      await sql`UPDATE organizational_units SET name='Phòng CTSV — giả định' WHERE id=${first.owner_unit_id}`
      for (let index = 1; index <= 25; index++) {
        const selected = { ...config, attachments: [] }
        const name = 'SPRINT 6 - Lô giả ' + String(index).padStart(2, '0')
        const [service] =
          await sql`INSERT INTO services(code,name,description,processing_days,status)
          VALUES(${'QUEUE_COUNTS_' + index},${name},'Chỉ dùng dữ liệu giả để kiểm chứng hàng đợi.',3,'ACTIVE') RETURNING id`
        const [version] =
          await sql`INSERT INTO procedure_versions(service_id,owner_unit_id,version_number,status,config,created_by,updated_by,published_at)
          VALUES(${service.id},${first.owner_unit_id},1,'PUBLISHED',${sql.json(selected)},${fixture.reviewer.id},${fixture.reviewer.id},now()) RETURNING id`
        services.push({ id: service.id, versionId: version.id, purpose: 'queue-counts' })
      }
    }
    if (sprint4Rehearsal) {
      await sql`UPDATE organizational_units SET name='Phòng Công tác Sinh viên (CTSV) — giả định' WHERE id=${first.owner_unit_id}`
      await sql`INSERT INTO roles(code,name,is_system) VALUES('SPRINT4_CONFIG','Cấu hình trong đơn vị — giả định',false)`
      await sql`INSERT INTO role_permissions(role_id,permission_id)
        SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.code='SPRINT4_CONFIG' AND p.code='service.configure'`
      for (const actor of [fixture.reviewer, fixture.foreign]) {
        await sql`INSERT INTO user_roles(user_id,role_id) SELECT ${actor.id},id FROM roles WHERE code IN ('SPRINT4_CONFIG','ADMIN') ON CONFLICT DO NOTHING`
        await sql`INSERT INTO user_role_scopes(user_id,role_id,scope_id)
          SELECT ${actor.id},c.id,s.scope_id FROM user_role_scopes s JOIN roles old ON old.id=s.role_id
          CROSS JOIN roles c WHERE s.user_id=${actor.id} AND old.code='DRILL_REVIEW' AND c.code='SPRINT4_CONFIG'`
      }
      const adminId = randomUUID()
      await sql`INSERT INTO users(id,username,full_name,password_hash,status,must_change_password,activated_at)
        VALUES(${adminId},'demo.quantri','Quản trị cấu hình — giả định',${hash},'ACTIVE',false,now())`
      await sql`INSERT INTO user_roles(user_id,role_id) SELECT ${adminId},id FROM roles WHERE code='SYSTEM_ADMIN'`
      await sql`INSERT INTO user_role_scopes(user_id,role_id,scope_id)
        SELECT ${adminId},r.id,s.id FROM roles r CROSS JOIN authorization_scopes s WHERE r.code='SYSTEM_ADMIN' AND s.scope_type='GLOBAL'`
      accounts.push({ username: 'demo.quantri', label: 'Quản trị GLOBAL — giả định' })
      const [service] = await sql`INSERT INTO services(code,name,description,processing_days,status)
        VALUES('SPRINT4_FORM_DEMO','SPRINT 4 - Biểu mẫu thực hành','Thủ tục giả để kiểm chứng cấu hình; không cấp văn bản.',3,'ACTIVE') RETURNING id`
      services.push({ id: service.id, purpose: 'configuration', ownerUnitId: first.owner_unit_id })
    }
    await sql.end()
    sql = undefined
    const inherited = Object.fromEntries(
      ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'LOCALAPPDATA', 'USERPROFILE']
        .filter((key) => process.env[key])
        .map((key) => [key, process.env[key]]),
    )
    const env = {
      ...inherited,
      APP_ENV: 'test',
      DATABASE_URL: databaseUrl,
      DOTENV_CONFIG_PATH: join(runRoot, 'fake.env'),
      JWT_SECRET: randomBytes(48).toString('hex'),
      SUBMISSION_STORAGE_ROOT: join(runRoot, 'evidence'),
      API_HOST: apiAddress.hostname,
      API_PORT: apiAddress.port,
      ...(process.env.LIBREOFFICE_PATH ? { LIBREOFFICE_PATH: process.env.LIBREOFFICE_PATH } : {}),
      CORS_ORIGIN: demoOrigin,
      WEB_BASE_URL: demoOrigin,
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: '1',
      SMTP_SECURE: 'false',
      MAIL_FROM: 'demo@example.invalid',
    }
    phase = 'snapshot-runtime'
    const runtimeRoot = join(runRoot, 'runtime')
    await mkdir(runtimeRoot)
    await cp(resolve(apiRoot, 'dist'), join(runtimeRoot, 'api/dist'), {
      recursive: true,
      errorOnExist: true,
      force: false,
    })
    await cp(resolve(apiRoot, 'templates'), join(runtimeRoot, 'api/templates'), {
      recursive: true,
      errorOnExist: true,
      force: false,
    })
    await cp(resolve(projectRoot, 'apps/web/.output'), join(runtimeRoot, 'web/.output'), {
      recursive: true,
      errorOnExist: true,
      force: false,
    })
    let apiEntry = join(runtimeRoot, 'api/dist/server.js')
    if (vaultEnabled) {
      const p = vaultDemoPaths(projectRoot, runId)
      await assertRecoveryDirectory(runRoot)
      await mkdir(p.vault)
      await assertRecoveryDirectory(p.vault)
      await mkdir(p.templates)
      await mkdir(p.evidence)
      await cp(
        join(apiRoot, 'templates/submission-summary-v1.docx'),
        join(p.templates, 'submission-summary-v1.docx'),
        { errorOnExist: true, force: false },
      )
      for (const name of ['workflow-vault-api.mjs', 'workflow-vault.contract.mjs'])
        await cp(join(apiRoot, 'scripts', name), join(p.api, name), {
          errorOnExist: true,
          force: false,
        })
      await cp(join(apiRoot, 'package.json'), join(p.api, 'package.json'), {
        errorOnExist: true,
        force: false,
      })
      await cp(join(projectRoot, 'package-lock.json'), join(p.api, 'package-lock.json'), {
        errorOnExist: true,
        force: false,
      })
      env.WORKFLOW_VAULT_DEMO_ID = runId
      if (retryRehearsal) env.WORKFLOW_VAULT_MODE = 'retry'
      if (profile.kind === 'workspace-vault') env.WORKFLOW_VAULT_MODE = 'workspace'
      if (signatureRehearsal) env.WORKFLOW_VAULT_MODE = 'signature'
      if (signatureRehearsal) {
        phase = 'prepare-synthetic-converter-profile'
        const { bootstrapMockConverterProfile } =
          await import('../dist/modules/signatures/mock-converter-profile.js')
        const { readWindowsDocumentProcessOutput } =
          await import('../dist/modules/submissions/submission-document-supervisor.js')
        const { LocalSubmissionDocumentRenderer } =
          await import('../dist/modules/submissions/submission-document.js')
        const { newDeclarationTemplateBinding } =
          await import('../dist/modules/submissions/submission-document-template.js')
        const bootstrapWord = await new LocalSubmissionDocumentRenderer(
          undefined,
          join(p.templates, 'submission-summary-v1.docx'),
        ).render(
          {
            id: runId,
            serviceName: 'Chuẩn bị converter bằng dữ liệu giả',
            procedure: {
              ...config,
              versionId: fixture.versionId,
              versionNumber: 1,
              processingUnitName: 'Đơn vị giả',
            },
            round: {
              roundNumber: 1,
              submittedAt: '2026-10-14T01:00:00Z',
              source: 'LIVE',
              files: [],
              declarationTemplate: newDeclarationTemplateBinding(),
              studentSnapshot: recoveryStudent,
              values: recoveryValues(1),
            },
          },
          'docx',
        )
        // Keep native startup paths short; only the sealed seed is copied into the runtime.
        const bootstrapRoot = join(runRoot, 'cp')
        const result = await bootstrapMockConverterProfile(
          bootstrapRoot,
          bootstrapWord,
          join(process.env.LIBREOFFICE_PATH, '..', 'soffice.bin'),
          async (args) => {
            let observation
            try {
              await readWindowsDocumentProcessOutput(process.env.LIBREOFFICE_PATH, args, 90000, {
                finished: (report) => {
                  observation = report
                  console.log('MOCK_PROFILE_BOOTSTRAP_PROCESS ' + JSON.stringify(report))
                },
              })
            } catch (error) {
              if (!(error.message === 'DOCUMENT_CONVERSION_TIMEOUT' && observation?.empty === true))
                throw error
            }
            assert.ok(observation, 'BOOTSTRAP_OBSERVATION_REQUIRED')
            return observation
          },
          { fakeDataOnly: true },
        )
        await cp(bootstrapRoot, join(p.api, 'converter-bootstrap'), {
          recursive: true,
          force: false,
          errorOnExist: true,
        })
        console.log(
          'MOCK_CONVERTER_PROFILE_READY ' +
            JSON.stringify({ attempts: result.attempts, files: result.files, bytes: result.bytes }),
        )
      }
      apiEntry = p.entry
    }
    phase = 'start-servers'
    const apiChild = launch(apiEntry, join(runtimeRoot, 'api'), env, 'api')
    launch(
      join(runtimeRoot, 'web/.output/server/index.mjs'),
      join(runtimeRoot, 'web'),
      {
        ...inherited,
        PORT: webAddress.port,
        NITRO_PORT: webAddress.port,
        HOST: webAddress.hostname,
        NITRO_HOST: webAddress.hostname,
        NUXT_PUBLIC_API_BASE: demoApi,
      },
      'web',
    )
    await ready(demoApi + '/services')
    await ready(demoOrigin + '/login')
    state = {
      version: 1,
      fakeDataOnly: true,
      profile: profile.kind,
      runId,
      status: 'READY',
      webUrl: demoOrigin,
      apiUrl: demoApi,
      accounts,
      services,
      startedAt: new Date().toISOString(),
      ephemeralDatabase: true,
    }
    await saveState('READY')
    await writeFile(
      activePath,
      JSON.stringify(
        { version: 1, fakeDataOnly: true, runId, statePath: join(runRoot, 'state.json') },
        null,
        2,
      ) + '\n',
    )
    console.log(
      'WORKFLOW_DEMO_READY ' +
        JSON.stringify({ webUrl: demoOrigin, statePath: join(runRoot, 'state.json') }),
    )
    if (retryRehearsal) {
      const checker = launch(
        join(apiRoot, 'scripts/check-workflow-retry.mjs'),
        apiRoot,
        {
          ...inherited,
          WORKFLOW_RETRY_STATE_PATH: join(runRoot, 'state.json'),
          ...(process.env.WORKFLOW_PLAYWRIGHT_MODULE
            ? { WORKFLOW_PLAYWRIGHT_MODULE: process.env.WORKFLOW_PLAYWRIGHT_MODULE }
            : {}),
          ...(process.env.WORKFLOW_CHROMIUM_EXECUTABLE
            ? { WORKFLOW_CHROMIUM_EXECUTABLE: process.env.WORKFLOW_CHROMIUM_EXECUTABLE }
            : {}),
        },
        'retry-browser',
      )
      checker.on('message', (m) => {
        if (
          ['ARM', 'REPAIR', 'INSPECT'].includes(m?.type) &&
          /^[a-f0-9-]{36}$/.test(m.requestId || '') &&
          apiChild.connected
        )
          apiChild.send(m)
      })
      apiChild.on('message', (m) => {
        if (m?.type === 'RETRY_REHEARSAL_RESULT' && checker.connected) checker.send(m)
      })
      // The one-shot checker owns this isolated run; exit always stops only its children/database.
    }
    if (sprint4Rehearsal) {
      launch(
        join(apiRoot, 'scripts/check-sprint4-demo.mjs'),
        apiRoot,
        {
          ...inherited,
          WORKFLOW_SPRINT4_STATE_PATH: join(runRoot, 'state.json'),
          ...(process.env.WORKFLOW_PLAYWRIGHT_MODULE
            ? { WORKFLOW_PLAYWRIGHT_MODULE: process.env.WORKFLOW_PLAYWRIGHT_MODULE }
            : {}),
          ...(process.env.WORKFLOW_CHROMIUM_EXECUTABLE
            ? { WORKFLOW_CHROMIUM_EXECUTABLE: process.env.WORKFLOW_CHROMIUM_EXECUTABLE }
            : {}),
        },
        'sprint4-browser',
      )
    }
    if (sprint5Rehearsal) {
      launch(
        join(apiRoot, 'scripts/check-sprint5-demo.mjs'),
        apiRoot,
        {
          ...inherited,
          WORKFLOW_SPRINT5_STATE_PATH: join(runRoot, 'state.json'),
          ...(process.env.WORKFLOW_PLAYWRIGHT_MODULE
            ? { WORKFLOW_PLAYWRIGHT_MODULE: process.env.WORKFLOW_PLAYWRIGHT_MODULE }
            : {}),
          ...(process.env.WORKFLOW_CHROMIUM_EXECUTABLE
            ? { WORKFLOW_CHROMIUM_EXECUTABLE: process.env.WORKFLOW_CHROMIUM_EXECUTABLE }
            : {}),
        },
        'sprint5-browser',
      )
    }
    if (queueCountsRehearsal) {
      launch(
        join(apiRoot, 'scripts/check-queue-counts-demo.mjs'),
        apiRoot,
        {
          ...inherited,
          WORKFLOW_COUNTS_STATE_PATH: join(runRoot, 'state.json'),
          ...(process.env.WORKFLOW_PLAYWRIGHT_MODULE
            ? { WORKFLOW_PLAYWRIGHT_MODULE: process.env.WORKFLOW_PLAYWRIGHT_MODULE }
            : {}),
          ...(process.env.WORKFLOW_CHROMIUM_EXECUTABLE
            ? { WORKFLOW_CHROMIUM_EXECUTABLE: process.env.WORKFLOW_CHROMIUM_EXECUTABLE }
            : {}),
        },
        'queue-counts-browser',
      )
    }
    if (signatureRehearsal) {
      launch(
        join(apiRoot, 'scripts/check-mock-signature-demo.mjs'),
        apiRoot,
        {
          ...inherited,
          WORKFLOW_SIGNATURE_STATE_PATH: join(runRoot, 'state.json'),
          ...(process.env.WORKFLOW_PLAYWRIGHT_MODULE
            ? { WORKFLOW_PLAYWRIGHT_MODULE: process.env.WORKFLOW_PLAYWRIGHT_MODULE }
            : {}),
          ...(process.env.WORKFLOW_CHROMIUM_EXECUTABLE
            ? { WORKFLOW_CHROMIUM_EXECUTABLE: process.env.WORKFLOW_CHROMIUM_EXECUTABLE }
            : {}),
        },
        'mock-signature-browser',
      )
    }
    while (!stopping) {
      try {
        const stop = await readJson(join(runRoot, 'stop.request.json'))
        if (stop.fakeDataOnly === true && stop.runId === runId) stopping = true
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
      if (!stopping) await pause(500)
    }
  } catch (error) {
    console.error(
      'WORKFLOW_DEMO_FAILED ' +
        phase +
        ' ' +
        (/^[A-Z0-9_]+$/.test(error.code || '')
          ? error.code
          : /^[A-Z0-9_]+$/.test(error.message || '')
            ? error.message
            : 'OPERATION_FAILED'),
    )
    process.exitCode = 1
    await saveState('FAILED')
  } finally {
    if (retryRehearsal && containerId) {
      try {
        await owned()
        const dump = await docker([
          'exec',
          containerId,
          'pg_dump',
          '-U',
          'postgres',
          '-d',
          demoDatabase,
          '--no-owner',
          '--no-privileges',
        ])
        await writeFile(join(runRoot, 'retry-diagnostic.sql'), dump + '\n', {
          flag: 'wx',
          mode: 0o600,
        })
      } catch {
        console.error('RETRY_DIAGNOSTIC_SNAPSHOT_FAILED')
        process.exitCode = 1
      }
    }
    for (const child of children) if (child.exitCode === null) child.kill()
    for (const child of children)
      if (child.exitCode === null)
        await new Promise((res) => {
          child.once('close', res)
          setTimeout(res, 5000)
        })
    for (const log of logs) log.end()
    if (sql) await sql.end({ timeout: 5 }).catch(() => {})
    if (containerId) {
      try {
        await owned()
        await docker(['rm', '--force', containerId])
      } catch {
        console.error('WORKFLOW_DEMO_CLEANUP_FAILED')
        process.exitCode = 1
      }
    }
    if (state?.status === 'READY') await saveState(process.exitCode ? 'FAILED' : 'STOPPED')
  }
}
