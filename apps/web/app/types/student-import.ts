// Định nghĩa các kiểu dữ liệu liên quan đến import sinh viên.

export type StudentImportFormat =
  | 'CSV'
  | 'XLSX'

export type StudentImportColumn =
  | 'studentCode'
  | 'fullName'
  | 'email'
  | 'classCode'

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

/**
 * Một dòng bị lỗi có thể chứa nhiều issue,
 * ví dụ vừa thiếu email vừa sai classCode.
 */
export interface StudentImportErrorRecord {
  sourceRow: number
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

export interface StudentImportPreviewResponse {
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
  duplicateRecords: StudentImportDuplicateRecord[]
}

/**
 * Kết quả trả về từ
 * POST /students/imports/:previewId/confirm.
 */
export interface StudentImportCommitResponse {
  imported: number
  updated: number
  skipped: number
}
export type StudentImportApiErrorCode =
  | 'IMPORT_PREVIEW_NOT_FOUND'
  | 'IMPORT_VALIDATION_BLOCKED'
  | 'IMPORT_DUPLICATE_BLOCKED'
  | 'IMPORT_AMBIGUOUS_DUPLICATE'
  | 'IMPORT_COMMIT_CONFLICT'

export interface StudentImportApiErrorResponse {
  message: string

  error: {
    code: StudentImportApiErrorCode
    requestId: string
  }
}