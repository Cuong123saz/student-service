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
  AdminStudentUseCase,
  ListVisibleStudentsInput,
  StudentDirectoryPage,
  UpdateStudentInput,
} from './admin-student.service.js'

const actorUserId =
  '2f230120-c001-4e71-a17d-f18541e64d87'
const facultyId =
  '46f9323a-1c5c-4c8a-b596-cac83f5eaf96'
const classId =
  'bb3ba725-c20f-43b2-832d-28caab69ad80'

const directoryPage: StudentDirectoryPage = {
  students: [
    {
      userId:
        '7aecf61b-cfe1-476f-9b65-0b328136381b',
      username: 'student.001',
      fullName: 'Nguyễn Văn A',
      email: 'student.001@example.edu.vn',
      status: 'ACTIVE',
      studentCode: 'SV001',
      academicClass: {
        id: classId,
        code: 'K15A',
        name: 'Quản lý giáo dục K15A',
      },
      faculty: {
        id: facultyId,
        code: 'QLGD',
        name: 'Khoa Quản lý giáo dục',
      },
    },
  ],
  nextCursor: 'SV001',
}

class FakeAdminStudentService
implements AdminStudentUseCase {
  receivedInput:
    ListVisibleStudentsInput | undefined
  receivedUpdate:
    Omit<UpdateStudentInput, 'changedAt'> | undefined

  async listVisibleStudents(
    input: ListVisibleStudentsInput,
  ) {
    this.receivedInput = input
    return directoryPage
  }

  async updateStudent(
    input: Omit<UpdateStudentInput, 'changedAt'>,
  ) {
    this.receivedUpdate = input
  }
}

class FakeAuthorizationService
implements AuthorizationUseCase {
  constructor(
    private readonly allowedUserIds:
      ReadonlySet<string>,
  ) {}

  receivedChecks:
    PermissionCheckInput[] = []

  async hasPermission(
    input: PermissionCheckInput,
  ) {
    this.receivedChecks.push(input)
    return this.allowedUserIds.has(input.userId)
  }
}

async function createAdminCookie(
  app: FastifyInstance,
  userId = actorUserId,
) {
  await app.ready()
  const token = app.jwt.sign(
    {
      sub: userId,
      username: 'system.admin',
      roles: ['SYSTEM_ADMIN'],
      mustChangePassword: false,
      portal: 'admin',
      aud: ADMIN_JWT_AUDIENCE,
      iss: JWT_ISSUER,
    },
    {
      expiresIn:
        ADMIN_SESSION_TTL_SECONDS,
    },
  )

  return `${ADMIN_SESSION_COOKIE_NAME}=${token}`
}

test(
  'GET admin students yêu cầu session và student.read',
  async (context) => {
    const studentService =
      new FakeAdminStudentService()
    const authorizationService =
      new FakeAuthorizationService(
        new Set<string>(),
      )
    const app = buildApp({
      adminStudentService: studentService,
      authorizationService,
    })
    context.after(() => app.close())

    const unauthorized = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/students',
    })
    assert.equal(unauthorized.statusCode, 401)

    const cookie = await createAdminCookie(app)
    const forbidden = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/students',
      headers: { cookie },
    })

    assert.equal(forbidden.statusCode, 403)
    assert.deepEqual(
      authorizationService.receivedChecks,
      [
        {
          userId: actorUserId,
          permission: 'student.read',
        },
      ],
    )
    assert.equal(
      studentService.receivedInput,
      undefined,
    )
  },
)

test(
  'GET admin students chuyển đúng bộ lọc và actor vào use case',
  async (context) => {
    const studentService =
      new FakeAdminStudentService()
    const authorizationService =
      new FakeAuthorizationService(
        new Set([actorUserId]),
      )
    const app = buildApp({
      adminStudentService: studentService,
      authorizationService,
    })
    context.after(() => app.close())

    const cookie = await createAdminCookie(app)
    const response = await app.inject({
      method: 'GET',
      url:
        '/api/v1/admin/students'
        + '?limit=25'
        + '&after=SV000'
        + '&status=ACTIVE'
        + `&facultyId=${facultyId}`
        + `&classId=${classId}`
        + '&search=Nguyen',
      headers: { cookie },
    })

    assert.equal(response.statusCode, 200)
    assert.deepEqual(
      authorizationService.receivedChecks,
      [
        {
          userId: actorUserId,
          permission: 'student.read',
        },
      ],
    )
    assert.deepEqual(
      studentService.receivedInput,
      {
        actorUserId,
        limit: 25,
        afterStudentCode: 'SV000',
        status: 'ACTIVE',
        facultyId,
        classId,
        search: 'Nguyen',
      },
    )
    assert.deepEqual(
      response.json(),
      directoryPage,
    )
  },
)

test(
  'GET admin students từ chối query không hợp lệ trước use case',
  async (context) => {
    const studentService =
      new FakeAdminStudentService()
    const authorizationService =
      new FakeAuthorizationService(
        new Set([actorUserId]),
      )
    const app = buildApp({
      adminStudentService: studentService,
      authorizationService,
    })
    context.after(() => app.close())

    const cookie = await createAdminCookie(app)
    const response = await app.inject({
      method: 'GET',
      url:
        '/api/v1/admin/students'
        + '?limit=101'
        + '&facultyId=not-a-uuid',
      headers: { cookie },
    })

    assert.equal(response.statusCode, 400)
    assert.equal(
      studentService.receivedInput,
      undefined,
    )
  },
)

test(
  'PATCH admin student yêu cầu student.update và chuyển dữ liệu chỉnh sửa',
  async (context) => {
    const studentService = new FakeAdminStudentService()
    const authorizationService = new FakeAuthorizationService(
      new Set([actorUserId]),
    )
    const app = buildApp({
      adminStudentService: studentService,
      authorizationService,
    })
    context.after(() => app.close())

    const cookie = await createAdminCookie(app)
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/students/${directoryPage.students[0]?.userId}`,
      headers: { cookie },
      payload: {
        studentCode: '001234',
        fullName: 'Nguyễn Văn A mới',
        facultyId,
        classId,
      },
    })

    assert.equal(response.statusCode, 204)
    assert.equal(
      authorizationService.receivedChecks.at(-1)?.permission,
      'student.update',
    )
    assert.deepEqual(studentService.receivedUpdate, {
      actorUserId,
      actorUsername: 'system.admin',
      userId: directoryPage.students[0]?.userId,
      studentCode: '001234',
      fullName: 'Nguyễn Văn A mới',
      facultyId,
      classId,
      audit: {
        requestId: response.headers['x-request-id'] ?? studentService.receivedUpdate?.audit.requestId,
        ipAddress: '127.0.0.1',
        userAgent: 'lightMyRequest',
      },
    })
  },
)

test('PATCH admin student từ chối mã có chữ trước use case', async (context) => {
  const studentService = new FakeAdminStudentService()
  const app = buildApp({
    adminStudentService: studentService,
    authorizationService: new FakeAuthorizationService(new Set([actorUserId])),
  })
  context.after(() => app.close())

  const response = await app.inject({
    method: 'PATCH',
    url: `/api/v1/admin/students/${directoryPage.students[0]?.userId}`,
    headers: { cookie: await createAdminCookie(app) },
    payload: {
      studentCode: 'SV001',
      fullName: 'Nguyễn Văn A',
      facultyId,
      classId,
    },
  })

  assert.equal(response.statusCode, 400)
  assert.equal(studentService.receivedUpdate, undefined)
})
