import assert from 'node:assert/strict'
import {
  after,
  before,
  beforeEach,
  test,
} from 'node:test'
import {
  requireAdminReadySession,
  requireAdminSession,
} from './admin-auth.guard.js'
import { buildApp } from '../../app.js'
import {
  databaseClient,
  db,
} from '../../db/client.js'
import {
  roles,
  userRoles,
  users,
} from './auth.schema.js'
import {
  Argon2PasswordHasher,
} from './password-hasher.js'
import {
  ADMIN_API_PREFIX,
  ADMIN_SESSION_COOKIE_NAME,
  ADMIN_SESSION_TTL_SECONDS,
} from './auth.constants.js'
import { eq } from 'drizzle-orm'
const databaseUrl =
  process.env.DATABASE_URL

if (
  !databaseUrl
  || new URL(databaseUrl).pathname
    !== '/student_service_test'
) {
  throw new Error(
    'Integration tests must use the student_service_test database',
  )
}

const password = 'CorrectPasswordForTest'
const passwordHasher =
  new Argon2PasswordHasher()

let passwordHash: string
before(async () => {
  passwordHash =
    await passwordHasher.hash(password)
})

beforeEach(async () => {
  await db.delete(userRoles)
  await db.delete(users)
  await db.delete(roles)
})

after(async () => {
  await databaseClient.end()
})

async function createUserWithRole(
  username: string,
  roleCode: string,
  mustChangePassword = false,
) {
  const insertedUsers = await db
    .insert(users)
    .values({
      username,
      passwordHash,
      fullName: 'Test User',
      status: 'ACTIVE',
      mustChangePassword,
    })
    .returning()

  const insertedUser =
    insertedUsers[0]

  assert.ok(insertedUser)

  const insertedRoles = await db
    .insert(roles)
    .values({
      code: roleCode,
      name: roleCode,
      isSystem: true,
    })
    .returning()

  const insertedRole =
    insertedRoles[0]

  assert.ok(insertedRole)

  await db.insert(userRoles).values({
    userId: insertedUser.id,
    roleId: insertedRole.id,
  })

  return insertedUser
}

test(
  'POST /api/v1/admin/auth/login tạo admin_session khi hợp lệ',
  async (context) => {
    const createdUser =
      await createUserWithRole(
        'system.admin',
        'SYSTEM_ADMIN',
      )

    const app = buildApp()

    context.after(async () => {
      await app.close()
    })

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/auth/login',
      payload: {
        username: 'system.admin',
        password,
      },
    })

    assert.equal(
      response.statusCode,
      200,
    )

    assert.deepEqual(
      response.json(),
      {
        user: {
          id: createdUser.id,
          username: 'system.admin',
          mustChangePassword: false,
          roles: ['SYSTEM_ADMIN'],
        },
      },
    )

    const setCookie =
      response.headers['set-cookie']

    if (typeof setCookie !== 'string') {
      assert.fail(
        'Expected Set-Cookie header',
      )
    }

    assert.match(
      setCookie,
      new RegExp(
        `${ADMIN_SESSION_COOKIE_NAME}=`,
      ),
    )

    assert.match(
      setCookie,
      /HttpOnly/,
    )

    assert.match(
      setCookie,
      /SameSite=Strict/,
    )

    assert.match(
      setCookie,
      new RegExp(
        `Path=${ADMIN_API_PREFIX}`,
      ),
    )

    assert.match(
      setCookie,
      new RegExp(
        `Max-Age=${ADMIN_SESSION_TTL_SECONDS}`,
      ),
    )

    const tokenPattern = new RegExp(
      `${ADMIN_SESSION_COOKIE_NAME}=([^;]+)`,
    )

    const tokenMatch =
      tokenPattern.exec(setCookie)

    assert.ok(tokenMatch)

    const encodedToken = tokenMatch[1]

    assert.ok(encodedToken)

    const token = decodeURIComponent(
      encodedToken,
    )

    const payload = app.jwt.verify<{
      iat: number
      exp: number
    }>(token)

    assert.equal(
      payload.exp - payload.iat,
      ADMIN_SESSION_TTL_SECONDS,
    )

    assert.equal(
      response.body.includes(
        'passwordHash',
      ),
      false,
    )

    assert.equal(
      response.body.includes('token'),
      false,
    )
  },
)

test(
  'POST /api/v1/admin/auth/login trả 401 khi mật khẩu sai',
  async (context) => {
    await createUserWithRole(
      'system.admin',
      'SYSTEM_ADMIN',
    )

    const app = buildApp()

    context.after(async () => {
      await app.close()
    })

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/auth/login',
      payload: {
        username: 'system.admin',
        password: 'WrongPassword',
      },
    })

    assert.equal(
      response.statusCode,
      401,
    )

    assert.deepEqual(
      response.json(),
      {
        message:
          'Invalid username or password',
      },
    )

    assert.equal(
      response.headers['set-cookie'],
      undefined,
    )
  },
)

test(
  'POST /api/v1/admin/auth/login từ chối tài khoản STUDENT',
  async (context) => {
    await createUserWithRole(
      'student001',
      'STUDENT',
    )

    const app = buildApp()

    context.after(async () => {
      await app.close()
    })

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/auth/login',
      payload: {
        username: 'student001',
        password,
      },
    })

    assert.equal(
      response.statusCode,
      403,
    )

    assert.equal(
      response.headers['set-cookie'],
      undefined,
    )
  },
)

test(
  'POST /api/v1/admin/auth/login trả 400 khi body không hợp lệ',
  async (context) => {
    const app = buildApp()

    context.after(async () => {
      await app.close()
    })

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/auth/login',
      payload: {
        username: '',
      },
    })

    assert.equal(
      response.statusCode,
      400,
    )
  },
)
test(
  'GET /api/v1/admin/auth/me trả 401 khi không có cookie',
  async (context) => {
    const app = buildApp()

    context.after(async () => {
      await app.close()
    })

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/auth/me',
    })

    assert.equal(
      response.statusCode,
      401,
    )

    assert.deepEqual(
      response.json(),
      {
        message: 'Unauthorized',
      },
    )
  },
)

test(
  'GET /api/v1/admin/auth/me trả thông tin từ session hợp lệ',
  async (context) => {
    const createdUser =
      await createUserWithRole(
        'system.admin',
        'SYSTEM_ADMIN',
      )

    const app = buildApp()

    context.after(async () => {
      await app.close()
    })

    const loginResponse =
      await app.inject({
        method: 'POST',
        url:
          '/api/v1/admin/auth/login',
        payload: {
          username: 'system.admin',
          password,
        },
      })

    const setCookie =
      loginResponse
        .headers['set-cookie']

    if (typeof setCookie !== 'string') {
      assert.fail(
        'Expected Set-Cookie header',
      )
    }

    const cookieHeader =
      setCookie.split(';')[0]

    assert.ok(cookieHeader)

    const response = await app.inject({
      method: 'GET',
      url:
        '/api/v1/admin/auth/me',
      headers: {
        cookie: cookieHeader,
      },
    })

    assert.equal(
      response.statusCode,
      200,
    )

    assert.deepEqual(
      response.json(),
      {
        user: {
          id: createdUser.id,
          username: 'system.admin',
          roles: ['SYSTEM_ADMIN'],
          mustChangePassword: false,
        },
      },
    )
  },
)

test(
  'GET /api/v1/admin/auth/me trả 401 khi token bị sửa',
  async (context) => {
    const app = buildApp()

    context.after(async () => {
      await app.close()
    })

    const response = await app.inject({
      method: 'GET',
      url:
        '/api/v1/admin/auth/me',
      headers: {
        cookie:
          `${ADMIN_SESSION_COOKIE_NAME}=invalid-token`,
      },
    })

    assert.equal(
      response.statusCode,
      401,
    )

    assert.deepEqual(
      response.json(),
      {
        message: 'Unauthorized',
      },
    )
  },
)
test(
  'POST /api/v1/admin/auth/logout xóa admin session cookie',
  async (context) => {
    const app = buildApp()

    context.after(async () => {
      await app.close()
    })

    const response = await app.inject({
      method: 'POST',
      url:
        '/api/v1/admin/auth/logout',
    })

    assert.equal(
      response.statusCode,
      204,
    )

    const clearedCookie =
      response.cookies.find(
        (cookie) =>
          cookie.name
          === ADMIN_SESSION_COOKIE_NAME,
      )

    assert.ok(clearedCookie)
    assert.equal(
      clearedCookie.value,
      '',
    )
    assert.equal(
      clearedCookie.path,
      ADMIN_API_PREFIX,
    )
    assert.equal(
      clearedCookie.maxAge,
      0,
    )
  },
)
test(
  'API trả security headers',
  async (context) => {
    const app = buildApp()

    context.after(async () => {
      await app.close()
    })

    const response = await app.inject({
      method: 'GET',
      url:
        '/api/v1/admin/auth/me',
    })

    assert.equal(
      response.headers[
        'x-content-type-options'
      ],
      'nosniff',
    )

    assert.ok(
      response.headers[
        'content-security-policy'
      ],
    )
  },
)
test(
  'POST /api/v1/admin/auth/change-password đổi mật khẩu và xóa session',
  async (context) => {
    const newPassword =
      'NewPasswordForTest2026'

    const createdUser =
      await createUserWithRole(
        'system.admin',
        'SYSTEM_ADMIN',
        true,
      )

    const app = buildApp()

    context.after(async () => {
      await app.close()
    })

    // Đăng nhập bằng mật khẩu ban đầu
    const loginResponse =
      await app.inject({
        method: 'POST',
        url:
          '/api/v1/admin/auth/login',
        payload: {
          username: 'system.admin',
          password,
        },
      })

    assert.equal(
      loginResponse.statusCode,
      200,
    )

    const setCookie =
      loginResponse
        .headers['set-cookie']

    if (typeof setCookie !== 'string') {
      assert.fail(
        'Expected Set-Cookie header',
      )
    }

    const cookieHeader =
      setCookie.split(';')[0]

    assert.ok(cookieHeader)

    // Gọi API đổi mật khẩu
    const changeResponse =
      await app.inject({
        method: 'POST',
        url:
          '/api/v1/admin/auth/change-password',
        headers: {
          cookie: cookieHeader,
        },
        payload: {
          currentPassword: password,
          newPassword,
        },
      })

    assert.equal(
      changeResponse.statusCode,
      204,
    )

    // Session cũ phải bị xóa
    const clearedCookie =
      changeResponse.cookies.find(
        (cookie) =>
          cookie.name
          === ADMIN_SESSION_COOKIE_NAME,
      )

    assert.ok(clearedCookie)
    assert.equal(clearedCookie.value, '')
    assert.equal(clearedCookie.maxAge, 0)
    assert.equal(
      clearedCookie.path,
      ADMIN_API_PREFIX,
    )

    // Kiểm tra trạng thái trong database
    const updatedUsers =
      await db
        .select()
        .from(users)
        .where(
          eq(users.id, createdUser.id),
        )

    const updatedUser =
      updatedUsers[0]

    assert.ok(updatedUser)

    assert.equal(
      updatedUser.mustChangePassword,
      false,
    )

    assert.equal(
      await passwordHasher.verify(
        updatedUser.passwordHash,
        newPassword,
      ),
      true,
    )

    // Mật khẩu cũ không đăng nhập được nữa
    const oldPasswordResponse =
      await app.inject({
        method: 'POST',
        url:
          '/api/v1/admin/auth/login',
        payload: {
          username: 'system.admin',
          password,
        },
      })

    assert.equal(
      oldPasswordResponse.statusCode,
      401,
    )

    // Mật khẩu mới đăng nhập thành công
    const newPasswordResponse =
      await app.inject({
        method: 'POST',
        url:
          '/api/v1/admin/auth/login',
        payload: {
          username: 'system.admin',
          password: newPassword,
        },
      })

    assert.equal(
      newPasswordResponse.statusCode,
      200,
    )
  },
)
test(
  'POST /api/v1/admin/auth/change-password trả 401 khi không có cookie',
  async (context) => {
    const app = buildApp()

    context.after(async () => {
      await app.close()
    })

    const response = await app.inject({
      method: 'POST',
      url:
        '/api/v1/admin/auth/change-password',
      payload: {
        currentPassword: password,
        newPassword:
          'NewPasswordForTest2026',
      },
    })

    assert.equal(
      response.statusCode,
      401,
    )

    assert.deepEqual(
      response.json(),
      {
        message: 'Unauthorized',
      },
    )
  },
)
test(
  'POST /api/v1/admin/auth/change-password không cập nhật khi mật khẩu hiện tại sai',
  async (context) => {
    const createdUser =
      await createUserWithRole(
        'system.admin',
        'SYSTEM_ADMIN',
        true,
      )

    const originalPasswordHash =
      createdUser.passwordHash

    const app = buildApp()

    context.after(async () => {
      await app.close()
    })

    const loginResponse =
      await app.inject({
        method: 'POST',
        url:
          '/api/v1/admin/auth/login',
        payload: {
          username: 'system.admin',
          password,
        },
      })

    const setCookie =
      loginResponse
        .headers['set-cookie']

    if (typeof setCookie !== 'string') {
      assert.fail(
        'Expected Set-Cookie header',
      )
    }

    const cookieHeader =
      setCookie.split(';')[0]

    assert.ok(cookieHeader)

    const response = await app.inject({
      method: 'POST',
      url:
        '/api/v1/admin/auth/change-password',
      headers: {
        cookie: cookieHeader,
      },
      payload: {
        currentPassword:
          'IncorrectCurrentPassword',
        newPassword:
          'NewPasswordForTest2026',
      },
    })

    assert.equal(
      response.statusCode,
      400,
    )

    assert.deepEqual(
      response.json(),
      {
        message:
          'Current password is incorrect',
      },
    )

    const storedUsers =
      await db
        .select()
        .from(users)
        .where(
          eq(users.id, createdUser.id),
        )

    const storedUser =
      storedUsers[0]

    assert.ok(storedUser)

    assert.equal(
      storedUser.passwordHash,
      originalPasswordHash,
    )

    assert.equal(
      storedUser.mustChangePassword,
      true,
    )
  },
)
test(
  'admin phải đổi mật khẩu trước khi dùng chức năng quản trị',
  async (context) => {
    await createUserWithRole(
      'system.admin',
      'SYSTEM_ADMIN',
      true,
    )

    const app = buildApp()

    // Route này chỉ tồn tại trong test,
    // không được đưa vào production.
    app.get(
      '/api/v1/admin/test/ready',
      {
        preHandler: [
          requireAdminSession,
          requireAdminReadySession,
        ],
      },
      async () => {
        return {
          ok: true,
        }
      },
    )

    context.after(async () => {
      await app.close()
    })

    const loginResponse =
      await app.inject({
        method: 'POST',
        url:
          '/api/v1/admin/auth/login',
        payload: {
          username: 'system.admin',
          password,
        },
      })

    assert.equal(
      loginResponse.statusCode,
      200,
    )

    const setCookie =
      loginResponse
        .headers['set-cookie']

    if (typeof setCookie !== 'string') {
      assert.fail(
        'Expected Set-Cookie header',
      )
    }

    const cookieHeader =
      setCookie.split(';')[0]

    assert.ok(cookieHeader)

    const response =
      await app.inject({
        method: 'GET',
        url:
          '/api/v1/admin/test/ready',
        headers: {
          cookie: cookieHeader,
        },
      })

    assert.equal(
      response.statusCode,
      403,
    )

    assert.deepEqual(
      response.json(),
      {
        message:
          'Password change required',
      },
    )
  },
)
test(
  'admin đã đổi mật khẩu được dùng chức năng quản trị',
  async (context) => {
    await createUserWithRole(
      'system.admin',
      'SYSTEM_ADMIN',
      false,
    )

    const app = buildApp()

    app.get(
      '/api/v1/admin/test/ready',
      {
        preHandler: [
          requireAdminSession,
          requireAdminReadySession,
        ],
      },
      async () => {
        return {
          ok: true,
        }
      },
    )

    context.after(async () => {
      await app.close()
    })

    const loginResponse =
      await app.inject({
        method: 'POST',
        url:
          '/api/v1/admin/auth/login',
        payload: {
          username: 'system.admin',
          password,
        },
      })

    assert.equal(
      loginResponse.statusCode,
      200,
    )

    const setCookie =
      loginResponse
        .headers['set-cookie']

    if (typeof setCookie !== 'string') {
      assert.fail(
        'Expected Set-Cookie header',
      )
    }

    const cookieHeader =
      setCookie.split(';')[0]

    assert.ok(cookieHeader)

    const response =
      await app.inject({
        method: 'GET',
        url:
          '/api/v1/admin/test/ready',
        headers: {
          cookie: cookieHeader,
        },
      })

    assert.equal(
      response.statusCode,
      200,
    )

    assert.deepEqual(
      response.json(),
      {
        ok: true,
      },
    )
  },
)