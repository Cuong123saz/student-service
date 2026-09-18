import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  AuthService,
  InvalidCredentialsError,
  type AuthUserRepository,
  type UserForAuthentication,
} from './auth.service.js'

import type { PasswordHasher } from './password-hasher.js'

const activeUser: UserForAuthentication = {
  id: '85ca4291-c7bd-4370-a117-976bf237261c',
  username: 'student001',
  passwordHash: 'stored-password-hash',
  status: 'ACTIVE',
  mustChangePassword: false,
  roles: ['STUDENT'],
}

class FakeUserRepository implements AuthUserRepository {
  lastUsername: string | undefined

  constructor(private readonly user: UserForAuthentication | null) {}

  async findByUsername(username: string): Promise<UserForAuthentication | null> {
    this.lastUsername = username
    return this.user
  }
}

class FakePasswordHasher implements PasswordHasher {
  lastVerifiedHash: string | undefined

  async hash(plainTextPassword: string): Promise<string> {
    return `hashed:${plainTextPassword}`
  }

  async verify(passwordHash: string, plainTextPassword: string): Promise<boolean> {
    this.lastVerifiedHash = passwordHash

    return passwordHash === 'stored-password-hash' && plainTextPassword === 'CorrectPassword'
  }
}

test('authenticate trả người dùng khi thông tin hợp lệ', async () => {
  const repository = new FakeUserRepository(activeUser)

  const passwordHasher = new FakePasswordHasher()

  const authService = new AuthService(repository, passwordHasher, 'dummy-password-hash')

  const result = await authService.authenticate({
    username: '  STUDENT001  ',
    password: 'CorrectPassword',
  })

  assert.equal(repository.lastUsername, 'student001')

  assert.deepEqual(result, {
    id: activeUser.id,
    username: 'student001',
    mustChangePassword: false,
    roles: ['STUDENT'],
  })
})

test('authenticate từ chối mật khẩu sai', async () => {
  const authService = new AuthService(
    new FakeUserRepository(activeUser),
    new FakePasswordHasher(),
    'dummy-password-hash',
  )

  await assert.rejects(
    () =>
      authService.authenticate({
        username: 'student001',
        password: 'WrongPassword',
      }),
    InvalidCredentialsError,
  )
})

test('authenticate dùng dummy hash khi tài khoản không tồn tại', async () => {
  const passwordHasher = new FakePasswordHasher()

  const authService = new AuthService(
    new FakeUserRepository(null),
    passwordHasher,
    'dummy-password-hash',
  )

  await assert.rejects(
    () =>
      authService.authenticate({
        username: 'unknown',
        password: 'SomePassword',
      }),
    InvalidCredentialsError,
  )

  assert.equal(passwordHasher.lastVerifiedHash, 'dummy-password-hash')
})
test('authenticate từ chối tài khoản chưa có mật khẩu', async () => {
  const userWithoutPassword: UserForAuthentication = {
    ...activeUser,
    passwordHash: null,

    // Giữ ACTIVE để test chỉ tập trung
    // vào trường hợp passwordHash null.
    status: 'ACTIVE',
  }

  const passwordHasher = new FakePasswordHasher()

  const authService = new AuthService(
    new FakeUserRepository(userWithoutPassword),
    passwordHasher,
    'dummy-password-hash',
  )

  await assert.rejects(
    () =>
      authService.authenticate({
        username: 'student001',
        password: 'SomePassword',
      }),
    InvalidCredentialsError,
  )

  assert.equal(passwordHasher.lastVerifiedHash, 'dummy-password-hash')
})
test('authenticate từ chối tài khoản không active', async () => {
  const inactiveUser = {
    ...activeUser,
    status: 'INACTIVE',
  }

  const authService = new AuthService(
    new FakeUserRepository(inactiveUser),
    new FakePasswordHasher(),
    'dummy-password-hash',
  )

  await assert.rejects(
    () =>
      authService.authenticate({
        username: 'student001',
        password: 'CorrectPassword',
      }),
    InvalidCredentialsError,
  )
})
