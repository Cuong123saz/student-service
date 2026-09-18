import { strToU8, zipSync } from 'fflate'

import type { StudentExportRecord } from './student-export.service.js'

const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export { XLSX_CONTENT_TYPE }

const exportHeaders = [
  'STT',
  'Mã sinh viên',
  'Họ và tên',
  'Email',
  'Tên đăng nhập',
  'Trạng thái',
  'Mã lớp',
  'Tên lớp',
  'Mã khoa',
  'Tên khoa',
] as const

function columnName(index: number): string {
  let value = index + 1
  let result = ''

  while (value > 0) {
    const remainder = (value - 1) % 26
    result = String.fromCharCode(65 + remainder) + result
    value = Math.floor((value - 1) / 26)
  }

  return result
}

function escapeXml(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function textCell(value: string | number, row: number, column: number, style: number): string {
  const reference = `${columnName(column)}${row}`
  const content = escapeXml(String(value))

  return `<c r="${reference}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${content}</t></is></c>`
}

function worksheetXml(
  headers: readonly string[],
  rows: readonly (readonly (string | number)[])[],
  columnsXml: string,
): string {
  const headerCells = headers.map((header, index) => textCell(header, 1, index, 1)).join('')

  const dataRows = rows
    .map((values, recordIndex) => {
      const rowNumber = recordIndex + 2
      const cells = values
        .map((value, columnIndex) => textCell(value, rowNumber, columnIndex, 2))
        .join('')

      return `<row r="${rowNumber}">${cells}</row>`
    })
    .join('')

  const lastRow = rows.length + 1
  const lastColumn = columnName(headers.length - 1)

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <cols>${columnsXml}</cols>
  <sheetData><row r="1">${headerCells}</row>${dataRows}</sheetData>
  <autoFilter ref="A1:${lastColumn}${lastRow}"/>
</worksheet>`
}

const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`

const rootRelationshipsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`

function workbookXml(sheetName: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`
}

const workbookRelationshipsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`

const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF243B7A"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="3">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`

function createWorkbook(input: {
  sheetName: string
  headers: readonly string[]
  rows: readonly (readonly (string | number)[])[]
  columnsXml: string
}): Buffer {
  const archive = zipSync(
    {
      '[Content_Types].xml': strToU8(contentTypesXml),
      '_rels/.rels': strToU8(rootRelationshipsXml),
      'xl/workbook.xml': strToU8(workbookXml(input.sheetName)),
      'xl/_rels/workbook.xml.rels': strToU8(workbookRelationshipsXml),
      'xl/styles.xml': strToU8(stylesXml),
      'xl/worksheets/sheet1.xml': strToU8(
        worksheetXml(input.headers, input.rows, input.columnsXml),
      ),
    },
    {
      level: 6,
    },
  )

  return Buffer.from(archive)
}

export function createStudentExportWorkbook(records: readonly StudentExportRecord[]): Buffer {
  return createWorkbook({
    sheetName: 'Danh sách sinh viên',
    headers: exportHeaders,
    rows: records.map((record, index) => [
      index + 1,
      record.studentCode,
      record.fullName,
      record.email ?? '',
      record.username,
      record.status,
      record.classCode,
      record.className,
      record.facultyCode,
      record.facultyName,
    ]),
    columnsXml: `
    <col min="1" max="1" width="8" customWidth="1"/>
    <col min="2" max="2" width="18" customWidth="1"/>
    <col min="3" max="3" width="30" customWidth="1"/>
    <col min="4" max="5" width="32" customWidth="1"/>
    <col min="6" max="7" width="16" customWidth="1"/>
    <col min="8" max="10" width="28" customWidth="1"/>`,
  })
}

export function createStudentImportTemplateWorkbook(): Buffer {
  return createWorkbook({
    sheetName: 'Mẫu import sinh viên',
    headers: ['Mã sinh viên', 'Họ và tên', 'Email', 'Mã lớp'],
    rows: [
      ['00123456', 'Nguyễn Văn A', '00123456@example.edu.vn', 'K15A'],
      ['00123457', 'Trần Thị B', '00123457@example.edu.vn', 'K15A'],
    ],
    columnsXml: `
    <col min="1" max="1" width="18" customWidth="1"/>
    <col min="2" max="2" width="30" customWidth="1"/>
    <col min="3" max="3" width="34" customWidth="1"/>
    <col min="4" max="4" width="18" customWidth="1"/>`,
  })
}
