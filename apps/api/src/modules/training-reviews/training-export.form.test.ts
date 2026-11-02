import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { strFromU8, unzipSync } from 'fflate'
import type { TrainingExportSnapshot } from './training-export.types.js'
import { createTrainingFormDocx, trainingFormTemplate } from './training-export.docx.js'

const sample = async () =>
  JSON.parse(
    await readFile(
      new URL('../../../scripts/fixtures/training-export/snapshot.json', import.meta.url),
      'utf8',
    ),
  ) as TrainingExportSnapshot
const visible = (bytes: Buffer) =>
  [...strFromU8(unzipSync(bytes)['word/document.xml']!).matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)]
    .map((m) => m[1]!.replaceAll('&amp;', '&'))
    .join('\n')

test('phiếu đánh giá in theo mẫu: thông tin sinh viên, điểm tự khai và điểm duyệt theo 5 mục', async () => {
  const s = await sample()
  const text = visible(createTrainingFormDocx(s, s.rows[0]!.declarationId))
  for (const expected of [
    'PHIẾU ĐÁNH GIÁ KẾT QUẢ RÈN LUYỆN CHO SINH VIÊN',
    'Nguyễn Minh An (giả định)',
    '10/02/2003',
    '001234',
    'K15',
    'Tiêu chí thử nghiệm A',
    'TỔNG CỘNG',
    'Lớp trưởng Lớp trưởng thử nghiệm đã xác nhận lúc 21/10/2026 10:00 (UTC+7).',
    'CỐ VẤN HỌC TẬP',
    'LỚP TRƯỞNG',
    'SINH VIÊN',
    s.notice,
  ])
    assert.ok(text.includes(expected), expected)
  // Section A: self 10, approved 9; totals 15 and 14 stay separate.
  assert.match(text, /\nI\nTiêu chí thử nghiệm A\n0 ÷ 20 điểm\n10\n9\n/)
  assert.match(text, /TỔNG CỘNG\n15\n14\n/)
  assert.match(text, /Xếp loại \(tạm tính\): \nKém/)
  const footer = strFromU8(
    unzipSync(createTrainingFormDocx(s, s.rows[0]!.declarationId))['word/footer1.xml']!,
  )
  assert.ok(footer.includes(trainingFormTemplate.label))
})

test('phiếu chỉ in cho bản đã được khoa duyệt trong snapshot; thiếu dữ liệu thì để dòng chấm', async () => {
  const s = await sample()
  assert.throws(
    () => createTrainingFormDocx(s, '99999999-0000-4000-8000-000000000000'),
    /ROW_MISSING/,
  )
  const text = visible(createTrainingFormDocx(s, s.rows[1]!.declarationId))
  assert.ok(text.includes('Không có bước lớp trưởng'))
  assert.match(text, /Ngày sinh: \n………/)
})
