import { randomUUID } from 'node:crypto'

import {
  parseStudentImportFile,
  type ParsedStudentImportFile,
  type StudentImportColumn,
  type StudentImportFormat,
  type StudentImportSourceCellValue,
  type StudentImportSourceRow,
} from './student-import.parser.js'

export const STUDENT_IMPORT_PREVIEW_TTL_MS =
  15 * 60 * 1_000

export type StudentImportDuplicateStrategy =
  | 'SKIP'
  | 'OVERWRITE'
  | 'FAIL'

export interface StudentImportRecord {
  sourceRow: number
  studentCode: string
  username: string
  fullName: string
  email: string
  classCode: string
}

export interface StudentImportRowIssue {
  field: StudentImportColumn
  code: string
  message: string
}

export type StudentImportCellKind =
  | 'EMPTY'
  | 'TEXT'
  | 'NUMBER'
  | 'BOOLEAN'
  | 'DATE'

export interface StudentImportErrorCell {
  kind: StudentImportCellKind
  text: string | null
}

export type StudentImportErrorValues =
  Record<
    StudentImportColumn,
    StudentImportErrorCell
  >

export interface StudentImportErrorRecord {
  sourceRow: number
  values: StudentImportErrorValues
  issues: StudentImportRowIssue[]
}

export interface StudentImportDuplicateReason {
  source: 'FILE' | 'SYSTEM'
  field: 'studentCode' | 'email'
  matchedSourceRow?: number
  code: string
  message: string
}

export interface StudentImportDuplicateRecord {
  record: StudentImportRecord
  duplicates: StudentImportDuplicateReason[]
}

export interface StudentImportPreviewResult {
  previewId: string
  expiresAt: string
  file: {
    name: string
    format: StudentImportFormat
  }
  summary: {
    total: number
    valid: number
    errors: number
    duplicates: number
  }
  validRecords: StudentImportRecord[]
  errorRecords: StudentImportErrorRecord[]
  duplicateRecords:
    StudentImportDuplicateRecord[]
}

export interface StudentImportCommitResult {
  imported: number
  updated: number
  skipped: number
}

export interface StudentImportAuditContext {
  requestId: string | null
  ipAddress: string | null
  userAgent: string | null
}

export interface ImportableAcademicClass {
  id: string
  code: string
}

export interface ExistingStudentImportIdentity {
  username: string
  email: string | null
  studentCode: string | null
}

export interface InspectStudentImportInput {
  actorUserId: string
  classCodes: readonly string[]
  usernames: readonly string[]
  emails: readonly string[]
  studentCodes: readonly string[]
}

export interface InspectStudentImportResult {
  classes: ImportableAcademicClass[]
  existing: ExistingStudentImportIdentity[]
}

export interface PersistStudentImportRow
extends StudentImportRecord {
  classId: string
}

export interface CommitStudentImportInput {
  actorUserId: string
  actorUsername: string
  previewId: string
  fileName: string
  duplicateStrategy:
    StudentImportDuplicateStrategy
  rows: readonly PersistStudentImportRow[]
  previewTotalRows: number
  preSkipped: number
  occurredAt: Date
  audit: StudentImportAuditContext
}

export interface StudentImportRepository {
  inspect(
    input: InspectStudentImportInput,
  ): Promise<InspectStudentImportResult>

  commit(
    input: CommitStudentImportInput,
  ): Promise<StudentImportCommitResult>
}

interface StoredStudentImportRow
extends PersistStudentImportRow {
  duplicates: StudentImportDuplicateReason[]
}

interface StoredStudentImportPreview {
  id: string
  actorUserId: string
  fileName: string
  expiresAt: Date
  rows: StoredStudentImportRow[]
  totalRows: number
  hasValidationErrors: boolean
}

interface AcquiredStudentImportPreview {
  preview: StoredStudentImportPreview
  release(): void
  complete(): void
}

export interface StudentImportPreviewStore {
  create(
    input: Omit<
      StoredStudentImportPreview,
      'id' | 'expiresAt'
    >,
    now: Date,
  ): StoredStudentImportPreview

  acquire(
    previewId: string,
    actorUserId: string,
    now: Date,
  ): AcquiredStudentImportPreview | undefined
}

interface PreviewEntry {
  preview: StoredStudentImportPreview
  processing: boolean
}

export class InMemoryStudentImportPreviewStore
implements StudentImportPreviewStore {
  private readonly entries =
    new Map<string, PreviewEntry>()

  constructor(
    private readonly ttlMs =
      STUDENT_IMPORT_PREVIEW_TTL_MS,
    private readonly maximumEntries = 100,
  ) {}

  create(
    input: Omit<
      StoredStudentImportPreview,
      'id' | 'expiresAt'
    >,
    now: Date,
  ): StoredStudentImportPreview {
    this.removeExpired(now)

    while (
      this.entries.size
      >= this.maximumEntries
    ) {
      const oldestId =
        this.entries.keys().next()
          .value as string | undefined

      if (!oldestId) {
        break
      }
      this.entries.delete(oldestId)
    }

    const preview: StoredStudentImportPreview = {
      ...input,
      id: randomUUID(),
      expiresAt: new Date(
        now.getTime() + this.ttlMs,
      ),
    }

    this.entries.set(preview.id, {
      preview,
      processing: false,
    })

    return preview
  }

  acquire(
    previewId: string,
    actorUserId: string,
    now: Date,
  ): AcquiredStudentImportPreview | undefined {
    this.removeExpired(now)
    const entry = this.entries.get(previewId)

    if (
      !entry
      || entry.processing
      || entry.preview.actorUserId
        !== actorUserId
    ) {
      return undefined
    }

    entry.processing = true
    let settled = false

    return {
      preview: entry.preview,
      release: () => {
        if (!settled) {
          entry.processing = false
          settled = true
        }
      },
      complete: () => {
        if (!settled) {
          this.entries.delete(previewId)
          settled = true
        }
      },
    }
  }

  private removeExpired(now: Date): void {
    for (const [id, entry] of this.entries) {
      if (entry.preview.expiresAt <= now) {
        this.entries.delete(id)
      }
    }
  }
}

export class StudentImportPreviewNotFoundError
extends Error {
  constructor() {
    super('Import preview not found, expired or already in use')
    this.name = 'StudentImportPreviewNotFoundError'
  }
}

export class StudentImportValidationBlockedError
extends Error {
  constructor() {
    super('Import preview contains validation errors')
    this.name = 'StudentImportValidationBlockedError'
  }
}

export class StudentImportDuplicateBlockedError
extends Error {
  constructor() {
    super('Duplicate records prevent this import')
    this.name = 'StudentImportDuplicateBlockedError'
  }
}

export class StudentImportAmbiguousDuplicateError
extends Error {
  constructor() {
    super('Duplicate rows cannot be merged safely')
    this.name = 'StudentImportAmbiguousDuplicateError'
  }
}

type StudentImportParser = (
  filename: string,
  buffer: Buffer,
) => Promise<ParsedStudentImportFile>

type Clock = () => Date

function requiredString(
  row: StudentImportSourceRow,
  field: StudentImportColumn,
  issues: StudentImportRowIssue[],
): string | undefined {
  const value:
    StudentImportSourceCellValue | null =
    row.values[field]

  if (
    value === null
    || (
      typeof value === 'string'
      && value.trim() === ''
    )
  ) {
    issues.push({
      field,
      code: 'REQUIRED',
      message: `${field} is required`,
    })
    return undefined
  }

  if (typeof value !== 'string') {
    issues.push({
      field,
      code: 'INVALID_TYPE',
      message: `${field} must be text`,
    })
    return undefined
  }

  return value.trim()
}
function createErrorCell(
  value: StudentImportSourceCellValue | null,
): StudentImportErrorCell {
  if (value === null) {
    return {
      kind: 'EMPTY',
      text: null,
    }
  }

  if (typeof value === 'string') {
    return {
      kind: 'TEXT',
      text: value,
    }
  }

  if (typeof value === 'number') {
    return {
      kind: 'NUMBER',
      text: null,
    }
  }

  if (typeof value === 'boolean') {
    return {
      kind: 'BOOLEAN',
      text: null,
    }
  }

  return {
    kind: 'DATE',
    text: null,
  }
}

function createErrorValues(
  row: StudentImportSourceRow,
): StudentImportErrorValues {
  return {
    studentCode:
      createErrorCell(row.values.studentCode),
    fullName:
      createErrorCell(row.values.fullName),
    email:
      createErrorCell(row.values.email),
    classCode:
      createErrorCell(row.values.classCode),
  }
}

function validateRow(
  row: StudentImportSourceRow,
): {
  record?: StudentImportRecord
  error?: StudentImportErrorRecord
} {
  const issues: StudentImportRowIssue[] = []
  const studentCode = requiredString(
    row,
    'studentCode',
    issues,
  )?.toUpperCase()
  const fullName = requiredString(
    row,
    'fullName',
    issues,
  )
  const email = requiredString(
    row,
    'email',
    issues,
  )?.toLowerCase()
  const classCode = requiredString(
    row,
    'classCode',
    issues,
  )?.toUpperCase()

  if (
    studentCode
    && (
      studentCode.length > 50
      || !/^[A-Z0-9._-]+$/.test(studentCode)
    )
  ) {
    issues.push({
      field: 'studentCode',
      code: 'INVALID_FORMAT',
      message:
        'studentCode may only contain letters, numbers, dot, underscore and hyphen',
    })
  }

  if (
    fullName
    && (
      fullName.length < 2
      || fullName.length > 255
    )
  ) {
    issues.push({
      field: 'fullName',
      code: 'INVALID_LENGTH',
      message:
        'fullName must contain 2 to 255 characters',
    })
  }

  if (
    email
    && (
      email.length > 255
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    )
  ) {
    issues.push({
      field: 'email',
      code: 'INVALID_FORMAT',
      message: 'email has an invalid format',
    })
  }

  if (
    classCode
    && (
      classCode.length > 50
      || !/^[A-Z0-9._-]+$/.test(classCode)
    )
  ) {
    issues.push({
      field: 'classCode',
      code: 'INVALID_FORMAT',
      message:
        'classCode may only contain letters, numbers, dot, underscore and hyphen',
    })
  }

  if (
    issues.length > 0
    || !studentCode
    || !fullName
    || !email
    || !classCode
  ) {
    return {
      error: {
        sourceRow: row.sourceRow,
        values: createErrorValues(row),
        issues,
      },
    }
  }

  return {
    record: {
      sourceRow: row.sourceRow,
      studentCode,
      username: studentCode.toLowerCase(),
      fullName,
      email,
      classCode,
    },
  }
}

function rowsForOverwrite(
  rows: readonly StoredStudentImportRow[],
): PersistStudentImportRow[] {
  const selected:
    (PersistStudentImportRow | undefined)[] = []
  const byStudentCode = new Map<string, number>()
  const byEmail = new Map<string, number>()

  for (const row of rows) {
    const matchingIndexes = new Set<number>()
    const studentCodeIndex =
      byStudentCode.get(row.studentCode)
    const emailIndex = byEmail.get(row.email)

    if (studentCodeIndex !== undefined) {
      matchingIndexes.add(studentCodeIndex)
    }
    if (emailIndex !== undefined) {
      matchingIndexes.add(emailIndex)
    }

    if (matchingIndexes.size > 1) {
      throw new StudentImportAmbiguousDuplicateError()
    }

    const index = matchingIndexes
      .values().next().value as number | undefined

    if (index === undefined) {
      const nextIndex = selected.length
      selected.push(row)
      byStudentCode.set(row.studentCode, nextIndex)
      byEmail.set(row.email, nextIndex)
      continue
    }

    const previous = selected[index]
    if (previous) {
      byStudentCode.delete(previous.studentCode)
      byEmail.delete(previous.email)
    }
    selected[index] = row
    byStudentCode.set(row.studentCode, index)
    byEmail.set(row.email, index)
  }

  return selected.filter(
    (row): row is PersistStudentImportRow =>
      row !== undefined,
  )
}

export interface PreviewStudentImportInput {
  actorUserId: string
  fileName: string
  fileBuffer: Buffer
}

export interface ConfirmStudentImportInput {
  actorUserId: string
  actorUsername: string
  previewId: string
  duplicateStrategy:
    StudentImportDuplicateStrategy
  audit: StudentImportAuditContext
}

export interface StudentImportUseCase {
  previewImport(
    input: PreviewStudentImportInput,
  ): Promise<StudentImportPreviewResult>

  confirmImport(
    input: ConfirmStudentImportInput,
  ): Promise<StudentImportCommitResult>
}

export class StudentImportService
implements StudentImportUseCase {
  constructor(
    private readonly repository:
      StudentImportRepository,
    private readonly previewStore:
      StudentImportPreviewStore =
        new InMemoryStudentImportPreviewStore(),
    private readonly parser:
      StudentImportParser =
        parseStudentImportFile,
    private readonly clock:
      Clock = () => new Date(),
  ) {}

  async previewImport(
    input: PreviewStudentImportInput,
  ): Promise<StudentImportPreviewResult> {
    const parsed = await this.parser(
      input.fileName,
      input.fileBuffer,
    )
    const errorRecords:
      StudentImportErrorRecord[] = []
    const locallyValid: StudentImportRecord[] = []

    for (const row of parsed.rows) {
      const validation = validateRow(row)
      if (validation.error) {
        errorRecords.push(validation.error)
      } else if (validation.record) {
        locallyValid.push(validation.record)
      }
    }

    const inspection = await this.repository.inspect({
      actorUserId: input.actorUserId,
      classCodes: [
        ...new Set(
          locallyValid.map((row) => row.classCode),
        ),
      ],
      usernames: locallyValid.map((row) => row.username),
      emails: locallyValid.map((row) => row.email),
      studentCodes: locallyValid.map(
        (row) => row.studentCode,
      ),
    })

    const classesByCode = new Map(
      inspection.classes.map(
        (academicClass) => [
          academicClass.code.toUpperCase(),
          academicClass,
        ],
      ),
    )
    const existingStudentCodes = new Set(
      inspection.existing
        .map(
          (identity) =>
            identity.studentCode
              ?.trim().toUpperCase()
            ?? null,
        )
        .filter(
          (value): value is string =>
            value !== null,
        ),
    )
    const existingEmails = new Set(
      inspection.existing
        .map(
          (identity) =>
            identity.email
              ?.trim().toLowerCase()
            ?? null,
        )
        .filter(
          (value): value is string =>
            value !== null,
        ),
    )
    const existingUsernames = new Set(
      inspection.existing.map(
        (identity) =>
          identity.username
            .trim().toLowerCase(),
      ),
    )
    const firstStudentCodeRow =
      new Map<string, number>()
    const firstEmailRow = new Map<string, number>()
    const storedRows: StoredStudentImportRow[] = []
    const validRecords: StudentImportRecord[] = []
    const duplicateRecords:
      StudentImportDuplicateRecord[] = []

    for (const record of locallyValid) {
      const academicClass =
        classesByCode.get(record.classCode)

      if (!academicClass) {
        errorRecords.push({
          sourceRow: record.sourceRow,
          values: {
            studentCode:
              createErrorCell(record.studentCode),
            fullName:
              createErrorCell(record.fullName),
            email:
              createErrorCell(record.email),
            classCode:
              createErrorCell(record.classCode),
          },
          issues: [{
            field: 'classCode',
            code:
              'CLASS_NOT_FOUND_OR_OUTSIDE_SCOPE',
            message:
              'classCode is inactive, unknown or outside actor scope',
          }],
        })
        continue
      }

      const duplicates:
        StudentImportDuplicateReason[] = []
      const matchingStudentCodeRow =
        firstStudentCodeRow.get(
          record.studentCode,
        )
      const matchingEmailRow =
        firstEmailRow.get(record.email)

      if (matchingStudentCodeRow !== undefined) {
        duplicates.push({
          source: 'FILE',
          field: 'studentCode',
          matchedSourceRow:
            matchingStudentCodeRow,
          code: 'DUPLICATE_IN_FILE',
          message:
            'studentCode duplicates an earlier file row',
        })
      }
      if (matchingEmailRow !== undefined) {
        duplicates.push({
          source: 'FILE',
          field: 'email',
          matchedSourceRow: matchingEmailRow,
          code: 'DUPLICATE_IN_FILE',
          message:
            'email duplicates an earlier file row',
        })
      }
      if (existingStudentCodes.has(record.studentCode)) {
        duplicates.push({
          source: 'SYSTEM',
          field: 'studentCode',
          code: 'DUPLICATE_IN_SYSTEM',
          message:
            'studentCode already exists in the system',
        })
      }
      if (existingEmails.has(record.email)) {
        duplicates.push({
          source: 'SYSTEM',
          field: 'email',
          code: 'DUPLICATE_IN_SYSTEM',
          message:
            'email already exists in the system',
        })
      }
      if (
        existingUsernames.has(record.username)
        && !existingStudentCodes.has(record.studentCode)
      ) {
        duplicates.push({
          source: 'SYSTEM',
          field: 'studentCode',
          code: 'DERIVED_USERNAME_CONFLICT',
          message:
            'studentCode produces a username that already exists',
        })
      }

      if (!firstStudentCodeRow.has(record.studentCode)) {
        firstStudentCodeRow.set(
          record.studentCode,
          record.sourceRow,
        )
      }
      if (!firstEmailRow.has(record.email)) {
        firstEmailRow.set(
          record.email,
          record.sourceRow,
        )
      }

      storedRows.push({
        ...record,
        classId: academicClass.id,
        duplicates,
      })

      if (duplicates.length > 0) {
        duplicateRecords.push({
          record,
          duplicates,
        })
      } else {
        validRecords.push(record)
      }
    }

    const now = this.clock()
    const stored = this.previewStore.create(
      {
        actorUserId: input.actorUserId,
        fileName: input.fileName,
        rows: storedRows,
        totalRows: parsed.rows.length,
        hasValidationErrors:
          errorRecords.length > 0,
      },
      now,
    )

    return {
      previewId: stored.id,
      expiresAt: stored.expiresAt.toISOString(),
      file: {
        name: input.fileName,
        format: parsed.format,
      },
      summary: {
        total: parsed.rows.length,
        valid: validRecords.length,
        errors: errorRecords.length,
        duplicates: duplicateRecords.length,
      },
      validRecords,
      errorRecords,
      duplicateRecords,
    }
  }

  async confirmImport(
    input: ConfirmStudentImportInput,
  ): Promise<StudentImportCommitResult> {
    const acquired = this.previewStore.acquire(
      input.previewId,
      input.actorUserId,
      this.clock(),
    )

    if (!acquired) {
      throw new StudentImportPreviewNotFoundError()
    }

    try {
      const { preview } = acquired

      if (preview.hasValidationErrors) {
        throw new StudentImportValidationBlockedError()
      }

      const containsDuplicates = preview.rows.some(
        (row) => row.duplicates.length > 0,
      )

      if (
        input.duplicateStrategy === 'FAIL'
        && containsDuplicates
      ) {
        throw new StudentImportDuplicateBlockedError()
      }

      const rows = input.duplicateStrategy === 'SKIP'
        ? preview.rows.filter(
            (row) => row.duplicates.length === 0,
          )
        : input.duplicateStrategy === 'OVERWRITE'
          ? rowsForOverwrite(preview.rows)
          : preview.rows
      const preSkipped =
        input.duplicateStrategy === 'SKIP'
          ? preview.rows.length - rows.length
          : 0

      const result = await this.repository.commit({
        actorUserId: input.actorUserId,
        actorUsername: input.actorUsername,
        previewId: preview.id,
        fileName: preview.fileName,
        duplicateStrategy:
          input.duplicateStrategy,
        rows,
        previewTotalRows: preview.totalRows,
        preSkipped,
        occurredAt: this.clock(),
        audit: input.audit,
      })

      acquired.complete()
      return result
    } catch (error) {
      acquired.release()
      throw error
    }
  }
}
