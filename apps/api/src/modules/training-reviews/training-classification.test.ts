import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  classifyTrainingPoints,
  countTrainingClassifications,
  trainingClassificationVersion,
} from './training-classification.js'

test('mốc chuẩn đủ 6 mức, đúng tại biên', () => {
  const cases: [number, string][] = [
    [100, 'Xuất sắc'],
    [90, 'Xuất sắc'],
    [89, 'Tốt'],
    [80, 'Tốt'],
    [79, 'Khá'],
    [65, 'Khá'],
    [64, 'Trung bình'],
    [60, 'Trung bình'],
    [50, 'Trung bình'],
    [49, 'Yếu'],
    [35, 'Yếu'],
    [34, 'Kém'],
    [0, 'Kém'],
  ]
  for (const [total, label] of cases)
    assert.equal(classifyTrainingPoints(total).label, label, String(total))
  assert.equal(trainingClassificationVersion, 'classification-standard-v1')
})

test('điểm 60 là Trung bình, không phải Yếu như công thức trong file Excel mẫu', () => {
  assert.equal(classifyTrainingPoints(60).key, 'AVERAGE')
})

test('điểm ngoài 0–100 hoặc không nguyên bị từ chối', () => {
  for (const total of [-1, 101, 80.5, Number.NaN])
    assert.throws(() => classifyTrainingPoints(total), /INVALID_TRAINING_TOTAL/)
})

test('thống kê giữ đủ 6 mức theo thứ tự, kể cả mức 0', () => {
  assert.deepEqual(
    countTrainingClassifications([93, 88, 92, 80, 60]).map((l) => [l.label, l.count]),
    [
      ['Xuất sắc', 2],
      ['Tốt', 2],
      ['Khá', 0],
      ['Trung bình', 1],
      ['Yếu', 0],
      ['Kém', 0],
    ],
  )
})
