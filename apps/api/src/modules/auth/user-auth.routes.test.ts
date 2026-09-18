import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isUserSession } from './auth-session.js'
import { buildApp } from '../../app.js'
import {
  USER_API_PREFIX,
  USER_JWT_AUDIENCE,
  USER_SESSION_COOKIE_NAME,
  USER_SESSION_TTL_SECONDS,
} from './auth.constants.js'

import {
  InvalidCredentialsError,
  type AuthenticatedUser,
  type AuthenticationUseCase,
  type LoginInput,
} from './auth.service.js'

const endpoint = `${USER_API_PREFIX}/auth/login`

const authenticatedStudent: AuthenticatedUser = {
  id: '85ca4291-c7bd-4370-a117-976bf237261c',
  username: 'student001',
  mustChangePassword: false,
  roles: ['STUDENT'],
}

class FakeAuthenticationService implements AuthenticationUseCase {
  receivedInput: LoginInput | undefined

  constructor(
    private readonly result: AuthenticatedUser,

    private readonly failure?: Error,
  ) {}

  async authenticate(input: LoginInput): Promise<AuthenticatedUser> {
    this.receivedInput = input

    if (this.failure) {
      throw this.failure
    }

    return this.result
  }
}

test('POST user login tạo user_session cho sinh viên hợp lệ', async (context) => {
  const authenticationService = new FakeAuthenticationService(authenticatedStudent)

  const app = buildApp({
    userAuthenticationService: authenticationService,
  })

  context.after(async () => {
    await app.close()
  })

  const response = await app.inject({
    method: 'POST',
    url: endpoint,
    payload: {
      username: 'student001',
      password: 'NewSecurePassword2026',
    },
  })

  assert.equal(response.statusCode, 200)

  assert.deepEqual(authenticationService.receivedInput, {
    username: 'student001',
    password: 'NewSecurePassword2026',
  })

  assert.deepEqual(response.json(), {
    user: authenticatedStudent,
  })
  const setCookie = response.headers['set-cookie']

  assert.ok(setCookie)

  const serializedCookie = Array.isArray(setCookie) ? setCookie.join('; ') : setCookie

  assert.match(serializedCookie, new RegExp(`^${USER_SESSION_COOKIE_NAME}=`))

  assert.match(serializedCookie, /Path=\/api\/v1\/user/i)

  assert.match(serializedCookie, /HttpOnly/i)

  assert.match(serializedCookie, /SameSite=Strict/i)
  assert.match(serializedCookie, new RegExp(`Max-Age=${USER_SESSION_TTL_SECONDS}`, 'i'))

  const cookiePair = serializedCookie.split(';')[0]

  assert.ok(cookiePair)

  const encodedToken = cookiePair.slice(`${USER_SESSION_COOKIE_NAME}=`.length)

  const decoded: unknown = app.jwt.verify(encodedToken)

  assert.ok(isUserSession(decoded))

  assert.equal(decoded.portal, 'user')

  assert.equal(decoded.aud, USER_JWT_AUDIENCE)
})
const meEndpoint = `${USER_API_PREFIX}/auth/me`
test('GET user auth me trả thông tin từ user_session hợp lệ', async (context) => {
  const authenticationService = new FakeAuthenticationService(authenticatedStudent)

  const app = buildApp({
    userAuthenticationService: authenticationService,
  })

  context.after(async () => {
    await app.close()
  })

  const loginResponse = await app.inject({
    method: 'POST',
    url: endpoint,
    payload: {
      username: 'student001',
      password: 'NewSecurePassword2026',
    },
  })

  const setCookie = loginResponse.headers['set-cookie']

  assert.ok(setCookie)

  const serializedCookie = Array.isArray(setCookie) ? setCookie[0] : setCookie

  assert.ok(serializedCookie)

  const sessionCookie = serializedCookie.split(';')[0]

  assert.ok(sessionCookie)

  const response = await app.inject({
    method: 'GET',
    url: meEndpoint,
    headers: {
      cookie: sessionCookie,
    },
  })

  assert.equal(response.statusCode, 200)

  assert.deepEqual(response.json(), {
    user: authenticatedStudent,
  })
})
test('POST user login trả 401 khi khi thông tin đăng nhập sai', async (context) => {
  const authenticationService = new FakeAuthenticationService(
    authenticatedStudent,
    new InvalidCredentialsError(),
  )

  const app = buildApp({
    userAuthenticationService: authenticationService,
  })

  context.after(async () => {
    await app.close()
  })

  const response = await app.inject({
    method: 'POST',
    url: endpoint,
    payload: {
      username: 'student001',
      password: 'wrong-password',
    },
  })

  assert.equal(response.statusCode, 401)

  assert.deepEqual(response.json(), {
    message: 'Invalid username or password',
  })

  assert.equal(response.headers['set-cookie'], undefined)
})
test('POST user login từ chối tài khoản chỉ có role admin', async (context) => {
  const authenticationService = new FakeAuthenticationService({
    ...authenticatedStudent,
    roles: ['ADMIN'],
  })

  const app = buildApp({
    userAuthenticationService: authenticationService,
  })

  context.after(async () => {
    await app.close()
  })

  const response = await app.inject({
    method: 'POST',
    url: endpoint,
    payload: {
      username: 'admin001',
      password: 'ValidAdminPassword2026',
    },
  })

  assert.equal(response.statusCode, 403)

  assert.deepEqual(response.json(), {
    message: 'Forbidden',
  })

  assert.equal(response.headers['set-cookie'], undefined)
})
const logoutEndpoint = `${USER_API_PREFIX}/auth/logout`
test(`POST user logout xoa' usser_session dung path`, async (context) => {
  const authenticationService = new FakeAuthenticationService(authenticatedStudent)
  const app = buildApp({
    userAuthenticationService: authenticationService,
  })
  context.after(async () => {
    await app.close()
  })
  const reponse = await app.inject({
    method: 'POST',
    url: logoutEndpoint,
  })
  assert.equal(reponse.statusCode, 204)
  const setCookie = reponse.headers['set-cookie']
  assert.ok(setCookie)
  const serializedCookie = Array.isArray(setCookie) ? setCookie.join('; ') : setCookie

  assert.match(serializedCookie, new RegExp(`^${USER_SESSION_COOKIE_NAME}=`))

  assert.match(serializedCookie, /Path=\/api\/v1\/user/i)

  assert.match(serializedCookie, /Expires=Thu, 01 Jan 1970/i)
})
