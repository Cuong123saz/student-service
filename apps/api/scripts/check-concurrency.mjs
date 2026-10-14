// Bounded local HTTP check. Refuses development/production databases and nonempty dossier tables.
import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { createHmac, randomUUID, randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { createWriteStream } from 'node:fs'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cpus, totalmem } from 'node:os'
import postgres from 'postgres'

const url = new URL(process.env.DATABASE_URL ?? 'http://invalid')
assert.ok(
  ['localhost', '127.0.0.1'].includes(url.hostname) &&
    url.port === '5434' &&
    url.pathname === '/student_service_test',
  'Requires isolated local student_service_test:5434',
)
assert.equal(process.env.APP_ENV, 'test', 'Requires APP_ENV=test')
const root = fileURLToPath(new URL('../../../', import.meta.url))
const origin = 'http://localhost:3011'
const protectedTables =
  'mock_signature_checks, mock_signature_receipts, submission_document_retries, submission_document_jobs, submission_documents, submission_document_sets, personal_notifications, submission_events, submission_rounds, submission_files, submissions, procedure_versions'

if (process.argv.includes('--serve')) {
  // Separate API process: the load generator does not share its event loop or DB pool.
  const { buildApp } = await import('../dist/app.js')
  const { databaseClient } = await import('../dist/db/client.js')
  const app = buildApp()
  const address = await app.listen({ host: '127.0.0.1', port: 0 })
  process.send({ address })
  process.on('message', async (message) => {
    if (message === 'stop') {
      await app.close()
      await databaseClient.end()
      process.disconnect()
    }
  })
  process.on('disconnect', () => process.exit(0))
} else {
  await main()
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 5 })
  const q = (text, params = []) => sql.unsafe(text, params)
  const suffix = randomUUID().slice(0, 8),
    prefix = 'CONCURRENT_' + suffix + '_'
  const unitId = randomUUID(),
    foreignUnitId = randomUUID(),
    scopeId = randomUUID()
  const facultyId = randomUUID(),
    classId = randomUUID(),
    ownerId = randomUUID(),
    hiddenId = randomUUID()
  const actors = Array.from({ length: 20 }, (_, i) => ({
    id: randomUUID(),
    username: prefix + 'reviewer' + i,
    portal: i % 2 ? 'admin' : 'user',
  }))
  const owner = { id: ownerId, username: prefix + 'owner', portal: 'user', student: true }
  const userIds = [...actors.map((a) => a.id), ownerId, hiddenId]
  const secret = randomBytes(48).toString('hex') // Ephemeral test sessions; never output tokens or secrets.
  let roleId,
    serviceId,
    versionId,
    child,
    stream,
    address,
    seeded = false,
    locked = false
  const report = {
    startedAt: new Date().toISOString(),
    status: 'RUNNING',
    node: process.version,
    platform: process.platform,
    cpu: cpus()[0]?.model,
    logicalCpus: cpus().length,
    memoryGiB: Math.round(totalmem() / 1024 ** 3),
    dataset: {
      total: 10000,
      visiblePending: 7000,
      inReview: 1000,
      designatedOther: 1000,
      foreignUnit: 1000,
      notifications: 1000,
    },
    phases: [],
  }
  const cookie = (a) => {
    const part = (v) => Buffer.from(JSON.stringify(v)).toString('base64url')
    const now = Math.floor(Date.now() / 1000)
    const token =
      part({ alg: 'HS256', typ: 'JWT' }) +
      '.' +
      part({
        sub: a.id,
        username: a.username,
        roles: a.student ? ['STUDENT'] : ['FACULTY_REVIEWER', 'ADMIN'],
        portal: a.portal,
        mustChangePassword: false,
        iss: 'student-service-api',
        aud: 'student-service-' + a.portal,
        iat: now,
        exp: now + 600,
      })
    return (
      a.portal +
      '_session=' +
      token +
      '.' +
      createHmac('sha256', secret).update(token).digest('base64url')
    )
  }
  let httpRequests = 0
  const httpStatuses = {}
  async function request(a, path, body, expected = 200) {
    const started = performance.now()
    const response = await fetch(address + '/api/v1/' + a.portal + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        cookie: cookie(a),
        origin,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    })
    const data = await response.json()
    httpRequests++
    httpStatuses[response.status] = (httpStatuses[response.status] ?? 0) + 1
    const ms = performance.now() - started
    assert.ok(
      (Array.isArray(expected) ? expected : [expected]).includes(response.status),
      'Unexpected HTTP ' + response.status + ': ' + (data.code ?? 'no code'),
    )
    return { status: response.status, data, ms }
  }
  try {
    const [lock] = await q('SELECT pg_try_advisory_lock(821719, 1) AS locked')
    assert.equal(lock.locked, true, 'Another concurrency check is running')
    locked = true
    const [existing] = await q(
      'SELECT (SELECT count(*) FROM submissions)::int AS dossiers, (SELECT count(*) FROM procedure_versions)::int AS versions',
    )
    assert.deepEqual(
      { ...existing },
      { dossiers: 0, versions: 0 },
      'Test dossier/version tables must be empty; do not run alongside integration/browser tests',
    )
    const [canonical] = await q(
      "SELECT (SELECT id FROM roles WHERE code='FACULTY_REVIEWER') AS reviewer, (SELECT id FROM roles WHERE code='ADMIN') AS admin, (SELECT id FROM roles WHERE code='STUDENT') AS student, (SELECT id FROM permissions WHERE code='submission.review') AS review",
    )
    assert.ok(
      Object.values(canonical).every(Boolean),
      'Migrate/seed canonical roles and review permission first',
    )
    await mkdir(resolve(root, 'run'), { recursive: true })
    await rm(resolve(root, 'run/concurrency-report.json'), { force: true })
    seeded = true
    await q(
      "INSERT INTO organizational_units(id,code,name) VALUES($1,$3,'Đơn vị tải thử'),($2,$4,'Đơn vị ngoài phạm vi')",
      [unitId, foreignUnitId, prefix + 'unit', prefix + 'foreign'],
    )
    const [role] = await q(
      "INSERT INTO roles(code,name,is_system) VALUES($1,'Quyền tải thử riêng',false) RETURNING id",
      [prefix + 'role'],
    )
    roleId = role.id
    await q('INSERT INTO role_permissions(role_id,permission_id) VALUES($1,$2)', [
      roleId,
      canonical.review,
    ])
    await q(
      "INSERT INTO authorization_scopes(id,scope_type,organizational_unit_id) VALUES($1,'ORGANIZATION',$2)",
      [scopeId, unitId],
    )
    for (const a of [...actors, { id: hiddenId, username: prefix + 'hidden', portal: 'user' }]) {
      await q(
        "INSERT INTO users(id,username,full_name,status,must_change_password) VALUES($1,$2,'Cán bộ tải thử','ACTIVE',false)",
        [a.id, a.username],
      )
      await q('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2),($1,$3),($1,$4)', [
        a.id,
        canonical.reviewer,
        canonical.admin,
        roleId,
      ])
      await q('INSERT INTO user_role_scopes(user_id,role_id,scope_id) VALUES($1,$2,$3)', [
        a.id,
        roleId,
        scopeId,
      ])
    }
    await q(
      "INSERT INTO users(id,username,full_name,status,must_change_password) VALUES($1,$2,'Sinh viên giả định','ACTIVE',false)",
      [ownerId, owner.username],
    )
    await q('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [ownerId, canonical.student])
    await q("INSERT INTO faculties(id,code,name) VALUES($1,$2,'Khoa giả định')", [
      facultyId,
      prefix + 'faculty',
    ])
    await q(
      "INSERT INTO academic_classes(id,faculty_id,code,name) VALUES($1,$2,$3,'Lớp giả định')",
      [classId, facultyId, prefix + 'class'],
    )
    await q('INSERT INTO student_profiles(user_id,class_id,student_code) VALUES($1,$2,$3)', [
      ownerId,
      classId,
      prefix + 'owner',
    ])
    const [service] = await q(
      "INSERT INTO services(code,name,description,processing_days,status) VALUES($1,'Thủ tục tải thử','Dữ liệu giả',3,'ACTIVE') RETURNING id",
      [prefix + 'service'],
    )
    serviceId = service.id
    const config = {
      processingMode: 'ONLINE',
      processingUnitId: unitId,
      processorUserId: null,
      contactInstructions: 'Thử tải bằng dữ liệu giả',
      fields: [],
      attachments: [],
      maxTotalAttachmentBytes: 10485760,
    }
    const [version] = await q(
      "INSERT INTO procedure_versions(service_id,owner_unit_id,version_number,status,config,created_by,updated_by,published_at) VALUES($1,$2,1,'PUBLISHED',$3,$4,$4,now()) RETURNING id",
      [serviceId, unitId, config, ownerId],
    )
    versionId = version.id
    const procedure = {
      versionId,
      versionNumber: 1,
      processingMode: 'ONLINE',
      processingUnitName: 'Đơn vị tải thử',
      contactInstructions: config.contactInstructions,
      fields: [],
      attachments: [],
      maxTotalAttachmentBytes: config.maxTotalAttachmentBytes,
    }
    await q(
      "INSERT INTO users(id,username,full_name,status,must_change_password) SELECT gen_random_uuid(),$1||n,'Sinh viên tải thử '||n,'ACTIVE',false FROM generate_series(1,10000)n",
      [prefix + 'bulk'],
    )
    const bulkStarted = performance.now()
    await q(
      `INSERT INTO submissions(student_user_id,service_id,procedure_version_id,service_name,status,submitted_at,round_number,last_submitted_at,processing_unit_id,designated_reviewer_id,student_snapshot,reviewer_user_id,review_started_at,revision,procedure,values)
      SELECT p.id,$2,$3,CASE WHEN n=6999 THEN 'Giấy 50%_ literal' ELSE 'Thủ tục tải thử' END,
      CASE WHEN n BETWEEN 7001 AND 8000 THEN 'IN_REVIEW' ELSE 'SUBMITTED' END,
      '2024-01-01T00:00:00Z'::timestamptz+floor(n/3.0)*interval '1 microsecond',1,
      '2024-01-01T00:00:00Z'::timestamptz+floor(n/3.0)*interval '1 microsecond',
      CASE WHEN n>9000 THEN $5::uuid ELSE $4::uuid END,
      CASE WHEN n BETWEEN 8001 AND 9000 THEN $6::uuid ELSE NULL END,
      jsonb_build_object('fullName','Sinh viên tải thử '||n,'studentCode','LOAD'||lpad(n::text,5,'0'),'classCode','TEST','facultyCode','TEST'),
      CASE WHEN n BETWEEN 7001 AND 8000 THEN ($7::uuid[])[1+(n-7001)%20] ELSE NULL END,
      CASE WHEN n BETWEEN 7001 AND 8000 THEN now() ELSE NULL END,
      CASE WHEN n BETWEEN 7001 AND 8000 THEN 2 ELSE 1 END,$8,'{"purpose":"PRIVATE_ANSWER_SENTINEL"}'::jsonb
      FROM generate_series(1,10000)n JOIN users p ON p.username=$1||n`,
      [
        prefix + 'bulk',
        serviceId,
        versionId,
        unitId,
        foreignUnitId,
        hiddenId,
        actors.map((a) => a.id),
        procedure,
      ],
    )
    report.bulkDossierInsertMs = performance.now() - bulkStarted
    // Synthetic history for notification query load, with valid round/event/recipient binding.
    await q(
      "INSERT INTO submission_rounds(submission_id,round_number,submitted_at,student_snapshot,values,files,source,declaration_template) SELECT id,1,submitted_at,student_snapshot,values,'[]'::jsonb,'LIVE',$2::jsonb FROM submissions WHERE service_id=$1 AND status='IN_REVIEW'",
      [
        serviceId,
        JSON.stringify({
          id: 'submission-summary-v1',
          sha256: '9074a0b961cf66b625d4339c4473a42c7bfc3d981816f821fa78552c7fae8ca2',
          bindingSource: 'SUBMITTED',
        }),
      ],
    )
    await q(
      "INSERT INTO submission_events(submission_id,round_id,action,actor_user_id,actor_name,from_revision,to_revision) SELECT s.id,r.id,'CLAIMED',s.reviewer_user_id,'Cán bộ tải thử',1,2 FROM submissions s JOIN submission_rounds r ON r.submission_id=s.id WHERE s.service_id=$1",
      [serviceId],
    )
    await q(
      "INSERT INTO personal_notifications(recipient_user_id,recipient_kind,submission_id,event_id) SELECT actor_user_id,'REVIEWER',submission_id,id FROM submission_events WHERE submission_id IN (SELECT id FROM submissions WHERE service_id=$1)",
      [serviceId],
    )
    await q('ANALYZE submissions')
    await q('ANALYZE personal_notifications')
    const [anchor] = await q(
      `SELECT id,to_char(submitted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS time FROM submissions WHERE service_id=$1 AND student_snapshot->>'studentCode'='LOAD04000'`,
      [serviceId],
    )
    // Text parameter preserves microseconds: postgres.js Date serialization truncates to milliseconds.
    const deepExpected = (
      await q(
        "SELECT id FROM submissions WHERE service_id=$1 AND status='SUBMITTED' AND processing_unit_id=$2 AND designated_reviewer_id IS NULL AND (submitted_at,id)>(($3::text)::timestamptz,$4::uuid) ORDER BY submitted_at,id LIMIT 20",
        [serviceId, unitId, anchor.time, anchor.id],
      )
    ).map((r) => r.id)
    const { queueFingerprint, queueFilters } =
      await import('../dist/modules/submissions/submission-queue.js')
    const deepCursor = (a) =>
      Buffer.from(
        JSON.stringify([
          anchor.time,
          anchor.id,
          queueFingerprint(a.id, queueFilters({ status: 'SUBMITTED' })),
        ]),
      ).toString('base64url')
    await mkdir(resolve(root, 'run'), { recursive: true })
    stream = createWriteStream(resolve(root, 'run/concurrency-api.log'))
    child = fork(fileURLToPath(import.meta.url), ['--serve'], {
      cwd: root,
      execArgv: [],
      env: {
        ...process.env,
        JWT_SECRET: secret,
        CORS_ORIGIN: origin,
        WEB_BASE_URL: origin,
        API_HOST: '127.0.0.1',
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    })
    child.stdout.pipe(stream, { end: false })
    child.stderr.pipe(stream, { end: false })
    address = await new Promise((done, fail) => {
      const timer = setTimeout(() => fail(new Error('Test API startup timeout')), 30000)
      child.once('message', (m) => {
        clearTimeout(timer)
        done(m.address)
      })
      child.once('exit', () => {
        clearTimeout(timer)
        fail(new Error('Test API exited before ready'))
      })
    })
    const checkSummary = (result) => {
      assert.ok(!JSON.stringify(result).includes('PRIVATE_ANSWER_SENTINEL'))
      for (const item of result.items) assert.ok(/^LOAD\d{5}$/.test(item.student.studentCode))
    }
    const jobs = [
      [
        'queue-first',
        '/review-submissions?status=SUBMITTED',
        (d) => {
          assert.equal(d.items.length, 20)
          checkSummary(d)
          for (const i of d.items) assert.ok(Number(i.student.studentCode.slice(4)) <= 7000)
        },
      ],
      [
        'queue-deep',
        (a) => '/review-submissions?status=SUBMITTED&cursor=' + deepCursor(a),
        (d) => {
          assert.equal(d.items.length, 20)
          checkSummary(d)
          assert.deepEqual(
            d.items.map((i) => i.id),
            deepExpected,
          )
        },
      ],
      [
        'queue-search',
        '/review-submissions?status=SUBMITTED&q=LOAD06999',
        (d) => {
          assert.equal(d.items.length, 1)
          assert.equal(d.items[0].student.studentCode, 'LOAD06999')
          checkSummary(d)
        },
      ],
      [
        'queue-private',
        '/review-submissions?status=SUBMITTED&q=LOAD08001',
        (d) => assert.equal(d.items.length, 0),
      ],
      [
        'queue-foreign',
        '/review-submissions?status=SUBMITTED&q=LOAD09001',
        (d) => assert.equal(d.items.length, 0),
      ],
      [
        'queue-literal',
        '/review-submissions?status=SUBMITTED&q=50%25_',
        (d) => {
          assert.equal(d.items.length, 1)
          checkSummary(d)
        },
      ],
      [
        'queue-mine',
        '/review-submissions?status=IN_REVIEW&assignment=MINE',
        (d, a) => {
          assert.equal(d.items.length, 20)
          checkSummary(d)
          for (const i of d.items)
            assert.equal(actors[(Number(i.student.studentCode.slice(4)) - 7001) % 20].id, a.id)
        },
      ],
      [
        'notifications',
        '/notifications',
        (d, a) => {
          assert.equal(d.items.length, 20)
          assert.equal(d.unreadCount, 50)
          for (const i of d.items) assert.ok(noticeIds.get(a.id).has(i.id))
          assert.ok(!JSON.stringify(d).includes('PRIVATE_ANSWER_SENTINEL'))
        },
      ],
      ['unread-count', '/notifications/unread-count', (d) => assert.equal(d.unreadCount, 50)],
    ]
    const noticeIds = new Map(actors.map((a) => [a.id, new Set()]))
    for (const n of await q('SELECT id,recipient_user_id FROM personal_notifications'))
      noticeIds.get(n.recipient_user_id).add(n.id)
    // Warm each actor and every endpoint before recording phases.
    for (const a of actors)
      for (const [, path, verify] of jobs)
        verify((await request(a, typeof path === 'function' ? path(a) : path)).data, a)
    for (const concurrency of [1, 5, 10, 20]) {
      const measurements = [],
        started = performance.now()
      await Promise.all(
        actors.slice(0, concurrency).map(async (a, actorIndex) => {
          for (let i = 0; i < 45; i++) {
            const [kind, path, verify] = jobs[(i + actorIndex) % jobs.length]
            const result = await request(a, typeof path === 'function' ? path(a) : path)
            verify(result.data, a)
            measurements.push({ kind, ms: result.ms })
          }
        }),
      )
      const elapsedMs = performance.now() - started
      const phase = {
        concurrency,
        requests: measurements.length,
        elapsedMs: round(elapsedMs),
        requestsPerSecond: round((measurements.length * 1000) / elapsedMs),
        ...stats(measurements.map((r) => r.ms)),
        byEndpoint: Object.fromEntries(
          jobs.map(([kind]) => [
            kind,
            stats(measurements.filter((r) => r.kind === kind).map((r) => r.ms)),
          ]),
        ),
      }
      report.phases.push(phase)
      console.log('CONCURRENCY_PHASE ' + JSON.stringify(phase))
    }
    if (process.argv.includes('--profile-search')) {
      const { profileReviewSearch } = await import('./profile-review-search.mjs')
      report.searchProfile = await profileReviewSearch({
        actors,
        cleanPending: process.argv.includes('--clean-pending-experiment'),
      })
      console.log(
        'SEARCH_PROFILE ' +
          JSON.stringify({
            indexBytes: report.searchProfile.indexBytes,
            plans: report.searchProfile.plans.map((p) => ({
              name: p.name,
              executionMs: p.plan['Execution Time'],
            })),
            repositoryPhases: report.searchProfile.repositoryPhases,
          }),
      )
    }
    // Twenty distinct actors contend for one genuinely submitted dossier via the HTTP workflow.
    const draft = (await request(owner, '/submissions', { serviceId, versionId })).data
    const sent = (
      await request(owner, '/submissions/' + draft.id + '/submit', {
        expectedRevision: draft.revision,
      })
    ).data
    const contenders = await Promise.all(
      actors.map((a) =>
        request(
          a,
          '/review-submissions/' + sent.id + '/claim',
          { expectedRevision: sent.revision },
          [200, 409],
        ),
      ),
    )
    assert.equal(contenders.filter((r) => r.status === 200).length, 1)
    for (const r of contenders.filter((r) => r.status === 409))
      assert.equal(r.data.code, 'ALREADY_CLAIMED')
    const winnerIndex = contenders.findIndex((r) => r.status === 200),
      winner = actors[winnerIndex],
      claimed = contenders[winnerIndex].data
    assert.equal(claimed.revision, sent.revision + 1)
    const retries = await Promise.all(
      Array.from({ length: 20 }, () =>
        request(winner, '/review-submissions/' + sent.id + '/claim', {
          expectedRevision: sent.revision,
        }),
      ),
    )
    for (const r of retries) {
      assert.equal(r.data.revision, claimed.revision)
      assert.equal(r.data.reviewStartedAt, claimed.reviewStartedAt)
    }
    const [counts] = await q(
      "SELECT (SELECT count(*) FROM submission_events WHERE submission_id=$1 AND action='CLAIMED')::int AS events,(SELECT count(*) FROM personal_notifications WHERE submission_id=$1)::int AS notifications,(SELECT count(*) FROM audit_logs WHERE resource_id=$2 AND action='SUBMISSION_CLAIM')::int AS audits",
      [sent.id, sent.id],
    )
    assert.deepEqual({ ...counts }, { events: 1, notifications: 1, audits: 1 })
    const reader = actors[(winnerIndex + 1) % 20],
      notificationId = [...noticeIds.get(reader.id)][0]
    const readResults = await Promise.all(
      Array.from({ length: 20 }, () =>
        request(reader, '/notifications/' + notificationId + '/read', {}),
      ),
    )
    const [marked] = await q(
      'SELECT read_at::text AS time FROM personal_notifications WHERE id=$1',
      [notificationId],
    )
    assert.ok(marked.time)
    assert.ok(readResults.every((r) => r.data.readAt === readResults[0].data.readAt))
    await request(reader, '/notifications/' + notificationId + '/read', {})
    const [again] = await q(
      'SELECT read_at::text AS time FROM personal_notifications WHERE id=$1',
      [notificationId],
    )
    assert.equal(again.time, marked.time)
    assert.equal((await request(reader, '/notifications/unread-count')).data.unreadCount, 49)
    const foreignReads = await Promise.all(
      actors
        .filter((a) => a.id !== reader.id)
        .map((a) => request(a, '/notifications/' + notificationId + '/read', {}, 404)),
    )
    assert.equal(foreignReads.length, 19)
    // Current DB authority must override still-valid test sessions after grant withdrawal.
    await q('DELETE FROM user_role_scopes WHERE user_id=$1 AND role_id=$2', [reader.id, roleId])
    await request(reader, '/review-submissions?status=SUBMITTED', undefined, 403)
    assert.equal((await request(reader, '/notifications')).data.items.length, 0)
    report.correctness = {
      distinctClaimants: 20,
      winners: 1,
      expectedConflicts: 19,
      idempotentClaimRetries: 20,
      claimEvents: counts.events,
      claimNotifications: counts.notifications,
      claimAudits: counts.audits,
      concurrentMarkRead: readResults.length,
      foreignMarkReadDenied: foreignReads.length,
      revokedScopeChecked: true,
    }
    report.http = { requests: httpRequests, statuses: httpStatuses }
    report.claimRace = stats(contenders.map((r) => r.ms))
    report.markReadRace = stats(readResults.map((r) => r.ms))
    report.completedAt = new Date().toISOString()
    report.status = 'PASS'
    console.log('CONCURRENCY_CORRECTNESS ' + JSON.stringify(report.correctness))
  } finally {
    if (child && child.exitCode === null) {
      child.send('stop')
      const timer = setTimeout(() => child.kill(), 5000)
      await once(child, 'exit')
      clearTimeout(timer)
    }
    if (stream && !stream.writableFinished) {
      const finished = once(stream, 'finish')
      stream.end()
      await finished
    }
    try {
      if (seeded) {
        await sql.begin(async (cleanupSql) => {
          const q = (text, params = []) => cleanupSql.unsafe(text, params)
          await q('LOCK TABLE ' + protectedTables + ' IN ACCESS EXCLUSIVE MODE')
          // Immutability forbids DELETE on submitted content. TRUNCATE only after ownership checks.
          const [foreign] = await q(
            'SELECT (SELECT count(*) FROM submissions WHERE service_id<>$1)::int AS dossiers,(SELECT count(*) FROM procedure_versions WHERE service_id<>$1)::int AS versions',
            [serviceId ?? -1],
          )
          assert.deepEqual(
            { ...foreign },
            { dossiers: 0, versions: 0 },
            'Foreign test data appeared; refusing cleanup TRUNCATE',
          )
          await q('TRUNCATE ' + protectedTables)
          // Audit is append-only and deliberately survives fixture account removal.
          report.retainedTestAudits = (
            await q(
              'SELECT count(*)::int AS n FROM audit_logs WHERE actor_user_id=ANY($1::uuid[])',
              [userIds],
            )
          )[0].n
          await q('DELETE FROM users WHERE id=ANY($1::uuid[]) OR starts_with(username,$2)', [
            userIds,
            prefix + 'bulk',
          ])
          if (roleId) await q('DELETE FROM roles WHERE id=$1', [roleId])
          await q('DELETE FROM authorization_scopes WHERE id=$1', [scopeId])
          await q('DELETE FROM academic_classes WHERE id=$1', [classId])
          await q('DELETE FROM faculties WHERE id=$1', [facultyId])
          if (serviceId) await q('DELETE FROM services WHERE id=$1', [serviceId])
          await q('DELETE FROM organizational_units WHERE id=ANY($1::uuid[])', [
            [unitId, foreignUnitId],
          ])
          const [left] = await q(
            'SELECT (SELECT count(*) FROM submissions)::int AS dossiers,(SELECT count(*) FROM procedure_versions)::int AS versions,(SELECT count(*) FROM users WHERE starts_with(username,$1))::int AS users',
            [prefix],
          )
          assert.deepEqual({ ...left }, { dossiers: 0, versions: 0, users: 0 })
        })
        report.cleanupVerified = true
      }
    } finally {
      if (locked) await q('SELECT pg_advisory_unlock(821719,1)')
      await sql.end()
    }
  }
  await writeFile(
    resolve(root, 'run/concurrency-report.json'),
    JSON.stringify(report, null, 2) + '\n',
  )
  console.log(
    'PASS: bounded concurrent HTTP check; cleanup verified; report run/concurrency-report.json',
  )
}
function round(n) {
  return Math.round(n * 100) / 100
}
function stats(values) {
  const sorted = [...values].sort((a, b) => a - b)
  return {
    samples: sorted.length,
    p50Ms: round(sorted[Math.ceil(sorted.length * 0.5) - 1]),
    p95Ms: round(sorted[Math.ceil(sorted.length * 0.95) - 1]),
    maxMs: round(sorted.at(-1)),
  }
}
