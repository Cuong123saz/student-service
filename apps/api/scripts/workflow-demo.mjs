import assert from 'node:assert/strict'
import { fork, spawn } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { resolve, join } from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import argon2 from 'argon2'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { assertRecoveryDirectory, fileDigest } from './recovery-bundle.mjs'
import { recoveryConfig, seedRecoveryFixture } from './recovery-fixture.mjs'
import {
  assertDemoContainer,
  assertDemoDatabase,
  assertDemoState,
  demoAction,
  demoDatabase,
  demoProfile,
  demoPassword,
  demoRunRoot,
} from './workflow-demo.contract.mjs'

const projectRoot = fileURLToPath(new URL('../../../', import.meta.url)),
  apiRoot = resolve(projectRoot, 'apps/api')
const profile = demoProfile(process.argv.slice(2))
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
    let output = ''
    child.stdout.on('data', (chunk) => {
      if (output.length < 1048576) output += chunk.toString()
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
    child.on('exit', () => {
      if (!stopping) process.exitCode = 1
      stopping = true
    })
  }
  async function ready(url) {
    for (let i = 0; i < 160; i++) {
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
    phase = 'start-servers'
    launch(join(runtimeRoot, 'api/dist/server.js'), join(runtimeRoot, 'api'), env, 'api')
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
        (/^[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'OPERATION_FAILED'),
    )
    process.exitCode = 1
    await saveState('FAILED')
  } finally {
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
