import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  Argon2PasswordHasher,
} from './password-hasher.js'

const passwordHasher =
  new Argon2PasswordHasher()

test(
  'hash không lưu mật khẩu nguyên bản',
  async () => {
    const password = 'Student@123'
    const passwordHash =
      await passwordHasher.hash(password)

    assert.notEqual(passwordHash, password)
    assert.match(
      passwordHash,
      /^\$argon2id\$/,
    )
  },
)

test(
  'verify trả true khi mật khẩu đúng',
  async () => {
    const password = 'Student@123'
    const passwordHash =
      await passwordHasher.hash(password)

    const matches =
      await passwordHasher.verify(
        passwordHash,
        password,
      )

    assert.equal(matches, true)
  },
)

test(
  'verify trả false khi mật khẩu sai',
  async () => {
    const passwordHash =
      await passwordHasher.hash(
        'Student@123',
      )

    const matches =
      await passwordHasher.verify(
        passwordHash,
        'WrongPassword',
      )

    assert.equal(matches, false)
  },
)

test(
  'cùng mật khẩu vẫn tạo hai hash khác nhau',
  async () => {
    const password = 'Student@123'

    const firstHash =
      await passwordHasher.hash(password)

    const secondHash =
      await passwordHasher.hash(password)

    assert.notEqual(firstHash, secondHash)
  },
)