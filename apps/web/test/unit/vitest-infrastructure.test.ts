import {
  describe,
  expect,
  it,
} from 'vitest'

describe('Vitest infrastructure', () => {
  it('runs unit tests in the web workspace', () => {
    expect(2 + 2).toBe(4)
  })
})