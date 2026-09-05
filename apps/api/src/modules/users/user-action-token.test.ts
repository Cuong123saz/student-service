import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  generateActionToken,
  hashActionToken,
} from './user-action-token.js'

test(
  'generateActionToken tạo raw token và SHA-256 hash',
  () => {
    const result =
      generateActionToken()

    assert.notEqual(
      result.rawToken,
      result.tokenHash,
    )

    assert.equal(
      result.tokenHash,
      hashActionToken(result.rawToken),
    )

    assert.match(
      result.tokenHash,
      /^[a-f0-9]{64}$/,
    )
  },
)

test(
  'generateActionToken tạo token khác nhau mỗi lần',
  () => {
    const first =
      generateActionToken()

    const second =
      generateActionToken()

    assert.notEqual(
      first.rawToken,
      second.rawToken,
    )

    assert.notEqual(
      first.tokenHash,
      second.tokenHash,
    )
  },
)
test(
  'generateActionToken tạo token có 256 bit dữ liệu ngẫu nhiên',
  () => {
    const { rawToken } =
      generateActionToken()

    const decodedToken =
      Buffer.from(rawToken, 'base64url')

    assert.equal(
      decodedToken.byteLength,
      32,
    )

    assert.match(
      rawToken,
      /^[A-Za-z0-9_-]+$/,
    )
  },
)
test(
  'hashActionToken sử dụng đúng thuật toán SHA-256',
  () => {
    const expectedHash =
      'ba7816bf8f01cfea414140de5dae2223'
      + 'b00361a396177a9cb410ff61f20015ad'

    assert.equal(
      hashActionToken('abc'),
      expectedHash,
    )
  },
)