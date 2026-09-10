import {
  StudentImportArchiveLimitError,
  StudentImportFileParseError,
  StudentImportMissingColumnsError,
  StudentImportRowLimitError,
  UnsupportedStudentImportFileError,
} from './student-import.parser.js'
import { StudentImportForbiddenError } from './student-import.repository.js'
import type { StudentImportPreviewResult, StudentImportUseCase } from './student-import.service.js'

export const STUDENT_IMPORT_FILE_TTL_MS = 30 * 60 * 1_000
export const STUDENT_IMPORT_JOB_STALE_LOCK_MS = 5 * 60 * 1_000

export interface CreateStudentImportJobInput {
  actorUserId: string
  fileName: string
  mediaType: string
  content: Buffer
  now: Date
  expiresAt: Date
}

export interface ClaimedStudentImportJob {
  id: string
  actorUserId: string
  fileName: string
  content: Buffer
  attempt: number
  maxAttempts: number
}

export interface StudentImportJobStatus {
  id: string
  status: 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED'
  errorCode: string | null
  preview: StudentImportPreviewResult | null
}

export interface StudentImportProcessingJobRepository {
  enqueue(input: CreateStudentImportJobInput): Promise<string>
  claimNext(input: {
    workerId: string
    now: Date
    staleBefore: Date
  }): Promise<ClaimedStudentImportJob | null>
  markSucceeded(input: {
    jobId: string
    workerId: string
    previewId: string
    now: Date
  }): Promise<boolean>
  markFailed(input: {
    jobId: string
    workerId: string
    errorCode: string
    retryAt: Date
    permanent: boolean
    now: Date
  }): Promise<boolean>
  getStatus(jobId: string, actorUserId: string, now: Date): Promise<StudentImportJobStatus | null>
}

export interface StudentImportProcessingJobUseCase {
  enqueue(input: {
    actorUserId: string
    fileName: string
    mediaType: string
    content: Buffer
  }): Promise<{ jobId: string }>
  getStatus(jobId: string, actorUserId: string): Promise<StudentImportJobStatus | null>
  processNext(workerId: string): Promise<boolean>
}

type Clock = () => Date

function retryDelayMs(attempt: number): number {
  return Math.min(5 * 60 * 1_000, 5_000 * 3 ** Math.max(0, attempt - 1))
}

function permanentErrorCode(error: unknown): string | null {
  if (error instanceof StudentImportArchiveLimitError) {
    return 'IMPORT_ARCHIVE_LIMIT_EXCEEDED'
  }
  if (error instanceof UnsupportedStudentImportFileError) {
    return 'IMPORT_FILE_UNSUPPORTED'
  }
  if (error instanceof StudentImportMissingColumnsError) {
    return 'IMPORT_MISSING_COLUMNS'
  }
  if (error instanceof StudentImportRowLimitError) {
    return 'IMPORT_ROW_LIMIT_EXCEEDED'
  }
  if (error instanceof StudentImportFileParseError) {
    return 'IMPORT_FILE_PARSE_FAILED'
  }
  if (error instanceof StudentImportForbiddenError) {
    return 'IMPORT_FORBIDDEN'
  }
  return null
}

export class StudentImportProcessingJobService implements StudentImportProcessingJobUseCase {
  constructor(
    private readonly repository: StudentImportProcessingJobRepository,
    private readonly importService: StudentImportUseCase,
    private readonly clock: Clock = () => new Date(),
  ) {}

  async enqueue(input: {
    actorUserId: string
    fileName: string
    mediaType: string
    content: Buffer
  }): Promise<{ jobId: string }> {
    const now = this.clock()
    const jobId = await this.repository.enqueue({
      ...input,
      now,
      expiresAt: new Date(now.getTime() + STUDENT_IMPORT_FILE_TTL_MS),
    })
    return { jobId }
  }

  async getStatus(jobId: string, actorUserId: string): Promise<StudentImportJobStatus | null> {
    return this.repository.getStatus(jobId, actorUserId, this.clock())
  }

  async processNext(workerId: string): Promise<boolean> {
    const claimedAt = this.clock()
    const job = await this.repository.claimNext({
      workerId,
      now: claimedAt,
      staleBefore: new Date(claimedAt.getTime() - STUDENT_IMPORT_JOB_STALE_LOCK_MS),
    })

    if (!job) return false

    try {
      const preview = await this.importService.previewImport({
        actorUserId: job.actorUserId,
        fileName: job.fileName,
        fileBuffer: job.content,
        sourceJobId: job.id,
      })
      await this.repository.markSucceeded({
        jobId: job.id,
        workerId,
        previewId: preview.previewId,
        now: this.clock(),
      })
    } catch (error: unknown) {
      const failedAt = this.clock()
      const errorCode = permanentErrorCode(error)
      const permanent = errorCode !== null || job.attempt >= job.maxAttempts
      await this.repository.markFailed({
        jobId: job.id,
        workerId,
        errorCode: errorCode ?? 'IMPORT_WORKER_FAILED',
        permanent,
        now: failedAt,
        retryAt: new Date(failedAt.getTime() + retryDelayMs(job.attempt)),
      })
    }

    return true
  }
}
