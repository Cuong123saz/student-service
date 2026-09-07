import {
  readSheet,
  type CellValue,
} from 'read-excel-file/node'

export const STUDENT_IMPORT_MAX_FILE_BYTES =
  5 * 1024 * 1024

export const STUDENT_IMPORT_MAX_ROWS = 1_000

export type StudentImportFormat =
  | 'CSV'
  | 'XLSX'

export type StudentImportColumn =
  | 'studentCode'
  | 'fullName'
  | 'email'
  | 'classCode'

export interface StudentImportSourceRow {
  sourceRow: number
  values: Record<
    StudentImportColumn,
    CellValue | null
  >
}

export interface ParsedStudentImportFile {
  format: StudentImportFormat
  rows: StudentImportSourceRow[]
}

export class UnsupportedStudentImportFileError
extends Error {
  constructor() {
    super('Only .xlsx and .csv files are supported')
    this.name = 'UnsupportedStudentImportFileError'
  }
}

export class StudentImportFileParseError
extends Error {
  constructor(message = 'Unable to parse import file') {
    super(message)
    this.name = 'StudentImportFileParseError'
  }
}

export class StudentImportMissingColumnsError
extends Error {
  constructor(
    readonly columns:
      readonly StudentImportColumn[],
  ) {
    super(
      `Missing required columns: ${columns.join(', ')}`,
    )
    this.name = 'StudentImportMissingColumnsError'
  }
}

export class StudentImportRowLimitError
extends Error {
  constructor(readonly maximumRows: number) {
    super(
      `Import file exceeds ${maximumRows} data rows`,
    )
    this.name = 'StudentImportRowLimitError'
  }
}

const REQUIRED_COLUMNS:
  readonly StudentImportColumn[] = [
    'studentCode',
    'fullName',
    'email',
    'classCode',
  ]

const HEADER_ALIASES:
  Record<string, StudentImportColumn> = {
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

function isEmptyRow(
  row: readonly (CellValue | null)[],
): boolean {
  return row.every(
    (value) =>
      value === null
      || String(value).trim() === '',
  )
}

function mapRows(
  tabularRows:
    readonly (readonly (CellValue | null)[])[],
  sourceRows?: readonly number[],
): StudentImportSourceRow[] {
  const header = tabularRows[0]

  if (!header) {
    throw new StudentImportFileParseError(
      'Import file is empty',
    )
  }

  const columnIndexes = new Map<
    StudentImportColumn,
    number
  >()

  header.forEach((value, index) => {
    const column =
      HEADER_ALIASES[normalizeHeader(value)]

    if (
      column
      && !columnIndexes.has(column)
    ) {
      columnIndexes.set(column, index)
    }
  })

  const missingColumns = REQUIRED_COLUMNS
    .filter(
      (column) =>
        !columnIndexes.has(column),
    )

  if (missingColumns.length > 0) {
    throw new StudentImportMissingColumnsError(
      missingColumns,
    )
  }

  const dataRows = tabularRows
    .slice(1)
    .map((row, index) => ({
      row,
      sourceRow:
        sourceRows?.[index + 1]
        ?? index + 2,
    }))
    .filter(({ row }) => !isEmptyRow(row))

  if (dataRows.length > STUDENT_IMPORT_MAX_ROWS) {
    throw new StudentImportRowLimitError(
      STUDENT_IMPORT_MAX_ROWS,
    )
  }

  return dataRows.map(
    ({ row, sourceRow }) => ({
      sourceRow,
      values: {
        studentCode:
          row[
            columnIndexes.get('studentCode')!
          ] ?? null,
        fullName:
          row[
            columnIndexes.get('fullName')!
          ] ?? null,
        email:
          row[
            columnIndexes.get('email')!
          ] ?? null,
        classCode:
          row[
            columnIndexes.get('classCode')!
          ] ?? null,
      },
    }),
  )
}

interface CsvRow {
  sourceRow: number
  cells: string[]
}

function countDelimiter(
  line: string,
  delimiter: ',' | ';',
): number {
  let count = 0
  let quoted = false

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]

    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (!quoted && character === delimiter) {
      count += 1
    }
  }

  return count
}

function parseCsv(text: string): CsvRow[] {
  const firstLine = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/, 1)[0] ?? ''
  const delimiter: ',' | ';' =
    countDelimiter(firstLine, ';')
      > countDelimiter(firstLine, ',')
      ? ';'
      : ','

  const rows: CsvRow[] = []
  let cells: string[] = []
  let cell = ''
  let quoted = false
  let rowStart = 1
  let physicalLine = 1
  const normalized = text.replace(/^\uFEFF/, '')

  const finishRow = () => {
    cells.push(cell)
    rows.push({
      sourceRow: rowStart,
      cells,
    })
    cells = []
    cell = ''
  }

  for (
    let index = 0;
    index < normalized.length;
    index += 1
  ) {
    const character = normalized[index]

    if (character === '"') {
      if (quoted && normalized[index + 1] === '"') {
        cell += '"'
        index += 1
      } else if (quoted || cell.length === 0) {
        quoted = !quoted
      } else {
        throw new StudentImportFileParseError(
          `Invalid quote at line ${physicalLine}`,
        )
      }
      continue
    }

    if (!quoted && character === delimiter) {
      cells.push(cell)
      cell = ''
      continue
    }

    if (character === '\r' || character === '\n') {
      const isCrLf =
        character === '\r'
        && normalized[index + 1] === '\n'

      if (quoted) {
        cell += '\n'
      } else {
        finishRow()
        rowStart = physicalLine + 1
      }

      if (isCrLf) {
        index += 1
      }
      physicalLine += 1
      continue
    }

    cell += character
  }

  if (quoted) {
    throw new StudentImportFileParseError(
      'CSV contains an unterminated quoted value',
    )
  }

  if (
    cell.length > 0
    || cells.length > 0
  ) {
    finishRow()
  }

  return rows
}

function getExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.')
  return lastDot < 0
    ? ''
    : filename.slice(lastDot).toLowerCase()
}

export async function parseStudentImportFile(
  filename: string,
  buffer: Buffer,
): Promise<ParsedStudentImportFile> {
  const extension = getExtension(filename)

  if (extension === '.csv') {
    let text: string

    try {
      text = new TextDecoder(
        'utf-8',
        { fatal: true },
      ).decode(buffer)
    } catch {
      throw new StudentImportFileParseError(
        'CSV must use UTF-8 encoding',
      )
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
      const sheet = await readSheet(buffer)
      return {
        format: 'XLSX',
        rows: mapRows(sheet),
      }
    } catch (error) {
      if (
        error instanceof StudentImportMissingColumnsError
        || error instanceof StudentImportRowLimitError
        || error instanceof StudentImportFileParseError
      ) {
        throw error
      }

      throw new StudentImportFileParseError()
    }
  }

  throw new UnsupportedStudentImportFileError()
}
