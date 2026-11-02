import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { strFromU8, unzipSync } from 'fflate'
import { SubmissionError } from '../submissions/submission.types.js'
import { LibreOfficePdfConverter } from '../submissions/submission-document.js'
import type { TrainingExportSnapshot } from './training-export.types.js'
import { createTrainingMinutesDocx, trainingMinutesTemplate } from './training-export.docx.js'

const sample = async () =>
  JSON.parse(
    await readFile(
      new URL('../../../scripts/fixtures/training-export/snapshot.json', import.meta.url),
      'utf8',
    ),
  ) as TrainingExportSnapshot
const parts = (bytes: Buffer) => unzipSync(bytes)
const documentXml = (bytes: Buffer) => strFromU8(parts(bytes)['word/document.xml']!)
/** Visible text of the main document, in order, with XML entities decoded. */
const visible = (xml: string) =>
  [...xml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)]
    .map((m) =>
      m[1]!
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&quot;', '"')
        .replaceAll('&apos;', "'")
        .replaceAll('&amp;', '&'),
    )
    .join('\n')

test('minutes DOCX carries the snapshot, keeps self and approved points apart and labels the trial template', async () => {
  const s = await sample()
  const bytes = createTrainingMinutesDocx(s)
  assert.equal(bytes.subarray(0, 2).toString('ascii'), 'PK')
  const xml = documentXml(bytes)
  const text = visible(xml)
  for (const expected of [
    'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM',
    'BIÊN BẢN HỌP LỚP DEMO01 KHOA DEMO',
    'Đánh giá điểm rèn luyện học kỳ I năm học 2026-2027.',
    'Số phiếu đánh giá đã nộp trên hệ thống: 5; đã được khoa duyệt: 2; chưa duyệt: 3.',
    '+ Xếp loại kém: 2',
    '+ Xếp loại trung bình: 0',
    'PHỤ LỤC — KẾT QUẢ ĐIỂM RÈN LUYỆN ĐÃ ĐƯỢC KHOA DUYỆT',
    s.notice,
    s.snapshotId,
    trainingMinutesTemplate.label,
    'Nguyễn Minh An (giả định)',
    '001234',
    '23/10/2026 10:00 (UTC+7)',
    'Tạm tính theo mốc chuẩn (classification-standard-v1)',
    'THƯ KÝ',
    'GV CỐ VẤN HỌC TẬP',
  ])
    assert.ok(text.includes(expected), expected)
  // The first approved row: self-declared 15 and approved 14 stay separate cells.
  const firstRow = text.slice(text.indexOf('001234'), text.indexOf('Trần Thị Bình'))
  assert.match(firstRow, /\n15\n9\n5\n0\n0\n0\n14\nKém\n/)
  // An approved 0 stays a real 0, it is not replaced by self-declared points.
  assert.match(text, /Lớp lúc nộp: DEMO01\n0\n0\n0\n0\n0\n0\n0\n/)
  assert.ok(xml.includes('<w:tblHeader/>'), 'result header repeats on every page')
  assert.ok(xml.includes('<w:cantSplit/>'), 'rows never split across pages')
  assert.ok(xml.includes('w:orient="landscape"'))
  const header = strFromU8(parts(bytes)['word/header1.xml']!)
  assert.match(header, /DỮ LIỆU THỬ NGHIỆM — CHƯA PHẢI BIỂU MẪU CHÍNH THỨC/)
  const footer = strFromU8(parts(bytes)['word/footer1.xml']!)
  assert.match(footer, /PAGE/)
  assert.ok(footer.includes(s.snapshotId))
})

test('minutes DOCX is deterministic and its content is pinned to the template version', async () => {
  const s = await sample()
  const first = createTrainingMinutesDocx(s)
  assert.deepEqual(createTrainingMinutesDocx(structuredClone(s)), first)
  // Changing the generated layout must bump trainingMinutesTemplate and this pin together.
  // The pin covers the uncompressed parts, so a zip library upgrade alone does not trip it.
  assert.equal(trainingMinutesTemplate.label, 'training-minutes-v2')
  const hash = createHash('sha256')
  for (const [name, content] of Object.entries(parts(first)).sort(([a], [b]) => (a < b ? -1 : 1)))
    hash.update(name + '\u0000').update(content)
  assert.equal(
    hash.digest('hex'),
    '4cc6049334bbace3da4701d6a192c42d4d1bca5e29ebee1c9fccc61aab0119be',
    'layout changed: bump trainingMinutesTemplate.version and update this pin',
  )
})

test('untrusted text stays literal: no markup, fields, links, media or template slots', async () => {
  const s = await sample()
  s.rows[0]!.student.fullName =
    '</w:t></w:r><w:fldSimple w:instr="HYPERLINK x"/>=HYPERLINK("https://example.invalid") {{studentName}} <A&B>\u0001\u0007'
  s.rows[0]!.advisor.actor.fullName = 'Cố vấn "trích dẫn" & \'nháy\''
  s.period.name = 'Đợt <b>đậm</b>\ndòng hai'
  const bytes = createTrainingMinutesDocx(s)
  const all = parts(bytes)
  assert.deepEqual(Object.keys(all).sort(), [
    '[Content_Types].xml',
    '_rels/.rels',
    'word/_rels/document.xml.rels',
    'word/document.xml',
    'word/footer1.xml',
    'word/header1.xml',
    'word/settings.xml',
    'word/styles.xml',
  ])
  const xml = documentXml(bytes)
  assert.doesNotMatch(xml, /<w:fldSimple|<w:hyperlink|<w:instrText|<w:drawing|<w:pict/)
  assert.doesNotMatch(xml, /instrText/, 'page fields live only in the footer')
  assert.doesNotMatch(
    strFromU8(all['word/_rels/document.xml.rels']!),
    /TargetMode="External"|hyperlink|image/,
  )
  const text = visible(xml)
  assert.ok(text.includes('=HYPERLINK("https://example.invalid") {{studentName}} <A&B>'))
  assert.ok(text.includes('</w:t></w:r><w:fldSimple'))
  assert.ok(text.includes('Cố vấn "trích dẫn" & \'nháy\''))
  assert.ok(xml.includes('<w:br/>'), 'newline becomes a line break, not raw markup')
  // XML 1.0 forbidden controls are replaced, so Word/LibreOffice can still open the file.
  // eslint-disable-next-line no-control-regex
  assert.doesNotMatch(xml, /[\u0001\u0007]/)
  assert.ok(text.includes('�'))
})

test('empty snapshot states that nothing is approved instead of an empty or zero-filled table', async () => {
  const s = await sample()
  s.rows = []
  s.summary = { ...s.summary, approved: 0, approvedTotalPoints: 0, approvedAveragePoints: null }
  const text = visible(documentXml(createTrainingMinutesDocx(s)))
  assert.ok(text.includes('Chưa có bản kê khai nào được khoa duyệt trong snapshot này.'))
  assert.ok(text.includes('Chưa có bản được duyệt'))
  assert.ok(text.includes('Không có xác nhận nào trong phạm vi bảng kết quả.'))
})

test('inconsistent or oversized snapshots are rejected before any DOCX byte exists', async () => {
  const broken = await sample()
  broken.summary.approvedTotalPoints++
  assert.throws(
    () => createTrainingMinutesDocx(broken),
    (e) => e instanceof SubmissionError && e.code === 'TRAINING_EXPORT_INTEGRITY',
  )
  const overMax = await sample()
  overMax.rows[0]!.approvedAnswers.A!.points = 21
  assert.throws(
    () => createTrainingMinutesDocx(overMax),
    (e) => e instanceof SubmissionError && e.statusCode === 409,
  )
  const large = await sample()
  large.rows = Array.from({ length: 1001 }, () => large.rows[0]!)
  assert.throws(
    () => createTrainingMinutesDocx(large),
    (e) => e instanceof SubmissionError && e.statusCode === 422,
  )
})

test(
  'real LibreOffice converts the exact minutes DOCX into a structurally valid PDF',
  {
    skip: process.env.TRAINING_MINUTES_REAL_PDF !== 'true' && 'set TRAINING_MINUTES_REAL_PDF=true',
  },
  async () => {
    const pdf = await new LibreOfficePdfConverter().convert(
      createTrainingMinutesDocx(await sample()),
    )
    assert.equal(pdf.subarray(0, 5).toString('ascii'), '%PDF-')
    assert.ok(pdf.length > 10000)
  },
)
