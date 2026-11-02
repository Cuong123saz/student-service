import { strToU8, zipSync } from 'fflate'
import { groups } from '../training-points/training-points.types.js'
import { assertTrainingExportSnapshot } from './training-export.integrity.js'
import type { TrainingExportReceipt, TrainingExportSnapshot } from './training-export.types.js'

export const trainingDocxMime =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/**
 * The layout is code, so the version is a contract: any change to the generated XML must bump
 * this value (and the golden hash test) instead of silently changing an already-issued layout.
 */
export const trainingMinutesTemplate = Object.freeze({
  id: 'training-minutes',
  version: 1,
  label: 'training-minutes-v1',
})

const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const r = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const relNs = 'http://schemas.openxmlformats.org/package/2006/relationships'
// A4 landscape with 1.5 cm side margins: 16838 - 2 * 850 twips of usable width.
const pageWidth = 16838,
  pageHeight = 11906,
  side = 850,
  usable = pageWidth - side * 2

function escape(value: string) {
  return (
    value
      // eslint-disable-next-line no-control-regex -- XML 1.0 excludes these characters.
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '�')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&apos;')
  )
}
interface RunStyle {
  bold?: boolean
  italic?: boolean
  size?: number
  color?: string
}
/** Untrusted text is only ever character data inside w:t, never fields, links or markup. */
function run(text: string, style: RunStyle = {}) {
  const props =
    (style.bold ? '<w:b/><w:bCs/>' : '') +
    (style.italic ? '<w:i/><w:iCs/>' : '') +
    (style.color ? `<w:color w:val="${style.color}"/>` : '') +
    (style.size ? `<w:sz w:val="${style.size}"/><w:szCs w:val="${style.size}"/>` : '')
  return text
    .split(/\r\n|\r|\n/)
    .map(
      (line, i) =>
        `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}${i ? '<w:br/>' : ''}<w:t xml:space="preserve">${escape(line)}</w:t></w:r>`,
    )
    .join('')
}
interface ParagraphStyle {
  style?: string
  align?: 'left' | 'center' | 'right' | 'both'
  keepNext?: boolean
  before?: number
  after?: number
}
function paragraph(content: string, p: ParagraphStyle = {}) {
  const props =
    (p.style ? `<w:pStyle w:val="${p.style}"/>` : '') +
    (p.keepNext ? '<w:keepNext/>' : '') +
    (p.before !== undefined || p.after !== undefined
      ? `<w:spacing w:before="${p.before ?? 0}" w:after="${p.after ?? 0}"/>`
      : '') +
    (p.align ? `<w:jc w:val="${p.align}"/>` : '')
  return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}${content}</w:p>`
}
const text = (value: string, style?: RunStyle, p?: ParagraphStyle) =>
  paragraph(run(value, style), p)
const heading = (value: string) => text(value, undefined, { style: 'Heading2', keepNext: true })

interface Cell {
  content: string | string[]
  width: number
  align?: ParagraphStyle['align']
  bold?: boolean
  span?: number
  shade?: string
}
function cell(c: Cell, keepNext = false) {
  const lines = Array.isArray(c.content) ? c.content : [c.content]
  const props =
    `<w:tcW w:w="${c.width}" w:type="dxa"/>` +
    (c.span ? `<w:gridSpan w:val="${c.span}"/>` : '') +
    (c.shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${c.shade}"/>` : '') +
    '<w:vAlign w:val="center"/>'
  return `<w:tc><w:tcPr>${props}</w:tcPr>${lines
    .map((line) =>
      text(line, c.bold ? { bold: true } : {}, {
        style: 'TableText',
        align: c.align ?? 'left',
        keepNext,
      }),
    )
    .join('')}</w:tc>`
}
interface TableOptions {
  header?: boolean
  borders?: boolean
  keepTogether?: boolean
  /** Minimum row heights in twips, keyed by row index. */
  heights?: Record<number, number>
}
function table(widths: number[], rows: Cell[][], o: TableOptions = {}) {
  const border = o.borders === false ? 'nil' : 'single'
  const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((side) =>
      border === 'nil'
        ? `<w:${side} w:val="nil"/>`
        : `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="7A8699"/>`,
    )
    .join('')
  return (
    `<w:tbl><w:tblPr><w:tblW w:w="${widths.reduce((a, b) => a + b, 0)}" w:type="dxa"/>` +
    `<w:tblBorders>${borders}</w:tblBorders><w:tblLayout w:type="fixed"/>` +
    '<w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="70" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="70" w:type="dxa"/></w:tblCellMar>' +
    `</w:tblPr><w:tblGrid>${widths.map((x) => `<w:gridCol w:w="${x}"/>`).join('')}</w:tblGrid>` +
    rows
      .map((cells, i) => {
        // Rows never split across pages; the result table header repeats on every page.
        const header = o.header && i === 0
        const height = o.heights?.[i]
        const props =
          '<w:cantSplit/>' +
          (header ? '<w:tblHeader/>' : '') +
          (height ? `<w:trHeight w:val="${height}" w:hRule="atLeast"/>` : '')
        const keepNext = Boolean(o.keepTogether && i < rows.length - 1)
        return `<w:tr><w:trPr>${props}</w:trPr>${cells
          .map((c) => cell(header ? { ...c, bold: true, shade: 'DCE6F2' } : c, keepNext))
          .join('')}</w:tr>`
      })
      .join('') +
    '</w:tbl>'
  )
}

/** Vietnam has no DST; a fixed offset keeps output independent of the host ICU/timezone data. */
function vietnamTime(iso: string) {
  const time = Date.parse(iso)
  if (!Number.isFinite(time)) throw new Error('INVALID_EXPORT_TIME')
  const v = new Date(time + 7 * 3600000).toISOString()
  return `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)} ${v.slice(11, 16)} (UTC+7)`
}
const average = (value: number | null) =>
  value === null ? 'Chưa có bản được duyệt' : value.toFixed(2).replace('.', ',')
const roleLabel: Record<string, string> = {
  ACADEMIC_ADVISOR: 'Cố vấn học tập',
  FACULTY_REVIEWER: 'Cán bộ khoa',
}

function confirmers(s: TrainingExportSnapshot) {
  const actors = new Map<
    string,
    { stage: string; actor: TrainingExportReceipt['actor']; count: number }
  >()
  for (const row of s.rows)
    for (const [stage, receipt] of [
      ['Cố vấn xác nhận', row.advisor],
      ['Khoa duyệt', row.faculty],
    ] as const) {
      const key = stage + '\u0000' + receipt.actor.userId
      const found = actors.get(key)
      if (found) found.count++
      else actors.set(key, { stage, actor: receipt.actor, count: 1 })
    }
  return [...actors.values()].sort(
    (a, b) =>
      a.stage.localeCompare(b.stage, 'vi') ||
      a.actor.fullName.localeCompare(b.actor.fullName, 'vi') ||
      (a.actor.userId < b.actor.userId ? -1 : 1),
  )
}

function body(s: TrainingExportSnapshot) {
  const parts: string[] = [
    text(s.notice, { bold: true, color: 'B42318' }, { style: 'Notice', align: 'center' }),
    text('BIÊN BẢN TỔNG HỢP KẾT QUẢ ĐIỂM RÈN LUYỆN', undefined, { style: 'Title' }),
    text(
      `${s.period.name} — Năm học ${s.period.academicYear}, học kỳ ${s.period.semester}`,
      { italic: true },
      { align: 'center', after: 200 },
    ),
    heading('I. Thông tin chung'),
  ]
  const info: [string, string][] = [
    ['Đợt đánh giá', s.period.name],
    ['Năm học / học kỳ', `${s.period.academicYear} / ${s.period.semester}`],
    ['Lớp của đợt', `${s.period.classCode} — ${s.period.className}`],
    ['Khoa hiện tại', `${s.period.facultyCode} — ${s.period.facultyName}`],
    ['Trạng thái đợt', s.period.status],
    ['Bộ tiêu chí', s.period.policyLabel],
    ['Mã snapshot', s.snapshotId],
    ['Thời điểm chốt dữ liệu', vietnamTime(s.capturedAt)],
    ['Người xuất', `${s.exportedBy.fullName} (${s.exportedBy.username})`],
    ['Phiên bản mẫu', trainingMinutesTemplate.label],
  ]
  parts.push(
    table(
      [4000, usable - 4000],
      info.map(([label, value]) => [
        { content: label, width: 4000, bold: true, shade: 'F2F4F7' },
        { content: value, width: usable - 4000 },
      ]),
    ),
    heading('II. Thống kê bản kê khai trong đợt'),
  )
  const stats: [string, string][] = [
    ['Bản đã nộp', String(s.summary.submitted)],
    ['Chờ cố vấn xác nhận', String(s.summary.waitingAdvisor)],
    ['Chờ khoa duyệt', String(s.summary.waitingFaculty)],
    ['Khoa trả về cố vấn', String(s.summary.returnedToAdvisor)],
    ['Khoa đã duyệt (có trong bảng kết quả)', String(s.summary.approved)],
    ['Tổng điểm đã duyệt', String(s.summary.approvedTotalPoints)],
    ['Điểm trung bình đã duyệt', average(s.summary.approvedAveragePoints)],
  ]
  const statWidth = 6000
  parts.push(
    table(
      [statWidth, 2500],
      stats.map(([label, value]) => [
        { content: label, width: statWidth },
        { content: value, width: 2500, align: 'right' },
      ]),
      { keepTogether: true },
    ),
    text(
      'Bản chưa được khoa duyệt chỉ được đếm trong thống kê; không lấy điểm tự kê khai thay điểm duyệt và không ghi thành 0.',
      { italic: true },
      { style: 'Note' },
    ),
    heading('III. Tiêu chí áp dụng (giả định)'),
    table(
      [1200, usable - 1200 - 1800 - 2200, 1800, 2200],
      [
        ['Nhóm', 'Tiêu chí', 'Điểm tối đa', 'Minh chứng bắt buộc'],
        ...s.period.criteria.map((c) => [
          c.code,
          c.label,
          String(c.maxPoints),
          c.evidenceRequired ? 'Có' : 'Không',
        ]),
      ].map((cells) => {
        const widths = [1200, usable - 1200 - 1800 - 2200, 1800, 2200]
        return cells.map((content, i) => ({
          content,
          width: widths[i]!,
          align: i === 1 ? ('left' as const) : ('center' as const),
        }))
      }),
      { header: true, keepTogether: true },
    ),
    heading('IV. Kết quả đã được khoa duyệt'),
  )
  const widths = [600, 1500, 2538, 900, 700, 700, 700, 700, 700, 900, 2600, 2600]
  const headers = [
    'STT',
    'Mã sinh viên',
    'Họ và tên (lúc nộp)',
    'Điểm tự khai',
    ...groups.map((g) => `${g} duyệt`),
    'Tổng duyệt',
    'Cố vấn xác nhận',
    'Khoa duyệt',
  ]
  const resultRows: Cell[][] = [
    headers.map((content, i) => ({ content, width: widths[i]!, align: 'center' })),
  ]
  if (!s.rows.length)
    resultRows.push([
      {
        content: 'Chưa có bản kê khai nào được khoa duyệt trong snapshot này.',
        width: usable,
        span: widths.length,
        align: 'center',
      },
    ])
  s.rows.forEach((row, index) => {
    const values: string[][] = [
      [String(index + 1)],
      [row.student.studentCode],
      [row.student.fullName, `Lớp lúc nộp: ${row.student.classCode}`],
      [String(row.selfPoints)],
      ...groups.map((g) => [String(row.approvedAnswers[g]!.points)]),
      [String(row.approvedPoints)],
      [row.advisor.actor.fullName, vietnamTime(row.advisor.confirmedAt)],
      [row.faculty.actor.fullName, vietnamTime(row.faculty.confirmedAt)],
    ]
    resultRows.push(
      values.map((content, i) => ({
        content,
        width: widths[i]!,
        align: i === 2 || i >= 10 ? 'left' : i === 1 ? 'left' : 'center',
        bold: i === 9,
      })),
    )
  })
  parts.push(
    table(widths, resultRows, { header: true }),
    heading('V. Người đã xác nhận trong hệ thống'),
  )
  const people = confirmers(s)
  if (!people.length)
    parts.push(
      text('Không có xác nhận nào trong phạm vi bảng kết quả.', undefined, { style: 'Note' }),
    )
  else {
    const pw = [3000, 4600, 3400, 2200, usable - 13200]
    parts.push(
      table(
        pw,
        [
          ['Bước', 'Họ và tên', 'Tài khoản', 'Vai trò', 'Số bản'],
          ...people.map((p) => [
            p.stage,
            p.actor.fullName,
            p.actor.username,
            roleLabel[p.actor.roleCode] ?? p.actor.roleCode,
            String(p.count),
          ]),
        ].map((cells) =>
          cells.map((content, i) => ({
            content,
            width: pw[i]!,
            align: i === 4 ? ('center' as const) : ('left' as const),
          })),
        ),
        { header: true },
      ),
    )
  }
  parts.push(heading('VI. Ghi chú nguồn dữ liệu'))
  for (const note of [
    `Dữ liệu lấy từ snapshot ${s.snapshotId}, chốt lúc ${vietnamTime(s.capturedAt)}; tệp Excel/Word/PDF chỉ cùng nội dung khi mang cùng mã snapshot.`,
    'Bảng kết quả chỉ gồm bản có quyết định cuối là khoa duyệt; điểm duyệt lấy từ quyết định khoa cuối cùng, điểm tự kê khai được giữ riêng.',
    'Tên sinh viên, lớp lúc nộp và người xác nhận là dữ liệu tại thời điểm thao tác, có thể khác thông tin hiện tại của lớp/khoa.',
    'Chưa gán xếp loại chính thức. Bộ tiêu chí A–E là giả định, chưa phải quy chế chính thức của Học viện.',
    'Xác nhận trong hệ thống là thao tác của tài khoản nghiệp vụ; chưa có chữ ký số được xác minh và văn bản không có giá trị pháp lý tự thân.',
  ])
    parts.push(text('• ' + note, undefined, { style: 'Note' }))
  parts.push(
    heading('VII. Xác nhận trên giấy'),
    text(
      'Vị trí ký để trống. Hệ thống không chèn chữ ký, con dấu hoặc họ tên người ký.',
      { italic: true },
      { style: 'Note', keepNext: true },
    ),
  )
  const half = usable / 2
  parts.push(
    table(
      [half, half],
      [
        [
          { content: 'CỐ VẤN HỌC TẬP', width: half, align: 'center', bold: true },
          { content: 'ĐẠI DIỆN KHOA', width: half, align: 'center', bold: true },
        ],
        [
          { content: '(Ký, ghi rõ họ tên)', width: half, align: 'center' },
          { content: '(Ký, ghi rõ họ tên)', width: half, align: 'center' },
        ],
        [
          { content: '', width: half },
          { content: '', width: half },
        ],
      ],
      // About 3 cm of blank space for a handwritten signature; nothing is pre-filled.
      { borders: false, keepTogether: true, heights: { 2: 1700 } },
    ),
  )
  return parts.join('')
}

const styles =
  declaration +
  `<w:styles xmlns:w="${w}">` +
  '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="vi-VN" w:eastAsia="vi-VN" w:bidi="ar-SA"/></w:rPr></w:rPrDefault>' +
  '<w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="center"/><w:spacing w:before="120" w:after="60"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="100"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Notice"><w:name w:val="Notice"/><w:basedOn w:val="Normal"/><w:pPr><w:pBdr><w:top w:val="single" w:sz="8" w:space="4" w:color="B42318"/><w:left w:val="single" w:sz="8" w:space="4" w:color="B42318"/><w:bottom w:val="single" w:sz="8" w:space="4" w:color="B42318"/><w:right w:val="single" w:sz="8" w:space="4" w:color="B42318"/></w:pBdr><w:spacing w:after="160"/></w:pPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Note"><w:name w:val="Note"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="60" w:after="40"/></w:pPr><w:rPr><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="TableText"><w:name w:val="Table Text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0"/></w:pPr><w:rPr><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>' +
  '</w:styles>'

function field(instruction: string, placeholder: string) {
  return `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${instruction} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>${placeholder}</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`
}
const part = (root: string, content: string) =>
  declaration + `<w:${root} xmlns:w="${w}" xmlns:r="${r}">${content}</w:${root}>`

/** Builds a deterministic DOCX: the same snapshot always yields the same bytes. */
export function createTrainingMinutesDocx(s: TrainingExportSnapshot): Buffer {
  assertTrainingExportSnapshot(s)
  const header = paragraph(
    run('DỮ LIỆU THỬ NGHIỆM — CHƯA PHẢI BIỂU MẪU CHÍNH THỨC', {
      bold: true,
      color: 'B42318',
      size: 18,
    }),
    { style: 'Footer', align: 'right' },
  )
  const footer = paragraph(
    run(`Snapshot ${s.snapshotId} · ${trainingMinutesTemplate.label} · Trang `) +
      field('PAGE', '1') +
      run(' / ') +
      field('NUMPAGES', '1'),
    { style: 'Footer', align: 'center' },
  )
  const section =
    '<w:sectPr><w:headerReference w:type="default" r:id="rId3"/><w:footerReference w:type="default" r:id="rId4"/>' +
    `<w:pgSz w:w="${pageWidth}" w:h="${pageHeight}" w:orient="landscape"/>` +
    `<w:pgMar w:top="1000" w:right="${side}" w:bottom="1000" w:left="${side}" w:header="500" w:footer="500" w:gutter="0"/></w:sectPr>`
  const files: Record<string, string> = {
    '[Content_Types].xml':
      declaration +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
      '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
      '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
      '</Types>',
    '_rels/.rels':
      declaration +
      `<Relationships xmlns="${relNs}"><Relationship Id="rId1" Type="${r}/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/_rels/document.xml.rels':
      declaration +
      `<Relationships xmlns="${relNs}">` +
      `<Relationship Id="rId1" Type="${r}/styles" Target="styles.xml"/>` +
      `<Relationship Id="rId2" Type="${r}/settings" Target="settings.xml"/>` +
      `<Relationship Id="rId3" Type="${r}/header" Target="header1.xml"/>` +
      `<Relationship Id="rId4" Type="${r}/footer" Target="footer1.xml"/>` +
      '</Relationships>',
    'word/styles.xml': styles,
    'word/settings.xml': part(
      'settings',
      '<w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>',
    ),
    'word/header1.xml': part('hdr', header),
    'word/footer1.xml': part('ftr', footer),
    'word/document.xml': part('document', `<w:body>${body(s)}${section}</w:body>`),
  }
  return Buffer.from(
    zipSync(
      Object.fromEntries(Object.entries(files).map(([key, value]) => [key, strToU8(value)])),
      { level: 6, mtime: new Date('1980-01-01T00:00:00Z') },
    ),
  )
}
