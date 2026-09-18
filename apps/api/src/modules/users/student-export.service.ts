import type { AuditRecorder } from '../audit/audit.service.js'
import type { AuditEventInput } from '../audit/audit.types.js'
import { createStudentExportWorkbook, XLSX_CONTENT_TYPE } from './student-export.xlsx.js'

export const STUDENT_EXPORT_MAX_ROWS = 10_000

export type StudentExportStatus = 'INVITED' | 'ACTIVE' | 'INACTIVE' | 'SUSPENDED'

export interface StudentExportFilters {
  status?: StudentExportStatus
  facultyId?: string
  classId?: string
  search?: string
}

export interface StudentExportRecord {
  username: string
  fullName: string
  email: string | null
  status: string
  studentCode: string
  classCode: string
  className: string
  facultyCode: string
  facultyName: string
}

export interface ListStudentExportInput extends StudentExportFilters {
  actorUserId: string
  maxRows: number
}

export interface StudentExportRepository {
  listVisibleForExport(input: ListStudentExportInput): Promise<StudentExportRecord[]>
}

export interface ExportStudentsInput extends StudentExportFilters {
  actorUserId: string
  actorUsername: string
  audit: Pick<AuditEventInput, 'requestId' | 'ipAddress' | 'userAgent'>
}

export interface StudentExportFile {
  buffer: Buffer
  contentType: typeof XLSX_CONTENT_TYPE
  fileName: string
  rowCount: number
}

export interface StudentExportUseCase {
  exportStudents(input: ExportStudentsInput): Promise<StudentExportFile>
}

function timestampForFileName(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
}

export class StudentExportService implements StudentExportUseCase {
  constructor(
    private readonly repository: StudentExportRepository,
    private readonly auditRecorder: AuditRecorder,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async exportStudents(input: ExportStudentsInput): Promise<StudentExportFile> {
    const normalizedSearch = input.search?.trim()
    const records = await this.repository.listVisibleForExport({
      actorUserId: input.actorUserId,
      maxRows: STUDENT_EXPORT_MAX_ROWS,
      ...(input.status ? { status: input.status } : {}),
      ...(input.facultyId ? { facultyId: input.facultyId } : {}),
      ...(input.classId ? { classId: input.classId } : {}),
      ...(normalizedSearch ? { search: normalizedSearch } : {}),
    })
    const createdAt = this.clock()
    const buffer = createStudentExportWorkbook(records)

    await this.auditRecorder.record({
      actorType: 'USER',
      actorUserId: input.actorUserId,
      actorUsername: input.actorUsername,
      action: 'STUDENT_EXPORT',
      resourceType: 'STUDENT_DIRECTORY',
      resourceId: null,
      outcome: 'SUCCESS',
      ...input.audit,
      metadata: {
        format: 'XLSX',
        rowCount: records.length,
        status: input.status ?? null,
        facultyId: input.facultyId ?? null,
        classId: input.classId ?? null,
        search: normalizedSearch || null,
      },
      before: null,
      after: null,
    })

    return {
      buffer,
      contentType: XLSX_CONTENT_TYPE,
      fileName: `students-${timestampForFileName(createdAt)}.xlsx`,
      rowCount: records.length,
    }
  }
}
