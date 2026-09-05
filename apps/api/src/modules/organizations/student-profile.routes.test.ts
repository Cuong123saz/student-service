import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { FastifyInstance } from 'fastify'

import { buildApp } from '../../app.js'
import {
  JWT_ISSUER,
  USER_JWT_AUDIENCE,
  USER_SESSION_COOKIE_NAME,
  USER_SESSION_TTL_SECONDS,
} from '../auth/auth.constants.js'
import type {
  CurrentAdvisorView,
  StudentProfileView,
} from './student-profile.repository.js'
import {
  StudentProfileNotFoundError,
  type StudentProfileUseCase,
} from './student-profile.service.js'

const studentId =
  '85ca4291-c7bd-4370-a117-976bf237261c'

const profile: StudentProfileView = {
  userId: studentId,
  username: 'student001',
  fullName: 'Nguyễn Văn A',
  email: 'student001@example.edu.vn',
  studentCode: 'SV001',
  class: {
    id: '505da565-8e6a-4de6-80b6-69024c46654a',
    code: 'QLGD-K15A',
    name: 'Quản lý giáo dục K15A',
  },
  faculty: {
    id: '66b599ca-c87e-4a19-8de8-b81348e65ba6',
    code: 'QLGD',
    name: 'Khoa Quản lý giáo dục',
  },
}

const advisor: CurrentAdvisorView = {
  userId:
    'd960e04b-7f2d-4dc5-a622-40babcc56b7b',
  username: 'advisor001',
  fullName: 'Giảng viên Cố vấn',
  email: null,
  class: profile.class,
  validFrom:
    new Date('2026-01-01T00:00:00.000Z'),
  validTo: null,
}

class FakeStudentProfileService
implements StudentProfileUseCase {
  constructor(
    private readonly profileFailure?: Error,
    private readonly advisorResult:
      CurrentAdvisorView | null = advisor,
    private readonly advisorFailure?: Error,
  ) {}

  async getProfile() {
    if (this.profileFailure) {
      throw this.profileFailure
    }

    return profile
  }

  async getCurrentAdvisor() {
    if (this.advisorFailure) {
      throw this.advisorFailure
    }

    return this.advisorResult
  }
}

async function createUserCookie(
  app: FastifyInstance,
  roles: string[],
) {
  await app.ready()

  const token = app.jwt.sign(
    {
      sub: studentId,
      username: 'student001',
      roles,
      mustChangePassword: false,
      portal: 'user',
      aud: USER_JWT_AUDIENCE,
      iss: JWT_ISSUER,
    },
    {
      expiresIn:
        USER_SESSION_TTL_SECONDS,
    },
  )

  return `${USER_SESSION_COOKIE_NAME}=${token}`
}

test(
  'GET profile trả 401 khi chưa đăng nhập',
  async (context) => {
    const app = buildApp({
      studentProfileService:
        new FakeStudentProfileService(),
    })
    context.after(() => app.close())

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/user/profile',
    })

    assert.equal(response.statusCode, 401)
  },
)

test(
  'GET profile từ chối actor không phải sinh viên',
  async (context) => {
    const app = buildApp({
      studentProfileService:
        new FakeStudentProfileService(),
    })
    context.after(() => app.close())

    const cookie = await createUserCookie(
      app,
      ['ACADEMIC_ADVISOR'],
    )
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/user/profile',
      headers: { cookie },
    })

    assert.equal(response.statusCode, 403)
  },
)

test(
  'GET profile trả hồ sơ của sinh viên đăng nhập',
  async (context) => {
    const app = buildApp({
      studentProfileService:
        new FakeStudentProfileService(),
    })
    context.after(() => app.close())

    const cookie = await createUserCookie(
      app,
      ['STUDENT'],
    )
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/user/profile',
      headers: { cookie },
    })

    assert.equal(response.statusCode, 200)
    assert.deepEqual(response.json(), {
      profile,
    })
  },
)

test(
  'GET advisor trả cố vấn hiện tại của lớp',
  async (context) => {
    const app = buildApp({
      studentProfileService:
        new FakeStudentProfileService(),
    })
    context.after(() => app.close())

    const cookie = await createUserCookie(
      app,
      ['STUDENT'],
    )
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/user/advisor',
      headers: { cookie },
    })

    assert.equal(response.statusCode, 200)
    assert.deepEqual(response.json(), {
      assignmentStatus: 'ASSIGNED',
      advisor: {
        ...advisor,
        validFrom:
          advisor.validFrom.toISOString(),
        validTo: null,
      },
    })
  },
)

test(
  'GET profile trả 404 khi dữ liệu học vụ chưa được cấu hình',
  async (context) => {
    const app = buildApp({
      studentProfileService:
        new FakeStudentProfileService(
          new StudentProfileNotFoundError(),
        ),
    })
    context.after(() => app.close())

    const cookie = await createUserCookie(
      app,
      ['STUDENT'],
    )
    const profileResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/user/profile',
      headers: { cookie },
    })
    assert.equal(profileResponse.statusCode, 404)
  },
)

test(
  'GET advisor trả UNASSIGNED khi hồ sơ có lớp nhưng chưa có cố vấn active',
  async (context) => {
    const app = buildApp({
      studentProfileService:
        new FakeStudentProfileService(
          undefined,
          null,
        ),
    })
    context.after(() => app.close())

    const cookie = await createUserCookie(
      app,
      ['STUDENT'],
    )
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/user/advisor',
      headers: { cookie },
    })

    assert.equal(response.statusCode, 200)
    assert.deepEqual(response.json(), {
      assignmentStatus: 'UNASSIGNED',
      advisor: null,
    })
  },
)
