import { readSheet, type CellValue } from 'read-excel-file/node'
import { parse as parseCsvRecords } from 'csv-parse/sync'

export const STUDENT_IMPORT_MAX_FILE_BYTES = 5 * 1024 * 1024

export const STUDENT_IMPORT_MAX_ROWS = 1_000
export const STUDENT_IMPORT_MAX_ARCHIVE_ENTRIES = 256
export const STUDENT_IMPORT_MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024
export const STUDENT_IMPORT_MAX_ARCHIVE_RATIO = 100

export type StudentImportFormat = 'CSV' | 'XLSX'

export type StudentImportColumn = 'studentCode' | 'fullName' | 'email' | 'classCode'

// read-excel-file returns Date instances at runtime, but
// its published CellValue type currently declares typeof Date.
export type StudentImportSourceCellValue = CellValue | Date

export interface StudentImportSourceRow {
  sourceRow: number
  values: Record<StudentImportColumn, StudentImportSourceCellValue | null>
}

export interface ParsedStudentImportFile {
  format: StudentImportFormat
  rows: StudentImportSourceRow[]
}

export class UnsupportedStudentImportFileError extends Error {
  constructor() {
    super('Only .xlsx and .csv files are supported')
    this.name = 'UnsupportedStudentImportFileError'
  }
}

export class StudentImportFileParseError extends Error {
  constructor(message = 'Unable to parse import file') {
    super(message)
    this.name = 'StudentImportFileParseError'
  }
}

export class StudentImportMissingColumnsError extends Error {
  constructor(readonly columns: readonly StudentImportColumn[]) {
    super(`Missing required columns: ${columns.join(', ')}`)
    this.name = 'StudentImportMissingColumnsError'
  }
}

export class StudentImportRowLimitError extends Error {
  constructor(readonly maximumRows: number) {
    super(`Import file exceeds ${maximumRows} data rows`)
    this.name = 'StudentImportRowLimitError'
  }
}

export class StudentImportArchiveLimitError extends StudentImportFileParseError {
  constructor(message: string) {
    super(message)
    this.name = 'StudentImportArchiveLimitError'
  }
}

const REQUIRED_COLUMNS: readonly StudentImportColumn[] = [
  'studentCode',
  'fullName',
  'email',
  'classCode',
]

const HEADER_ALIASES: Record<string, StudentImportColumn> = {
  studentcode: 'studentCode',
  masinhvien: 'studentCode',
  masv: 'studentCode',
  fullname: 'fullName',
  hovaten: 'fullName',
  hoten: 'fullName',
  email: 'email',
  classcode: 'classCode',
  malop: 'classCode',
  lop: 'classCode',
}

function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

function isEmptyRow(row: readonly (StudentImportSourceCellValue | null)[]): boolean {
  return row.every((value) => value === null || String(value).trim() === '')
}

function mapRows(
  tabularRows: readonly (readonly (StudentImportSourceCellValue | null)[])[],
  sourceRows?: readonly number[],
): StudentImportSourceRow[] {
  const header = tabularRows[0]

  if (!header) {
    throw new StudentImportFileParseError('Import file is empty')
  }

  const columnIndexes = new Map<StudentImportColumn, number>()

  header.forEach((value, index) => {
    const column = HEADER_ALIASES[normalizeHeader(value)]

    if (column && !columnIndexes.has(column)) {
      columnIndexes.set(column, index)
    }
  })

  const missingColumns = REQUIRED_COLUMNS.filter((column) => !columnIndexes.has(column))

  if (missingColumns.length > 0) {
    throw new StudentImportMissingColumnsError(missingColumns)
  }

  const dataRows = tabularRows
    .slice(1)
    .map((row, index) => ({
      row,
      sourceRow: sourceRows?.[index + 1] ?? index + 2,
    }))
    .filter(({ row }) => !isEmptyRow(row))

  if (dataRows.length > STUDENT_IMPORT_MAX_ROWS) {
    throw new StudentImportRowLimitError(STUDENT_IMPORT_MAX_ROWS)
  }

  return dataRows.map(({ row, sourceRow }) => ({
    sourceRow,
    values: {
      studentCode: row[columnIndexes.get('studentCode')!] ?? null,
      fullName: row[columnIndexes.get('fullName')!] ?? null,
      email: row[columnIndexes.get('email')!] ?? null,
      classCode: row[columnIndexes.get('classCode')!] ?? null,
    },
  }))
}

interface CsvRow {
  sourceRow: number
  cells: string[]
}

function parseCsv(text: string): CsvRow[] {
  type ParsedRecord = {
    record: string[]
    info: { lines: number }
  }

  const parseWith = (delimiter: ',' | ';') => {
    const parsed = parseCsvRecords(text, {
      bom: true,
      delimiter,
      info: true,
      relax_column_count: true,
      skip_empty_lines: false,
    }) as unknown as ParsedRecord[]
    let previousEndLine = 0
    return parsed.map(({ record, info }) => {
      const row = {
        sourceRow: previousEndLine + 1,
        cells: record,
      }
      previousEndLine = info.lines
      return row
    })
  }

  const hasRequiredHeader = (rows: CsvRow[]) => {
    const header = rows[0]?.cells ?? []
    const columns = new Set(header.map((value) => HEADER_ALIASES[normalizeHeader(value)]))
    return REQUIRED_COLUMNS.every((column) => columns.has(column))
  }

  const candidates: CsvRow[][] = []
  for (const delimiter of [',', ';'] as const) {
    try {
      const rows = parseWith(delimiter)
      if (hasRequiredHeader(rows)) {
        return rows
      }
      candidates.push(rows)
    } catch {
      // The other supported delimiter may still parse the
      // file correctly, so defer the error until both fail.
    }
  }

  if (candidates[0]) return candidates[0]
  throw new StudentImportFileParseError('CSV contains invalid quoting or delimiters')
}

function findZipEndOfCentralDirectory(buffer: Buffer): number {
  const minimumOffset = Math.max(0, buffer.length - 65_557)
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      return offset
    }
  }
  return -1
}

export function preflightStudentImportXlsx(buffer: Buffer): void {
  if (buffer.length < 22) {
    throw new StudentImportFileParseError()
  }

  const endOffset = findZipEndOfCentralDirectory(buffer)
  if (endOffset < 0) {
    throw new StudentImportFileParseError()
  }

  const diskNumber = buffer.readUInt16LE(endOffset + 4)
  const centralDisk = buffer.readUInt16LE(endOffset + 6)
  const entriesOnDisk = buffer.readUInt16LE(endOffset + 8)
  const entryCount = buffer.readUInt16LE(endOffset + 10)
  const centralSize = buffer.readUInt32LE(endOffset + 12)
  const centralOffset = buffer.readUInt32LE(endOffset + 16)
  const commentLength = buffer.readUInt16LE(endOffset + 20)

  if (
    diskNumber !== 0 ||
    centralDisk !== 0 ||
    entriesOnDisk !== entryCount ||
    entryCount === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff ||
    endOffset + 22 + commentLength !== buffer.length
  ) {
    throw new StudentImportArchiveLimitError('XLSX must be a single-disk non-ZIP64 archive')
  }

  if (entryCount > STUDENT_IMPORT_MAX_ARCHIVE_ENTRIES) {
    throw new StudentImportArchiveLimitError('XLSX contains too many archive entries')
  }

  const centralEnd = centralOffset + centralSize
  if (centralOffset > endOffset || centralEnd > endOffset) {
    throw new StudentImportFileParseError()
  }

  let offset = centralOffset
  let totalUncompressedBytes = 0

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > centralEnd || buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new StudentImportFileParseError()
    }

    const flags = buffer.readUInt16LE(offset + 8)
    const compressedBytes = buffer.readUInt32LE(offset + 20)
    const uncompressedBytes = buffer.readUInt32LE(offset + 24)
    const fileNameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const entryCommentLength = buffer.readUInt16LE(offset + 32)

    if ((flags & 0x1) !== 0) {
      throw new StudentImportArchiveLimitError('Encrypted XLSX archives are not supported')
    }
    if (compressedBytes === 0xffffffff || uncompressedBytes === 0xffffffff) {
      throw new StudentImportArchiveLimitError('ZIP64 XLSX entries are not supported')
    }

    totalUncompressedBytes += uncompressedBytes
    if (totalUncompressedBytes > STUDENT_IMPORT_MAX_UNCOMPRESSED_BYTES) {
      throw new StudentImportArchiveLimitError('XLSX expands beyond the allowed size')
    }

    const ratio = uncompressedBytes / Math.max(1, compressedBytes)
    if (ratio > STUDENT_IMPORT_MAX_ARCHIVE_RATIO) {
      throw new StudentImportArchiveLimitError('XLSX compression ratio exceeds the allowed limit')
    }

    offset += 46 + fileNameLength + extraLength + entryCommentLength
    if (offset > centralEnd) {
      throw new StudentImportFileParseError()
    }
  }

  if (offset !== centralEnd) {
    throw new StudentImportFileParseError()
  }
}

function getExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.')
  return lastDot < 0 ? '' : filename.slice(lastDot).toLowerCase()
}

export async function parseStudentImportFile(
  filename: string,
  buffer: Buffer,
): Promise<ParsedStudentImportFile> {
  const extension = getExtension(filename)

  if (extension === '.csv') {
    let text: string

    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    } catch {
      throw new StudentImportFileParseError('CSV must use UTF-8 encoding')
    }

    const csvRows = parseCsv(text)

    return {
      format: 'CSV',
      rows: mapRows(
        csvRows.map((row) => row.cells),
        csvRows.map((row) => row.sourceRow),
      ),
    }
  }

  if (extension === '.xlsx') {
    try {
      preflightStudentImportXlsx(buffer)
      const sheet = await readSheet(buffer)
      return {
        format: 'XLSX',
        rows: mapRows(sheet),
      }
    } catch (error) {
      if (
        error instanceof StudentImportMissingColumnsError ||
        error instanceof StudentImportRowLimitError ||
        error instanceof StudentImportFileParseError
      ) {
        throw error
      }

      throw new StudentImportFileParseError()
    }
  }

  throw new UnsupportedStudentImportFileError()
}
