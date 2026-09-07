import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { FastifyInstance } from 'fastify'

import { buildApp } from '../../app.js'
import {
  ADMIN_JWT_AUDIENCE,
  ADMIN_SESSION_COOKIE_NAME,
  ADMIN_SESSION_TTL_SECONDS,
  JWT_ISSUER,
} from '../auth/auth.constants.js'
import type {
  AuthorizationUseCase,
  PermissionCheckInput,
} from '../auth/authorization.service.js'
import type {
  ExportStudentsInput,
  StudentExportFile,
  StudentExportUseCase,
} from './student-export.service.js'
import {
  XLSX_CONTENT_TYPE,
} from './student-export.xlsx.js'

const actorUserId =
  '2f230120-c001-4e71-a17d-f18541e64d87'
const facultyId =
  '46f9323a-1c5c-4c8a-b596-cac83f5eaf96'

class FakeStudentExportService
implements StudentExportUseCase {
  receivedInput:
    ExportStudentsInput | undefined

  async exportStudents(
    input: ExportStudentsInput,
  ): Promise<StudentExportFile> {
    this.receivedInput = input
    return {
      buffer: Buffer.from('xlsx-test'),
      contentType: XLSX_CONTENT_TYPE,
      fileName: 'students-test.xlsx',
      rowCount: 2,
    }
  }
}

class FakeAuthorizationService
implements AuthorizationUseCase {
  constructor(private readonly allowed: boolean) {}

  receivedChecks: PermissionCheckInput[] = []

  async hasPermission(
    input: PermissionCheckInput,
  ) {
    this.receivedChecks.push(input)
    return this.allowed
  }
}

async function createAdminCookie(
  app: FastifyInstance,
) {
  await app.ready()
  const token = app.jwt.sign({
    sub: actorUserId,
    username: 'system.admin',
    roles: ['SYSTEM_ADMIN'],
    mustChangePassword: false,
    portal: 'admin',
    aud: ADMIN_JWT_AUDIENCE,
    iss: JWT_ISSUER,
  }, {
    expiresIn: ADMIN_SESSION_TTL_SECONDS,
  })

  return `${ADMIN_SESSION_COOKIE_NAME}=${token}`
}

test(
  'GET export yêu cầu session và student.export',
  async (context) => {
    const exportService =
      new FakeStudentExportService()
    const authorizationService =
      new FakeAuthorizationService(false)
    const app = buildApp({
      studentExportService: exportService,
      authorizationService,
    })
    context.after(() => app.close())

    const unauthorized = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/students/export.xlsx',
    })
    assert.equal(unauthorized.statusCode, 401)

    const cookie = await createAdminCookie(app)
    const forbidden = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/students/export.xlsx',
      headers: { cookie },
    })
    assert.equal(forbidden.statusCode, 403)
    assert.deepEqual(
      authorizationService.receivedChecks,
      [{
        userId: actorUserId,
        permission: 'student.export',
      }],
    )
    assert.equal(exportService.receivedInput, undefined)
  },
)

test(
  'GET export trả attachment XLSX và chuyển bộ lọc',
  async (context) => {
    const exportService =
      new FakeStudentExportService()
    const authorizationService =
      new FakeAuthorizationService(true)
    const app = buildApp({
      studentExportService: exportService,
      authorizationService,
    })
    context.after(() => app.close())

    const cookie = await createAdminCookie(app)
    const response = await app.inject({
      method: 'GET',
      url:
        '/api/v1/admin/students/export.xlsx'
        + '?status=ACTIVE'
        + `&facultyId=${facultyId}`
        + '&search=Nguyen',
      headers: {
        cookie,
        'user-agent': 'student-export-route-test',
      },
    })

    assert.equal(response.statusCode, 200)
    assert.equal(
      response.headers['content-type'],
      XLSX_CONTENT_TYPE,
    )
    assert.equal(
      response.headers['content-disposition'],
      'attachment; filename="students-test.xlsx"',
    )
    assert.equal(
      response.headers['x-export-row-count'],
      '2',
    )
    assert.deepEqual(
      exportService.receivedInput,
      {
        actorUserId,
        actorUsername: 'system.admin',
        audit: {
          requestId: 'req-1',
          ipAddress: '127.0.0.1',
          userAgent: 'student-export-route-test',
        },
        status: 'ACTIVE',
        facultyId,
        search: 'Nguyen',
      },
    )
    assert.equal(response.rawPayload.toString(), 'xlsx-test')
  },
)
