import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { readSheet } from 'read-excel-file/node'
import { strFromU8, unzipSync } from 'fflate'
import { SubmissionError } from '../submissions/submission.types.js'
import type { TrainingExportSnapshot } from './training-export.types.js'
import { createTrainingExportWorkbook } from './training-export.xlsx.js'
const sample = async () =>
  JSON.parse(
    await readFile(
      new URL('../../../scripts/fixtures/training-export/snapshot.json', import.meta.url),
      'utf8',
    ),
  ) as TrainingExportSnapshot
test('xlsx round trip keeps identifiers as text, scores numeric, and original/reviewed values separate', async () => {
  const s = await sample(),
    bytes = createTrainingExportWorkbook(s)
  const data = await readSheet(bytes, 'Kết quả đã duyệt')
  assert.equal(data.length, 6)
  assert.equal(data[4]![1], '001234')
  assert.equal(data[4]![2], 'Nguyễn Minh An (giả định)')
  assert.equal(data[4]![6], 15)
  assert.equal(data[4]![7], 9)
  assert.equal(data[4]![12], 14)
  assert.equal(data[5]![12], 0)
  const date: unknown = data[4]![14]
  assert.ok(date instanceof Date)
  // Fractional Excel days can lose one millisecond in the independent reader.
  assert.ok(
    Math.abs(date.getTime() - (Date.parse(s.rows[0]!.advisor.confirmedAt) + 7 * 3600000)) <= 1,
  )
  const info = await readSheet(bytes, 'Thông tin')
  assert.equal(info.find((r) => r[0] === 'Khoa đã duyệt')?.[1], 2)
  assert.equal(info.find((r) => r[0] === 'Trung bình đã duyệt')?.[1], 7)
  assert.equal(info.find((r) => r[0] === 'Bản đã nộp')?.[1], 5)
})
test('untrusted formula-like text stays literal without formula, external link or macro parts', async () => {
  const s = await sample()
  s.rows[0]!.student.fullName = '=HYPERLINK("https://example.invalid","<A&B>")'
  s.rows[1]!.student.studentCode = '+001235'
  s.period.name = '@SUM(1,2)'
  const bytes = createTrainingExportWorkbook(s),
    archive = unzipSync(bytes)
  for (const [path, content] of Object.entries(archive)) {
    assert.doesNotMatch(path, /externalLinks|vbaProject/i)
    assert.doesNotMatch(strFromU8(content), /<f\b|<hyperlink\b/)
  }
  const data = await readSheet(bytes, 'Kết quả đã duyệt')
  assert.equal(data[4]![2], s.rows[0]!.student.fullName)
  assert.equal(data[5]![1], '+001235')
})
test('empty approved set keeps null average and emits no fictional zero-point student', async () => {
  const s = await sample()
  s.rows = []
  s.summary.approved = 0
  s.summary.approvedTotalPoints = 0
  s.summary.approvedAveragePoints = null
  s.summary.waitingAdvisor = 3
  const bytes = createTrainingExportWorkbook(s),
    data = await readSheet(bytes, 'Kết quả đã duyệt'),
    info = await readSheet(bytes, 'Thông tin')
  assert.equal(data.length, 4)
  assert.equal(info.find((r) => r[0] === 'Trung bình đã duyệt')?.[1] ?? null, null)
})
test('xlsx accepts the 1000-row boundary, rejects overflow and refuses corrupt totals or incomplete scores', async () => {
  const s = await sample(),
    zero = s.rows[1]!
  s.rows = Array.from({ length: 1000 }, () => structuredClone(zero))
  s.summary = {
    submitted: 1000,
    waitingAdvisor: 0,
    waitingFaculty: 0,
    returnedToAdvisor: 0,
    approved: 1000,
    approvedTotalPoints: 0,
    approvedAveragePoints: 0,
  }
  const archive = unzipSync(createTrainingExportWorkbook(s))
  assert.equal((strFromU8(archive['xl/worksheets/sheet2.xml']!).match(/<row /g) ?? []).length, 1004)
  s.rows.push(structuredClone(zero))
  assert.throws(
    () => createTrainingExportWorkbook(s),
    (e) => e instanceof SubmissionError && e.statusCode === 422,
  )
  const broken = await sample()
  broken.summary.approvedTotalPoints = 15
  assert.throws(
    () => createTrainingExportWorkbook(broken),
    (e) => e instanceof SubmissionError && e.statusCode === 409,
  )
  const incomplete = await sample()
  incomplete.rows[1]!.approvedAnswers.A!.points = null
  assert.throws(
    () => createTrainingExportWorkbook(incomplete),
    (e) => e instanceof SubmissionError && e.statusCode === 409,
  )
})

test('average rounding agrees with PostgreSQL for 201 points across 200 approved records', async () => {
  const s = await sample()
  s.rows = Array.from({ length: 200 }, () => structuredClone(s.rows[1]!))
  for (let i = 0; i < 2; i++) {
    for (const answer of Object.values(s.rows[i]!.approvedAnswers)) answer.points = 20
    s.rows[i]!.approvedPoints = 100
  }
  s.rows[2]!.approvedAnswers.A!.points = 1
  s.rows[2]!.approvedPoints = 1
  s.summary = {
    submitted: 200,
    waitingAdvisor: 0,
    waitingFaculty: 0,
    returnedToAdvisor: 0,
    approved: 200,
    approvedTotalPoints: 201,
    approvedAveragePoints: 1.01,
  }
  const info = await readSheet(createTrainingExportWorkbook(s), 'Thông tin')
  assert.equal(info.find((r) => r[0] === 'Trung bình đã duyệt')?.[1], 1.01)
})
