import { strToU8, zipSync } from 'fflate'
import { groups } from '../training-points/training-points.types.js'
import type { TrainingExportSnapshot } from './training-export.types.js'
import {
  assertTrainingExportSnapshot,
  trainingExportIntegrityError,
} from './training-export.integrity.js'

export const trainingXlsxMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
type Cell = string | number | null | { date: string }
const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const integrity = trainingExportIntegrityError
function xml(s: string) {
  return (
    s
      // eslint-disable-next-line no-control-regex -- XML 1.0 excludes these characters.
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&apos;')
  )
}
function col(index: number): string {
  let n = index + 1,
    result = ''
  while (n) {
    n--
    result = String.fromCharCode(65 + (n % 26)) + result
    n = Math.floor(n / 26)
  }
  return result
}
function cell(v: Cell, r: number, c: number, style?: number) {
  const ref = `${col(c)}${r}`
  if (v === null) return ''
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw integrity()
    return `<c r="${ref}" s="${style ?? 2}"><v>${v}</v></c>`
  }
  if (typeof v === 'object') {
    const time = Date.parse(v.date)
    if (!Number.isFinite(time)) throw integrity()
    // Excel dates have no timezone. Display Vietnam time and label that timezone explicitly.
    return `<c r="${ref}" s="4"><v>${time / 86400000 + 25569 + 7 / 24}</v></c>`
  }
  // All untrusted text is an inline string, never a formula or a relationship/hyperlink.
  return `<c r="${ref}" t="inlineStr" s="${style ?? 0}"><is><t xml:space="preserve">${xml(v)}</t></is></c>`
}
function row(values: Cell[], r: number, height = 30, style?: number) {
  return `<row r="${r}" ht="${height}" customHeight="1">${values.map((v, c) => cell(v, r, c, style)).join('')}</row>`
}
function sheet(
  rows: string[],
  widths: number[],
  options: { merges?: string[]; filter?: string; freeze?: boolean } = {},
) {
  const pane = options.freeze
    ? '<pane xSplit="4" ySplit="4" topLeftCell="E5" activePane="bottomRight" state="frozen"/>'
    : ''
  return (
    declaration +
    `<worksheet xmlns="${ns}"><sheetViews><sheetView workbookViewId="0" showGridLines="0">${pane}</sheetView></sheetViews>` +
    `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` +
    `<sheetData>${rows.join('')}</sheetData>` +
    (options.filter ? `<autoFilter ref="${options.filter}"/>` : '') +
    (options.merges?.length
      ? `<mergeCells count="${options.merges.length}">${options.merges.map((ref) => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>`
      : '') +
    '</worksheet>'
  )
}
const headers = [
  'STT',
  'Mã sinh viên',
  'Họ và tên',
  'Lớp lúc nộp',
  'Năm học',
  'Học kỳ',
  'Điểm tự khai',
  'Điểm A duyệt',
  'Điểm B duyệt',
  'Điểm C duyệt',
  'Điểm D duyệt',
  'Điểm E duyệt',
  'Tổng điểm duyệt',
  'Cố vấn xác nhận',
  'Thời điểm cố vấn (UTC+7)',
  'Khoa duyệt bởi',
  'Thời điểm khoa (UTC+7)',
  'Mã bản kê khai',
  'Mã quyết định cố vấn',
  'Mã quyết định khoa',
  'SHA-256 bản kê khai',
  'SHA-256 cố vấn',
  'SHA-256 khoa',
]
const widths = [
  7, 18, 34, 19, 16, 12, 14, 12, 12, 12, 12, 12, 16, 32, 25, 32, 25, 40, 40, 40, 68, 68, 68,
]
const styles =
  declaration +
  `<styleSheet xmlns="${ns}">
 <numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy hh:mm &quot;UTC+7&quot;"/></numFmts>
 <fonts count="3"><font><sz val="10"/><color rgb="FF132238"/><name val="Arial"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/></font><font><b/><sz val="16"/><color rgb="FF174C82"/><name val="Arial"/></font></fonts>
 <fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF174C82"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF4E5"/></patternFill></fill></fills>
 <borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFFFFFFF"/></left><right style="thin"><color rgb="FFFFFFFF"/></right><top/><bottom/><diagonal/></border></borders>
 <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
 <cellXfs count="7">
 <xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1" indent="1"/></xf>
 <xf numFmtId="0" fontId="1" fillId="2" borderId="1" applyBorder="1" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
 <xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center" indent="1"/></xf>
 <xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center" indent="1"/></xf>
 <xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center" indent="1"/></xf>
 <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
 <xf numFmtId="49" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1" indent="1"/></xf>
 </cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`

export function createTrainingExportWorkbook(s: TrainingExportSnapshot): Buffer {
  assertTrainingExportSnapshot(s)
  const metadata: [string, Cell][] = [
    ['Mã snapshot', s.snapshotId],
    ['Chốt dữ liệu (UTC+7)', { date: s.capturedAt }],
    ['Người xuất', s.exportedBy.fullName],
    ['Đợt đánh giá', s.period.name],
    ['Lớp của đợt', s.period.classCode + ' — ' + s.period.className],
    ['Khoa hiện tại', s.period.facultyCode + ' — ' + s.period.facultyName],
    ['Năm học', s.period.academicYear],
    ['Học kỳ', s.period.semester],
    ['Trạng thái đợt', s.period.status],
    ['Bộ tiêu chí', s.period.policyLabel],
    ['Bản đã nộp', s.summary.submitted],
    ['Chờ cố vấn', s.summary.waitingAdvisor],
    ['Chờ khoa', s.summary.waitingFaculty],
    ['Khoa trả về', s.summary.returnedToAdvisor],
    ['Khoa đã duyệt', s.summary.approved],
    ['Tổng điểm đã duyệt', s.summary.approvedTotalPoints],
    ['Trung bình đã duyệt', s.summary.approvedAveragePoints],
    ['Xếp loại', 'Chưa gán xếp loại chính thức'],
    ['Xác nhận', 'Tài khoản nghiệp vụ; chữ ký số chưa xác minh'],
    [
      'Nguồn dữ liệu',
      'Snapshot kết quả đã duyệt từ cổng dịch vụ sinh viên. Bản chưa duyệt chỉ nằm trong thống kê.',
    ],
  ]
  const infoRows = [row(['Thông tin kết quả điểm rèn luyện'], 1, 32, 5), row([s.notice], 2, 36, 6)]
  const merges = ['A1:D1', 'A2:D2']
  metadata.forEach(([label, value], i) => {
    const number = i + 4
    infoRows.push(
      `<row r="${number}" ht="${typeof value === 'string' && value.length > 90 ? 48 : 30}" customHeight="1">${cell(label, number, 0)}${cell(value, number, 1, label === 'Trung bình đã duyệt' ? 3 : undefined)}</row>`,
    )
    merges.push(`B${number}:D${number}`)
  })
  const criteriaStart = metadata.length + 5
  infoRows.push(
    row(['Nhóm', 'Tiêu chí', 'Điểm tối đa', 'Minh chứng bắt buộc'], criteriaStart, 36, 1),
  )
  s.period.criteria.forEach((c, i) =>
    infoRows.push(
      row(
        [c.code, c.label, c.maxPoints, c.evidenceRequired ? 'Có' : 'Không'],
        criteriaStart + i + 1,
        Math.max(30, Math.ceil(c.label.length / 60) * 15 + 12),
      ),
    ),
  )
  const detailRows = [
    row(['Kết quả điểm rèn luyện đã được khoa duyệt'], 1, 32, 5),
    row([s.notice], 2, 30, 6),
    row([`Snapshot ${s.snapshotId} — ${s.period.name}`], 3, 36),
    row(headers, 4, 44, 1),
  ]
  s.rows.forEach((r, i) => {
    const values: Cell[] = [
      i + 1,
      r.student.studentCode,
      r.student.fullName,
      r.student.classCode,
      s.period.academicYear,
      s.period.semester,
      r.selfPoints,
      ...groups.map((g) => r.approvedAnswers[g]!.points),
      r.approvedPoints,
      r.advisor.actor.fullName,
      { date: r.advisor.confirmedAt },
      r.faculty.actor.fullName,
      { date: r.faculty.confirmedAt },
      r.declarationId,
      r.advisor.id,
      r.faculty.id,
      r.declarationSha256,
      r.advisor.payloadSha256,
      r.faculty.payloadSha256,
    ]
    const height = Math.min(
      300,
      Math.max(
        34,
        ...values.map((v, c) =>
          typeof v === 'string' ? Math.ceil(v.length / (widths[c]! * 0.8)) * 14 + 10 : 34,
        ),
      ),
    )
    detailRows.push(row(values, i + 5, height))
  })
  const relNs = 'http://schemas.openxmlformats.org/package/2006/relationships'
  const officeRel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  const files = {
    '[Content_Types].xml':
      declaration +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${[1, 2].map((i) => `<Override PartName="/xl/worksheets/sheet${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
    '_rels/.rels':
      declaration +
      `<Relationships xmlns="${relNs}"><Relationship Id="rId1" Type="${officeRel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml':
      declaration +
      `<workbook xmlns="${ns}" xmlns:r="${officeRel}"><sheets><sheet name="Thông tin" sheetId="1" r:id="rId1"/><sheet name="Kết quả đã duyệt" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels':
      declaration +
      `<Relationships xmlns="${relNs}">${[1, 2].map((i) => `<Relationship Id="rId${i}" Type="${officeRel}/worksheet" Target="worksheets/sheet${i}.xml"/>`).join('')}<Relationship Id="rId3" Type="${officeRel}/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': styles,
    'xl/worksheets/sheet1.xml': sheet(infoRows, [32, 68, 16, 22], { merges }),
    'xl/worksheets/sheet2.xml': sheet(detailRows, widths, {
      merges: ['A1:W1', 'A2:W2', 'A3:W3'],
      filter: `A4:W${s.rows.length + 4}`,
      freeze: true,
    }),
  }
  return Buffer.from(
    zipSync(
      Object.fromEntries(Object.entries(files).map(([key, value]) => [key, strToU8(value)])),
      { level: 6 },
    ),
  )
}
