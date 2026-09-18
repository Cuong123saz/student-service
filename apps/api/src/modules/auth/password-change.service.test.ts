import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { PasswordHasher } from './password-hasher.js'
import {
  CurrentPasswordMismatchError,
  PasswordChangeService,
  PasswordReuseError,
  type PasswordChangeRepository,
  type UserPasswordState,
} from './password-change.service.js'
import { InvalidPasswordError } from './password-policy.js'

const currentPassword = 'CurrentPassword2026'

const newPassword = 'NewSecurePassword2026'

const activeUser: UserPasswordState = {
  id: '85ca4291-c7bd-4370-a117-976bf237261c',
  passwordHash: 'stored-hash',
  status: 'ACTIVE',
}

class FakePasswordChangeRepository implements PasswordChangeRepository {
  updatedPasswordHash: string | undefined

  constructor(private readonly user: UserPasswordState | null) {}

  async findPasswordStateById() {
    return this.user
  }

  async updatePassword(_userId: string, passwordHash: string) {
    this.updatedPasswordHash = passwordHash

    return true
  }
}

class FakePasswordHasher implements PasswordHasher {
  async hash(password: string) {
    return `hashed:${password}`
  }

  async verify(passwordHash: string, password: string) {
    return passwordHash === 'stored-hash' && password === currentPassword
  }
}

test('đổi mật khẩu khi thông tin hợp lệ', async () => {
  const repository = new FakePasswordChangeRepository(activeUser)

  const service = new PasswordChangeService(repository, new FakePasswordHasher())

  await service.changePassword({
    userId: activeUser.id,
    currentPassword,
    newPassword,
  })

  assert.equal(repository.updatedPasswordHash, `hashed:${newPassword}`)
})

test('từ chối khi mật khẩu hiện tại sai', async () => {
  const repository = new FakePasswordChangeRepository(activeUser)

  const service = new PasswordChangeService(repository, new FakePasswordHasher())

  await assert.rejects(
    () =>
      service.changePassword({
        userId: activeUser.id,
        currentPassword: 'WrongCurrentPassword',
        newPassword,
      }),
    CurrentPasswordMismatchError,
  )

  assert.equal(repository.updatedPasswordHash, undefined)
})

test('từ chối mật khẩu mới quá ngắn', async () => {
  const service = new PasswordChangeService(
    new FakePasswordChangeRepository(activeUser),
    new FakePasswordHasher(),
  )

  await assert.rejects(
    () =>
      service.changePassword({
        userId: activeUser.id,
        currentPassword,
        newPassword: 'too-short',
      }),
    InvalidPasswordError,
  )
})

test('từ chối dùng lại mật khẩu hiện tại', async () => {
  const service = new PasswordChangeService(
    new FakePasswordChangeRepository(activeUser),
    new FakePasswordHasher(),
  )

  await assert.rejects(
    () =>
      service.changePassword({
        userId: activeUser.id,
        currentPassword,
        newPassword: currentPassword,
      }),
    PasswordReuseError,
  )
})
