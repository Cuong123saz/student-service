import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { strFromU8, unzipSync } from 'fflate'
import { readSheet } from 'read-excel-file/node'
import type { TrainingExportSnapshot } from './training-export.types.js'
import { createTrainingClassSheet, trainingClassSheetTemplate } from './training-export.xlsx.js'

const sample = async () =>
  JSON.parse(
    await readFile(
      new URL('../../../scripts/fixtures/training-export/snapshot.json', import.meta.url),
      'utf8',
    ),
  ) as TrainingExportSnapshot

test('bảng điểm lớp theo mẫu trường: tiêu đề, cột, xếp loại tạm tính và chỗ ký để trống', async () => {
  const s = await sample()
  const bytes = createTrainingClassSheet(s)
  const data = await readSheet(bytes, 'Bảng điểm lớp')
  const flat = data.flat().filter((v) => v !== null)
  for (const expected of [
    'BỘ GIÁO DỤC VÀ ĐÀO TẠO',
    'HỌC VIỆN QUẢN LÝ GIÁO DỤC',
    'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM',
    'BẢNG ĐIỂM RÈN LUYỆN LỚP DEMO01 HỌC KỲ I NĂM HỌC 2026-2027',
    s.notice,
    'CỐ VẤN HỌC TẬP',
    'LỚP TRƯỞNG',
  ])
    assert.ok(flat.includes(expected), expected)
  const header = data.findIndex((r) => r[0] === 'STT')
  assert.deepEqual(data[header], [
    'STT',
    'Mã sinh viên',
    'Họ và tên',
    'Ngày sinh',
    'Tổng điểm',
    'Xếp loại',
    'Ghi chú',
  ])
  // Student code keeps its leading zero as text; date of birth is dd/mm/yyyy text (empty when
  // unknown); total is a number; classification is text.
  assert.deepEqual(data[header + 1]!.slice(0, 6), [
    1,
    '001234',
    'Nguyễn Minh An (giả định)',
    '10/02/2003',
    14,
    'Kém',
  ])
  assert.deepEqual(data[header + 2]!.slice(0, 6), [
    2,
    '001235',
    'Trần Thị Bình (giả định)',
    null,
    0,
    'Kém',
  ])
  assert.ok(
    flat.some((v) => typeof v === 'string' && v.includes('chưa duyệt: 3')),
    'pending declarations are counted, not listed',
  )
  assert.ok(
    String(flat.find((v) => typeof v === 'string' && v.startsWith('Snapshot'))).includes(
      trainingClassSheetTemplate.label,
    ),
  )
  const xml = strFromU8(unzipSync(bytes)['xl/worksheets/sheet1.xml']!)
  assert.doesNotMatch(xml, /<f>|<f |hyperlink/i, 'values only, never formulas or links')
  assert.match(xml, /orientation="portrait"/)
})

test('bảng điểm lớp không có bản duyệt ghi rõ, không in hàng điểm 0', async () => {
  const s = await sample()
  s.rows = []
  s.summary = { ...s.summary, approved: 0, approvedTotalPoints: 0, approvedAveragePoints: null }
  const data = await readSheet(createTrainingClassSheet(s), 'Bảng điểm lớp')
  const header = data.findIndex((r) => r[0] === 'STT')
  assert.equal(data[header + 1]![0], 'Chưa có bản kê khai nào được khoa duyệt trong snapshot này.')
})

test('chuỗi giống công thức trong tên vẫn là chữ', async () => {
  const s = await sample()
  s.rows[0]!.student.fullName = '=HYPERLINK("https://example.invalid")'
  const bytes = createTrainingClassSheet(s)
  const data = await readSheet(bytes, 'Bảng điểm lớp')
  assert.ok(data.flat().includes('=HYPERLINK("https://example.invalid")'))
  assert.doesNotMatch(strFromU8(unzipSync(bytes)['xl/worksheets/sheet1.xml']!), /<f>/)
})
