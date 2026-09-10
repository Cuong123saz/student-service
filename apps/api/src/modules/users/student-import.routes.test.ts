import assert from 'node:assert/strict'
import { eq, inArray, sql } from 'drizzle-orm'
import { after, beforeEach, test } from 'node:test'
import type { FastifyInstance } from 'fastify'
import { zipSync } from 'fflate'

import { buildApp } from '../../app.js'
import { databaseClient, db } from '../../db/client.js'
import { auditLogs } from '../audit/audit.schema.js'
import {
  ADMIN_JWT_AUDIENCE,
  ADMIN_SESSION_COOKIE_NAME,
  ADMIN_SESSION_TTL_SECONDS,
  JWT_ISSUER,
} from '../auth/auth.constants.js'
import { roles, userRoles, users } from '../auth/auth.schema.js'
import {
  authorizationScopes,
  permissions,
  rolePermissions,
  userRoleScopes,
} from '../auth/authorization.schema.js'
import {
  academicAdvisorAssignments,
  academicClasses,
  faculties,
  studentProfiles,
} from '../organizations/organization.schema.js'
import { DrizzleStudentImportRepository } from './student-import.repository.js'
import { StudentImportService } from './student-import.service.js'
import { DrizzleStudentImportPreviewStore } from './student-import-preview.repository.js'
import { DrizzleStudentImportProcessingJobRepository } from './student-import-processing-job.repository.js'
import { StudentImportProcessingJobService } from './student-import-processing-job.service.js'
import {
  studentImportFiles,
  studentImportPreviews,
  studentImportProcessingJobs,
} from './student-import.schema.js'
import { invitationDeliveryJobs } from './invitation-delivery-job.schema.js'
import { parseStudentImportFile } from './student-import.parser.js'
import { XLSX_CONTENT_TYPE } from './student-export.xlsx.js'

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl || new URL(databaseUrl).pathname !== '/student_service_test') {
  throw new Error('Integration tests must use the student_service_test database')
}

async function cleanDatabase() {
  await db.execute(sql`TRUNCATE TABLE ${auditLogs}`)
  await db.delete(studentImportProcessingJobs)
  await db.delete(studentImportPreviews)
  await db.delete(studentImportFiles)
  await db.delete(userRoleScopes)
  await db.delete(authorizationScopes)
  await db.delete(rolePermissions)
  await db.delete(permissions)
  await db.delete(academicAdvisorAssignments)
  await db.delete(studentProfiles)
  await db.delete(academicClasses)
  await db.delete(faculties)
  await db.delete(userRoles)
  await db.delete(users)
  await db.delete(roles)
}

beforeEach(cleanDatabase)

after(async () => {
  await cleanDatabase()
  await databaseClient.end()
})

async function createImportContext() {
  const [faculty] = await db
    .insert(faculties)
    .values({
      code: 'QLGD',
      name: 'Khoa Quản lý giáo dục',
    })
    .returning({ id: faculties.id })
  assert.ok(faculty)

  const [academicClass] = await db
    .insert(academicClasses)
    .values({
      facultyId: faculty.id,
      code: 'K15A',
      name: 'Quản lý giáo dục K15A',
    })
    .returning({ id: academicClasses.id })
  assert.ok(academicClass)

  const [actor] = await db
    .insert(users)
    .values({
      username: 'import.admin',
      fullName: 'Import Admin',
      status: 'ACTIVE',
      mustChangePassword: false,
    })
    .returning({
      id: users.id,
      username: users.username,
    })
  assert.ok(actor)

  const insertedRoles = await db
    .insert(roles)
    .values([
      {
        code: 'ADMIN',
        name: 'Quản trị nghiệp vụ',
        isSystem: true,
      },
      {
        code: 'STUDENT',
        name: 'Sinh viên',
        isSystem: true,
      },
    ])
    .returning({
      id: roles.id,
      code: roles.code,
    })
  const adminRole = insertedRoles.find((role) => role.code === 'ADMIN')
  assert.ok(adminRole)

  const [permission] = await db
    .insert(permissions)
    .values({
      code: 'student.import',
      name: 'Import sinh viên',
      isSystem: true,
    })
    .returning({ id: permissions.id })
  assert.ok(permission)

  await db.insert(userRoles).values({
    userId: actor.id,
    roleId: adminRole.id,
  })
  await db.insert(rolePermissions).values({
    roleId: adminRole.id,
    permissionId: permission.id,
  })

  const [scope] = await db
    .insert(authorizationScopes)
    .values({ scopeType: 'GLOBAL' })
    .returning({ id: authorizationScopes.id })
  assert.ok(scope)

  await db.insert(userRoleScopes).values({
    userId: actor.id,
    roleId: adminRole.id,
    scopeId: scope.id,
  })

  return { actor, academicClass }
}

async function createAdminCookie(app: FastifyInstance, actor: { id: string; username: string }) {
  await app.ready()
  const token = app.jwt.sign(
    {
      sub: actor.id,
      username: actor.username,
      roles: ['ADMIN'],
      mustChangePassword: false,
      portal: 'admin',
      aud: ADMIN_JWT_AUDIENCE,
      iss: JWT_ISSUER,
    },
    { expiresIn: ADMIN_SESSION_TTL_SECONDS },
  )

  return `${ADMIN_SESSION_COOKIE_NAME}=${token}`
}

function multipartFile(input: { content: Buffer; fileName: string; mediaType: string }) {
  const boundary = `student-import-${crypto.randomUUID()}`
  const prefix = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${input.fileName}"\r\n` +
      `Content-Type: ${input.mediaType}\r\n\r\n`,
  )
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`)

  return {
    payload: Buffer.concat([prefix, input.content, suffix]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  }
}

function multipartCsv(csv: string) {
  return multipartFile({
    content: Buffer.from(csv),
    fileName: 'students.csv',
    mediaType: 'text/csv',
  })
}

function createApp() {
  const previewStore = new DrizzleStudentImportPreviewStore()
  const importService = new StudentImportService(new DrizzleStudentImportRepository(), previewStore)
  const jobService = new StudentImportProcessingJobService(
    new DrizzleStudentImportProcessingJobRepository(),
    importService,
  )
  return {
    app: buildApp({
      studentImportService: importService,
      studentImportProcessingJobService: jobService,
    }),
    jobService,
    previewStore,
  }
}

async function uploadAndProcessPreview(
  app: FastifyInstance,
  jobService: StudentImportProcessingJobService,
  cookie: string,
  upload: ReturnType<typeof multipartCsv>,
) {
  const queued = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/students/imports/preview',
    headers: {
      cookie,
      'content-type': upload.contentType,
    },
    payload: upload.payload,
  })

  assert.equal(queued.statusCode, 202)
  const { jobId } = queued.json<{ jobId: string }>()
  assert.equal(await jobService.processNext(crypto.randomUUID()), true)

  const status = await app.inject({
    method: 'GET',
    url: `/api/v1/admin/students/imports/jobs/${jobId}`,
    headers: { cookie },
  })
  assert.equal(status.statusCode, 200)
  const body = status.json<{
    status: string
    errorCode: string | null
    preview: unknown
  }>()
  assert.equal(body.status, 'SUCCEEDED')
  assert.equal(body.errorCode, null)
  assert.ok(body.preview)
  return body.preview
}

test('tải file Excel mẫu đúng cấu trúc import', async (context) => {
  const { actor } = await createImportContext()
  const { app } = createApp()
  context.after(() => app.close())

  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/admin/students/import-template.xlsx',
    headers: {
      cookie: await createAdminCookie(app, actor),
    },
  })

  assert.equal(response.statusCode, 200)
  assert.equal(response.headers['content-type'], XLSX_CONTENT_TYPE)
  assert.equal(
    response.headers['content-disposition'],
    'attachment; filename="mau-import-sinh-vien.xlsx"',
  )

  const parsed = await parseStudentImportFile('mau-import-sinh-vien.xlsx', response.rawPayload)
  assert.equal(parsed.rows.length, 2)
  assert.deepEqual(parsed.rows[0]?.values, {
    studentCode: '00123456',
    fullName: 'Nguyễn Văn A',
    email: '00123456@example.edu.vn',
    classCode: 'K15A',
  })
})

test('worker từ chối XLSX có tỷ lệ nén bất thường trước khi parse', async (context) => {
  const { actor } = await createImportContext()
  const { app, jobService } = createApp()
  context.after(() => app.close())
  const cookie = await createAdminCookie(app, actor)
  const archive = Buffer.from(
    zipSync({
      'xl/worksheets/sheet1.xml': new Uint8Array(1024 * 1024),
    }),
  )
  const upload = multipartFile({
    content: archive,
    fileName: 'archive-bomb.xlsx',
    mediaType: XLSX_CONTENT_TYPE,
  })

  const queued = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/students/imports/preview',
    headers: {
      cookie,
      'content-type': upload.contentType,
    },
    payload: upload.payload,
  })
  assert.equal(queued.statusCode, 202)
  const { jobId } = queued.json<{ jobId: string }>()

  assert.equal(await jobService.processNext(crypto.randomUUID()), true)

  const status = await app.inject({
    method: 'GET',
    url: `/api/v1/admin/students/imports/jobs/${jobId}`,
    headers: { cookie },
  })
  assert.equal(status.statusCode, 200)
  assert.deepEqual(status.json(), {
    jobId,
    status: 'FAILED',
    errorCode: 'IMPORT_ARCHIVE_LIMIT_EXCEEDED',
    preview: null,
  })
})

test('preview rồi confirm ghi toàn bộ sinh viên và audit', async (context) => {
  const { actor } = await createImportContext()
  const { app, jobService } = createApp()
  context.after(() => app.close())
  const cookie = await createAdminCookie(app, actor)
  const upload = multipartCsv(
    [
      'studentCode,fullName,email,classCode',
      '001,Nguyễn Văn A,sv001@example.edu.vn,K15A',
      '002,Trần Thị B,sv002@example.edu.vn,K15A',
    ].join('\n'),
  )

  const preview = (await uploadAndProcessPreview(app, jobService, cookie, upload)) as {
    previewId: string
    summary: {
      valid: number
      errors: number
      duplicates: number
    }
  }
  assert.deepEqual(preview.summary, {
    total: 2,
    valid: 2,
    errors: 0,
    duplicates: 0,
  })
  assert.deepEqual(
    await db.select().from(studentProfiles),
    [],
    'preview must not persist student data',
  )

  const confirmResponse = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/students/imports/${preview.previewId}/confirm`,
    headers: { cookie },
    payload: { duplicateStrategy: 'FAIL' },
  })

  assert.equal(confirmResponse.statusCode, 200)
  assert.deepEqual(confirmResponse.json(), {
    imported: 2,
    updated: 0,
    skipped: 0,
  })

  const importedProfiles = await db
    .select({ code: studentProfiles.studentCode })
    .from(studentProfiles)
    .where(inArray(studentProfiles.studentCode, ['001', '002']))
  assert.equal(importedProfiles.length, 2)

  const queuedInvitations = await db
    .select({
      status: invitationDeliveryJobs.status,
    })
    .from(invitationDeliveryJobs)
  assert.deepEqual(
    queuedInvitations.map((job) => job.status),
    ['PENDING', 'PENDING'],
    'import and invitation enqueue must commit together',
  )

  const [audit] = await db
    .select({
      action: auditLogs.action,
      actorUserId: auditLogs.actorUserId,
      after: auditLogs.after,
    })
    .from(auditLogs)
    .where(eq(auditLogs.action, 'STUDENT_IMPORT_COMMIT'))
  assert.ok(audit)
  assert.equal(audit.actorUserId, actor.id)
  assert.deepEqual(audit.after, {
    imported: 2,
    updated: 0,
    skipped: 0,
    processed: 2,
  })
})

test('preview giữ lại giá trị dòng lỗi sau khi serialize HTTP', async (context) => {
  const { actor } = await createImportContext()
  const { app, jobService } = createApp()
  context.after(() => app.close())
  const cookie = await createAdminCookie(app, actor)
  const upload = multipartCsv(
    ['studentCode,fullName,email,classCode', '9001,Nguyễn Văn A,email-sai,K15A'].join('\n'),
  )

  const body = (await uploadAndProcessPreview(app, jobService, cookie, upload)) as {
    summary: {
      errors: number
    }
    errorRecords: Array<{
      sourceRow: number
      values: {
        studentCode: {
          kind: string
          text: string | null
        }
        fullName: {
          kind: string
          text: string | null
        }
        email: {
          kind: string
          text: string | null
        }
        classCode: {
          kind: string
          text: string | null
        }
      }
      issues: Array<{
        field: string
        code: string
        message: string
      }>
    }>
  }

  assert.equal(body.summary.errors, 1)
  assert.equal(body.errorRecords.length, 1)
  assert.equal(body.errorRecords[0]?.sourceRow, 2)
  assert.deepEqual(body.errorRecords[0]?.values, {
    studentCode: {
      kind: 'TEXT',
      text: '9001',
    },
    fullName: {
      kind: 'TEXT',
      text: 'Nguyễn Văn A',
    },
    email: {
      kind: 'TEXT',
      text: 'email-sai',
    },
    classCode: {
      kind: 'TEXT',
      text: 'K15A',
    },
  })
  assert.deepEqual(body.errorRecords[0]?.issues, [
    {
      field: 'email',
      code: 'INVALID_FORMAT',
      message: 'email has an invalid format',
    },
  ])
})

test('confirm rollback toàn bộ khi dữ liệu trùng xuất hiện sau preview', async (context) => {
  const { actor } = await createImportContext()
  const { app, jobService } = createApp()
  context.after(() => app.close())
  const cookie = await createAdminCookie(app, actor)
  const upload = multipartCsv(
    [
      'studentCode,fullName,email,classCode',
      '101,Sinh viên Một,sv101@example.edu.vn,K15A',
      '102,Sinh viên Hai,sv102@example.edu.vn,K15A',
    ].join('\n'),
  )

  const { previewId } = (await uploadAndProcessPreview(app, jobService, cookie, upload)) as {
    previewId: string
  }

  await db.insert(users).values({
    username: 'race.user',
    email: 'sv102@example.edu.vn',
    fullName: 'Dữ liệu tạo đồng thời',
    status: 'ACTIVE',
    mustChangePassword: false,
  })

  const confirmResponse = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/students/imports/${previewId}/confirm`,
    headers: { cookie },
    payload: { duplicateStrategy: 'FAIL' },
  })

  assert.equal(confirmResponse.statusCode, 409)
  const errorBody = confirmResponse.json<{
    message: string
    error: {
      code: string
      requestId: string
    }
  }>()
  assert.equal(errorBody.error.code, 'IMPORT_COMMIT_CONFLICT')
  assert.ok(errorBody.error.requestId)

  const rolledBackUsers = await db
    .select({ username: users.username })
    .from(users)
    .where(eq(users.username, '101'))
  assert.deepEqual(rolledBackUsers, [])

  const importAudits = await db
    .select({ id: auditLogs.id })
    .from(auditLogs)
    .where(eq(auditLogs.action, 'STUDENT_IMPORT_COMMIT'))
  assert.deepEqual(importAudits, [])
})

test('confirm trả structured error khi preview không tồn tại', async (context) => {
  const { actor } = await createImportContext()
  const { app } = createApp()
  context.after(() => app.close())
  const cookie = await createAdminCookie(app, actor)

  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/students/imports/00000000-0000-4000-8000-000000000000/confirm',
    headers: { cookie },
    payload: {
      duplicateStrategy: 'SKIP',
    },
  })

  assert.equal(response.statusCode, 404)
  const errorBody = response.json<{
    message: string
    error: {
      code: string
      requestId: string
    }
  }>()
  assert.equal(errorBody.error.code, 'IMPORT_PREVIEW_NOT_FOUND')
  assert.ok(errorBody.error.requestId)
})

test('duplicate bị FAIL chặn nhưng preview vẫn dùng lại được với SKIP', async (context) => {
  const { actor } = await createImportContext()
  const { app, jobService } = createApp()
  context.after(() => app.close())
  const cookie = await createAdminCookie(app, actor)
  const upload = multipartCsv(
    [
      'studentCode,fullName,email,classCode',
      '401,Sinh viên Một,shared@example.edu.vn,K15A',
      '402,Sinh viên Hai,shared@example.edu.vn,K15A',
    ].join('\n'),
  )

  const { previewId } = (await uploadAndProcessPreview(app, jobService, cookie, upload)) as {
    previewId: string
  }

  const blockedResponse = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/students/imports/${previewId}/confirm`,
    headers: { cookie },
    payload: { duplicateStrategy: 'FAIL' },
  })

  assert.equal(blockedResponse.statusCode, 409)
  const errorBody = blockedResponse.json<{
    error: {
      code: string
      requestId: string
    }
  }>()
  assert.equal(errorBody.error.code, 'IMPORT_DUPLICATE_BLOCKED')
  assert.ok(errorBody.error.requestId)

  const retryResponse = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/students/imports/${previewId}/confirm`,
    headers: { cookie },
    payload: { duplicateStrategy: 'SKIP' },
  })

  assert.equal(retryResponse.statusCode, 200)
  assert.deepEqual(retryResponse.json(), {
    imported: 1,
    updated: 0,
    skipped: 1,
  })
})

test('duplicate mơ hồ chặn OVERWRITE nhưng preview vẫn dùng lại được với SKIP', async (context) => {
  const { actor } = await createImportContext()
  const { app, jobService } = createApp()
  context.after(() => app.close())
  const cookie = await createAdminCookie(app, actor)
  const upload = multipartCsv(
    [
      'studentCode,fullName,email,classCode',
      '501,Sinh viên Một,sv501@example.edu.vn,K15A',
      '502,Sinh viên Hai,sv502@example.edu.vn,K15A',
      '501,Sinh viên Ba,sv502@example.edu.vn,K15A',
    ].join('\n'),
  )

  const { previewId } = (await uploadAndProcessPreview(app, jobService, cookie, upload)) as {
    previewId: string
  }

  const blockedResponse = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/students/imports/${previewId}/confirm`,
    headers: { cookie },
    payload: { duplicateStrategy: 'OVERWRITE' },
  })

  assert.equal(blockedResponse.statusCode, 409)
  const errorBody = blockedResponse.json<{
    error: {
      code: string
      requestId: string
    }
  }>()
  assert.equal(errorBody.error.code, 'IMPORT_AMBIGUOUS_DUPLICATE')
  assert.ok(errorBody.error.requestId)

  const retryResponse = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/students/imports/${previewId}/confirm`,
    headers: { cookie },
    payload: { duplicateStrategy: 'SKIP' },
  })

  assert.equal(retryResponse.statusCode, 200)
  assert.deepEqual(retryResponse.json(), {
    imported: 2,
    updated: 0,
    skipped: 1,
  })
})

test('OVERWRITE cập nhật sinh viên đã tồn tại thay vì tạo bản ghi mới', async (context) => {
  const { actor, academicClass } = await createImportContext()
  const [studentRole] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.code, 'STUDENT'))
    .limit(1)
  assert.ok(studentRole)

  const [existingUser] = await db
    .insert(users)
    .values({
      username: 'sv200',
      email: 'sv200@example.edu.vn',
      fullName: 'Tên trước import',
      status: 'ACTIVE',
      mustChangePassword: false,
    })
    .returning({ id: users.id })
  assert.ok(existingUser)
  await db.insert(userRoles).values({
    userId: existingUser.id,
    roleId: studentRole.id,
  })
  await db.insert(studentProfiles).values({
    userId: existingUser.id,
    studentCode: '200',
    classId: academicClass.id,
  })

  const { app, jobService } = createApp()
  context.after(() => app.close())
  const cookie = await createAdminCookie(app, actor)
  const upload = multipartCsv(
    ['studentCode,fullName,email,classCode', '200,Tên sau import,sv200@example.edu.vn,K15A'].join(
      '\n',
    ),
  )

  const preview = (await uploadAndProcessPreview(app, jobService, cookie, upload)) as {
    previewId: string
    summary: { duplicates: number }
    duplicateRecords: Array<{
      duplicates: Array<{ source: string }>
    }>
  }
  assert.equal(preview.summary.duplicates, 1)
  assert.equal(preview.duplicateRecords[0]?.duplicates[0]?.source, 'SYSTEM')

  const confirmResponse = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/students/imports/${preview.previewId}/confirm`,
    headers: { cookie },
    payload: {
      duplicateStrategy: 'OVERWRITE',
    },
  })
  assert.equal(confirmResponse.statusCode, 200)
  assert.deepEqual(confirmResponse.json(), {
    imported: 0,
    updated: 1,
    skipped: 0,
  })

  const [updatedUser] = await db
    .select({ fullName: users.fullName })
    .from(users)
    .where(eq(users.id, existingUser.id))
  assert.equal(updatedUser?.fullName, 'Tên sau import')
})

test('hai confirm đồng thời chỉ commit preview một lần trên PostgreSQL', async (context) => {
  const { actor } = await createImportContext()
  const { app, jobService } = createApp()
  context.after(() => app.close())
  const cookie = await createAdminCookie(app, actor)
  const upload = multipartCsv(
    [
      'studentCode,fullName,email,classCode',
      '701,Sinh viên Đồng thời,sv701@example.edu.vn,K15A',
    ].join('\n'),
  )
  const preview = (await uploadAndProcessPreview(app, jobService, cookie, upload)) as {
    previewId: string
  }

  const confirm = () =>
    app.inject({
      method: 'POST',
      url: `/api/v1/admin/students/imports/${preview.previewId}/confirm`,
      headers: { cookie },
      payload: { duplicateStrategy: 'FAIL' },
    })

  const responses = await Promise.all([confirm(), confirm()])
  assert.deepEqual(responses.map((response) => response.statusCode).sort(), [200, 404])

  const profiles = await db
    .select({ code: studentProfiles.studentCode })
    .from(studentProfiles)
    .where(eq(studentProfiles.studentCode, '701'))
  assert.equal(profiles.length, 1)

  const jobs = await db.select({ id: invitationDeliveryJobs.id }).from(invitationDeliveryJobs)
  assert.equal(jobs.length, 1)

  const audits = await db
    .select({ id: auditLogs.id })
    .from(auditLogs)
    .where(eq(auditLogs.action, 'STUDENT_IMPORT_COMMIT'))
  assert.equal(audits.length, 1)
})

test('lazy reclaim không cho holder cũ giải phóng lease mới', async (context) => {
  const { actor } = await createImportContext()
  const { app, jobService, previewStore } = createApp()
  context.after(() => app.close())
  const cookie = await createAdminCookie(app, actor)
  const upload = multipartCsv(
    [
      'studentCode,fullName,email,classCode',
      '702,Sinh viên Reclaim,sv702@example.edu.vn,K15A',
    ].join('\n'),
  )
  const preview = (await uploadAndProcessPreview(app, jobService, cookie, upload)) as {
    previewId: string
  }

  const firstTime = new Date()
  const first = await previewStore.acquire(preview.previewId, actor.id, firstTime)
  assert.ok(first)

  const second = await previewStore.acquire(
    preview.previewId,
    actor.id,
    new Date(firstTime.getTime() + 5 * 60 * 1_000 + 1),
  )
  assert.ok(second)
  await first.release()

  const [stored] = await db
    .select({
      status: studentImportPreviews.status,
      lockedBy: studentImportPreviews.lockedBy,
    })
    .from(studentImportPreviews)
    .where(eq(studentImportPreviews.id, preview.previewId))
  assert.deepEqual(stored, {
    status: 'PROCESSING',
    lockedBy: second.acquisitionId,
  })
  await second.release()
})

test('preview yêu cầu permission student.import từ database', async (context) => {
  const { actor } = await createImportContext()
  await db.delete(rolePermissions)
  const { app } = createApp()
  context.after(() => app.close())
  const cookie = await createAdminCookie(app, actor)
  const upload = multipartCsv(
    ['studentCode,fullName,email,classCode', '300,Sinh viên,sv300@example.edu.vn,K15A'].join('\n'),
  )

  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/students/imports/preview',
    headers: {
      cookie,
      'content-type': upload.contentType,
    },
    payload: upload.payload,
  })

  assert.equal(response.statusCode, 403)
  assert.deepEqual(await db.select().from(studentProfiles), [])
})
