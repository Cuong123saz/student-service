import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatDateOfBirth, parseDateOfBirth } from './student-date-of-birth.js'

const today = new Date('2026-11-02T12:00:00Z')

test('ngày sinh đọc theo quy ước ngày/tháng, ô ngày Excel lấy ngày UTC', () => {
  for (const value of ['10/02/2003', '10/2/2003', ' 10/02/2003 ', '2003-02-10'])
    assert.equal(parseDateOfBirth(value, today), '2003-02-10', value)
  // 03/04/2003 is 3 April (day-first), never 4 March.
  assert.equal(parseDateOfBirth('03/04/2003', today), '2003-04-03')
  // An Excel date cell arrives as 00:00 UTC; the UTC date is kept regardless of host timezone.
  assert.equal(parseDateOfBirth(new Date(Date.UTC(2003, 1, 10)), today), '2003-02-10')
  assert.equal(formatDateOfBirth('2003-02-10'), '10/02/2003')
  assert.equal(formatDateOfBirth(null), '')
})

test('ngày không tồn tại, tương lai, trước 1940 hoặc số trơn bị từ chối', () => {
  for (const value of [
    '30/02/2003',
    '31/04/2003',
    '2003-13-01',
    '10-02-2003',
    '2027-01-01',
    '01/01/1939',
    '',
    'abc',
    37662,
  ])
    assert.equal(parseDateOfBirth(value, today), null, String(value))
  assert.equal(parseDateOfBirth(new Date(Number.NaN), today), null)
})
