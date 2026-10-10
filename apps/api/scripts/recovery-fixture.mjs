import assert from 'node:assert/strict'
import { createHmac, randomUUID } from 'node:crypto'

export const origin = 'http://localhost:3011'
export const oldBytes = Buffer.from('%PDF-1.4\nFake evidence, first round.\n')
export const newBytes = Buffer.from('%PDF-1.4\nFake evidence, second round.\n')
export async function seedRecoveryFixture(sql) {
  const owner = { id: randomUUID(), username: 'DRILL_OWNER', roles: ['STUDENT'] }
  const other = { id: randomUUID(), username: 'DRILL_OTHER', roles: ['STUDENT'] }
  const reviewer = {
    id: randomUUID(),
    username: 'DRILL_REVIEWER',
    roles: ['FACULTY_REVIEWER', 'ADMIN'],
  }
  const foreign = { id: randomUUID(), username: 'DRILL_FOREIGN', roles: ['FACULTY_REVIEWER'] }
  const unitId = randomUUID(),
    foreignUnitId = randomUUID(),
    facultyId = randomUUID(),
    classId = randomUUID()
  await sql.begin(async (tx) => {
    for (const code of ['STUDENT', 'FACULTY_REVIEWER', 'ADMIN', 'DRILL_REVIEW'])
      await tx`INSERT INTO roles(code,name,is_system) VALUES (${code},${code},false) ON CONFLICT(code) DO NOTHING`
    for (const code of ['submission.review', 'submission.reject'])
      await tx`INSERT INTO permissions(code,name) VALUES (${code},${code}) ON CONFLICT(code) DO NOTHING`
    await tx`INSERT INTO role_permissions(role_id,permission_id)
      SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
      WHERE r.code='DRILL_REVIEW' AND p.code IN ('submission.review','submission.reject') ON CONFLICT DO NOTHING`
    await tx`INSERT INTO organizational_units(id,code,name) VALUES
      (${unitId},'DRILL_UNIT','Đơn vị phục hồi giả định'),(${foreignUnitId},'DRILL_FOREIGN_UNIT','Đơn vị khác giả định')`
    await tx`INSERT INTO faculties(id,code,name) VALUES (${facultyId},'DRILL_FACULTY','Khoa giả định')`
    await tx`INSERT INTO academic_classes(id,faculty_id,code,name) VALUES (${classId},${facultyId},'DRILL_CLASS','Lớp giả định')`
    for (const actor of [owner, other, reviewer, foreign]) {
      await tx`INSERT INTO users(id,username,full_name,status,must_change_password)
        VALUES (${actor.id},${actor.username},${'Người dùng giả định ' + actor.username},'ACTIVE',false)`
      for (const code of [
        ...actor.roles,
        ...(actor.roles.includes('FACULTY_REVIEWER') ? ['DRILL_REVIEW'] : []),
      ])
        await tx`INSERT INTO user_roles(user_id,role_id) SELECT ${actor.id},id FROM roles WHERE code=${code}`
    }
    for (const actor of [owner, other])
      await tx`INSERT INTO student_profiles(user_id,class_id,student_code) VALUES (${actor.id},${classId},${actor.username})`
    for (const [actor, unit] of [
      [reviewer, unitId],
      [foreign, foreignUnitId],
    ]) {
      const [scope] = await tx`INSERT INTO authorization_scopes(scope_type,organizational_unit_id)
        VALUES ('ORGANIZATION',${unit}) RETURNING id`
      await tx`INSERT INTO user_role_scopes(user_id,role_id,scope_id)
        SELECT ${actor.id},id,${scope.id} FROM roles WHERE code='DRILL_REVIEW'`
    }
  })
  const [service] = await sql`INSERT INTO services(code,name,description,processing_days,status)
    VALUES ('DRILL_SERVICE','Thủ tục phục hồi giả định','Chỉ dùng dữ liệu giả',3,'ACTIVE') RETURNING id`
  const config = {
    processingMode: 'ONLINE',
    processingUnitId: unitId,
    processorUserId: null,
    contactInstructions: 'Diễn tập dữ liệu giả',
    fields: [
      {
        key: 'fullName',
        label: 'Họ tên',
        type: 'TEXT',
        source: 'PROFILE',
        profileKey: 'fullName',
        required: true,
        maxLength: 255,
        options: [],
      },
      {
        key: 'purpose',
        label: 'Mục đích',
        type: 'TEXTAREA',
        source: 'STUDENT_INPUT',
        profileKey: null,
        required: true,
        maxLength: 200,
        options: [],
      },
    ],
    attachments: [
      {
        key: 'proof',
        label: 'Minh chứng',
        required: true,
        mimeTypes: ['application/pdf'],
        maxFiles: 1,
        maxBytes: 4096,
      },
    ],
    maxTotalAttachmentBytes: 8192,
  }
  const [version] = await sql`INSERT INTO procedure_versions
    (service_id,owner_unit_id,version_number,status,config,created_by,updated_by,published_at)
    VALUES (${service.id},${unitId},1,'PUBLISHED',${sql.json(config)},${owner.id},${owner.id},now()) RETURNING id`
  return { owner, other, reviewer, foreign, serviceId: service.id, versionId: version.id }
}
export function recoveryHttp(address, secret, counters) {
  function cookie(actor, portal) {
    const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
    const now = Math.floor(Date.now() / 1000)
    const token =
      part({ alg: 'HS256', typ: 'JWT' }) +
      '.' +
      part({
        sub: actor.id,
        username: actor.username,
        roles: actor.roles,
        portal,
        mustChangePassword: false,
        iss: 'student-service-api',
        aud: 'student-service-' + portal,
        iat: now,
        exp: now + 1800,
      })
    return (
      portal +
      '_session=' +
      token +
      '.' +
      createHmac('sha256', secret).update(token).digest('base64url')
    )
  }
  return async (
    actor,
    path,
    { method = 'GET', body, expected = 200, portal = 'user', requestOrigin = origin } = {},
  ) => {
    const response = await fetch(address + '/api/v1/' + portal + path, {
      method,
      headers: {
        ...(actor ? { cookie: cookie(actor, portal) } : {}),
        origin: requestOrigin,
        ...(body === undefined || body instanceof FormData
          ? {}
          : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    })
    counters.requests++
    counters.statuses[response.status] = (counters.statuses[response.status] || 0) + 1
    assert.equal(response.status, expected, 'Unexpected HTTP status for ' + method + ' ' + path)
    if (response.headers.get('content-type')?.includes('application/json')) return response.json()
    assert.match(response.headers.get('cache-control') || '', /no-store/)
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
    return Buffer.from(await response.arrayBuffer())
  }
}
async function upload(http, actor, dossier, bytes, name) {
  const form = new FormData()
  form.append('file', new Blob([bytes], { type: 'application/pdf' }), name)
  return http(actor, `/submissions/${dossier.id}/attachments/proof?revision=${dossier.revision}`, {
    method: 'POST',
    body: form,
  })
}
export async function createRecoveryDossier(http, fixture) {
  const { owner, reviewer, serviceId, versionId } = fixture
  let dossier = await http(owner, '/submissions', {
    method: 'POST',
    body: { serviceId, versionId },
  })
  dossier = await http(owner, `/submissions/${dossier.id}`, {
    method: 'PUT',
    body: { expectedRevision: dossier.revision, values: { purpose: 'Mục đích giả định lần 1' } },
  })
  dossier = await upload(http, owner, dossier, oldBytes, 'minh-chung-gia-lan-1.pdf')
  const oldFileId = dossier.files[0].id
  dossier = await http(owner, `/submissions/${dossier.id}/submit`, {
    method: 'POST',
    body: { expectedRevision: dossier.revision },
  })
  let review = await http(reviewer, `/review-submissions/${dossier.id}/claim`, {
    method: 'POST',
    body: { expectedRevision: dossier.revision },
  })
  review = await http(reviewer, `/review-submissions/${dossier.id}/resolve`, {
    method: 'POST',
    body: {
      expectedRevision: review.revision,
      action: 'REQUEST_SUPPLEMENT',
      note: 'Bổ sung minh chứng giả định',
    },
  })
  dossier = await http(owner, `/submissions/${dossier.id}`)
  assert.equal(dossier.status, 'NEEDS_SUPPLEMENT')
  dossier = await http(
    owner,
    `/submissions/${dossier.id}/files/${oldFileId}?revision=${dossier.revision}`,
    { method: 'DELETE' },
  )
  dossier = await upload(http, owner, dossier, newBytes, 'minh-chung-gia-lan-2.pdf')
  const newFileId = dossier.files[0].id
  dossier = await http(owner, `/submissions/${dossier.id}`, {
    method: 'PUT',
    body: { expectedRevision: dossier.revision, values: { purpose: 'Mục đích giả định lần 2' } },
  })
  dossier = await http(owner, `/submissions/${dossier.id}/submit`, {
    method: 'POST',
    body: { expectedRevision: dossier.revision },
  })
  review = await http(reviewer, `/review-submissions/${dossier.id}/claim`, {
    method: 'POST',
    body: { expectedRevision: dossier.revision },
  })
  assert.equal(review.status, 'IN_REVIEW')
  const ownerView = await http(owner, `/submissions/${dossier.id}`)
  assert.equal(ownerView.rounds.length, 2)
  assert.equal(ownerView.rounds[0].files[0].id, oldFileId)
  const notices = await http(owner, '/notifications')
  assert.ok(notices.unreadCount > 0)
  return {
    id: dossier.id,
    oldFileId,
    newFileId,
    ownerView,
    reviewView: await http(reviewer, `/review-submissions/${dossier.id}`),
    notices,
  }
}
export async function verifyRecoveryHttp(http, fixture, state) {
  const { owner, other, reviewer, foreign } = fixture
  assert.deepEqual(await http(owner, `/submissions/${state.id}`), state.ownerView)
  assert.deepEqual(await http(reviewer, `/review-submissions/${state.id}`), state.reviewView)
  assert.deepEqual(
    await http(reviewer, `/review-submissions/${state.id}`, { portal: 'admin' }),
    state.reviewView,
  )
  assert.deepEqual(await http(owner, '/notifications'), state.notices)
  for (const [actor, base, options] of [
    [owner, 'submissions', {}],
    [reviewer, 'review-submissions', {}],
    [reviewer, 'review-submissions', { portal: 'admin' }],
  ]) {
    assert.deepEqual(
      await http(actor, `/${base}/${state.id}/files/${state.newFileId}`, options),
      newBytes,
    )
    assert.deepEqual(
      await http(actor, `/${base}/${state.id}/rounds/1/files/${state.oldFileId}`, options),
      oldBytes,
    )
    await http(actor, `/${base}/${state.id}/files/${state.oldFileId}`, {
      ...options,
      expected: 404,
    })
  }
  for (const path of [
    `/submissions/${state.id}`,
    `/submissions/${state.id}/files/${state.newFileId}`,
    `/submissions/${state.id}/rounds/1/files/${state.oldFileId}`,
  ])
    await http(other, path, { expected: 404 })
  for (const path of [
    `/review-submissions/${state.id}`,
    `/review-submissions/${state.id}/files/${state.newFileId}`,
    `/review-submissions/${state.id}/rounds/1/files/${state.oldFileId}`,
  ])
    await http(foreign, path, { expected: 404 })
  await http(null, `/submissions/${state.id}/files/${state.newFileId}`, { expected: 401 })
  await http(reviewer, `/review-submissions/${state.id}/resolve`, {
    method: 'POST',
    expected: 403,
    requestOrigin: 'http://example.invalid',
    body: { expectedRevision: state.reviewView.revision, action: 'APPROVE', note: 'Giả định' },
  })
  const notice = state.notices.items[0]
  await http(owner, `/notifications/${notice.id}/read`, { method: 'POST', body: {} })
  const notices = await http(owner, '/notifications')
  assert.equal(notices.unreadCount, state.notices.unreadCount - 1)
}
