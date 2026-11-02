import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cohortLabel, parseCohortValue } from './student-cohort.js'

test('niên khóa K = năm vào học − 2006, lưu năm vào học', () => {
  assert.equal(cohortLabel(2021), 'K15')
  assert.equal(cohortLabel(2007), 'K1')
  for (const value of ['K15', 'k15', ' K15 ', '15', 15, '2021', 2021])
    assert.equal(parseCohortValue(value), 2021, String(value))
  assert.equal(parseCohortValue('K1'), 2007)
  assert.equal(parseCohortValue('K94'), 2100)
})

test('giá trị mơ hồ hoặc ngoài khoảng bị từ chối, không đoán', () => {
  for (const value of [
    'K2021',
    'K0',
    '0',
    'K95',
    '2006',
    '2101',
    '021',
    'K-1',
    '15.5',
    15.5,
    'K15A',
    '',
  ])
    assert.equal(parseCohortValue(value), null, String(value))
})
