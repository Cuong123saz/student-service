import { createHash } from 'node:crypto'

import { and, asc, eq, gt, lte, ne, sql } from 'drizzle-orm'

import { db } from '../../db/client.js'
import {
  studentImportFiles,
  studentImportPreviews,
  studentImportProcessingJobs,
} from './student-import.schema.js'
import type {
  ClaimedStudentImportJob,
  CreateStudentImportJobInput,
  StudentImportJobStatus,
  StudentImportProcessingJobRepository,
} from './student-import-processing-job.service.js'
import type { StoredStudentImportPreview } from './student-import.service.js'

type PreviewPayload = Omit<StoredStudentImportPreview, 'id' | 'expiresAt'>

export class DrizzleStudentImportProcessingJobRepository implements StudentImportProcessingJobRepository {
  constructor(private readonly database: typeof db = db) {}

  async enqueue(input: CreateStudentImportJobInput): Promise<string> {
    return this.database.transaction(async (transaction) => {
      await transaction
        .delete(studentImportPreviews)
        .where(
          and(
            lte(studentImportPreviews.expiresAt, input.now),
            ne(studentImportPreviews.status, 'PROCESSING'),
          ),
        )

      await transaction.delete(studentImportFiles).where(
        and(
          lte(studentImportFiles.expiresAt, input.now),
          sql`NOT EXISTS (
              SELECT 1
              FROM ${studentImportProcessingJobs}
              WHERE ${studentImportProcessingJobs.fileId} = ${studentImportFiles.id}
                AND ${studentImportProcessingJobs.status} = 'PROCESSING'
            )`,
        ),
      )

      const [file] = await transaction
        .insert(studentImportFiles)
        .values({
          actorUserId: input.actorUserId,
          originalFileName: input.fileName,
          mediaType: input.mediaType,
          byteSize: input.content.byteLength,
          sha256: createHash('sha256').update(input.content).digest('hex'),
          content: input.content,
          createdAt: input.now,
          expiresAt: input.expiresAt,
        })
        .returning({ id: studentImportFiles.id })

      if (!file) {
        throw new Error('Failed to persist student import file')
      }

      const [job] = await transaction
        .insert(studentImportProcessingJobs)
        .values({
          fileId: file.id,
          actorUserId: input.actorUserId,
          status: 'PENDING',
          attempts: 0,
          maxAttempts: 3,
          nextAttemptAt: input.now,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .returning({
          id: studentImportProcessingJobs.id,
        })

      if (!job) {
        throw new Error('Failed to enqueue student import job')
      }
      return job.id
    })
  }

  async claimNext(input: {
    workerId: string
    now: Date
    staleBefore: Date
  }): Promise<ClaimedStudentImportJob | null> {
    return this.database.transaction(async (transaction) => {
      await transaction
        .delete(studentImportPreviews)
        .where(
          and(
            lte(studentImportPreviews.expiresAt, input.now),
            ne(studentImportPreviews.status, 'PROCESSING'),
          ),
        )

      await transaction.delete(studentImportFiles).where(
        and(
          lte(studentImportFiles.expiresAt, input.now),
          sql`NOT EXISTS (
              SELECT 1
              FROM ${studentImportProcessingJobs}
              WHERE ${studentImportProcessingJobs.fileId} = ${studentImportFiles.id}
                AND ${studentImportProcessingJobs.status} = 'PROCESSING'
            )`,
        ),
      )

      await transaction
        .update(studentImportProcessingJobs)
        .set({
          status: 'FAILED',
          lockedAt: null,
          lockedBy: null,
          lastErrorCode: 'WORKER_LOCK_EXPIRED',
          updatedAt: input.now,
        })
        .where(
          and(
            eq(studentImportProcessingJobs.status, 'PROCESSING'),
            lte(studentImportProcessingJobs.lockedAt, input.staleBefore),
            sql`${studentImportProcessingJobs.attempts} >= ${studentImportProcessingJobs.maxAttempts}`,
          ),
        )

      await transaction
        .update(studentImportProcessingJobs)
        .set({
          status: 'PENDING',
          lockedAt: null,
          lockedBy: null,
          nextAttemptAt: input.now,
          lastErrorCode: 'WORKER_LOCK_EXPIRED',
          updatedAt: input.now,
        })
        .where(
          and(
            eq(studentImportProcessingJobs.status, 'PROCESSING'),
            lte(studentImportProcessingJobs.lockedAt, input.staleBefore),
            sql`${studentImportProcessingJobs.attempts} < ${studentImportProcessingJobs.maxAttempts}`,
          ),
        )

      const [candidate] = await transaction
        .select({
          id: studentImportProcessingJobs.id,
        })
        .from(studentImportProcessingJobs)
        .innerJoin(
          studentImportFiles,
          eq(studentImportProcessingJobs.fileId, studentImportFiles.id),
        )
        .where(
          and(
            eq(studentImportProcessingJobs.status, 'PENDING'),
            lte(studentImportProcessingJobs.nextAttemptAt, input.now),
            gt(studentImportFiles.expiresAt, input.now),
            sql`${studentImportProcessingJobs.attempts} < ${studentImportProcessingJobs.maxAttempts}`,
          ),
        )
        .orderBy(
          asc(studentImportProcessingJobs.nextAttemptAt),
          asc(studentImportProcessingJobs.createdAt),
        )
        .limit(1)
        .for('update', { skipLocked: true })

      if (!candidate) return null

      const [claimed] = await transaction
        .update(studentImportProcessingJobs)
        .set({
          status: 'PROCESSING',
          attempts: sql`${studentImportProcessingJobs.attempts} + 1`,
          lockedAt: input.now,
          lockedBy: input.workerId,
          lastErrorCode: null,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(studentImportProcessingJobs.id, candidate.id),
            eq(studentImportProcessingJobs.status, 'PENDING'),
          ),
        )
        .returning({
          id: studentImportProcessingJobs.id,
          fileId: studentImportProcessingJobs.fileId,
          actorUserId: studentImportProcessingJobs.actorUserId,
          attempt: studentImportProcessingJobs.attempts,
          maxAttempts: studentImportProcessingJobs.maxAttempts,
        })

      if (!claimed) return null

      const [file] = await transaction
        .select({
          fileName: studentImportFiles.originalFileName,
          content: studentImportFiles.content,
        })
        .from(studentImportFiles)
        .where(
          and(
            eq(studentImportFiles.id, claimed.fileId),
            gt(studentImportFiles.expiresAt, input.now),
          ),
        )
        .limit(1)

      if (!file) {
        return null
      }

      return {
        id: claimed.id,
        actorUserId: claimed.actorUserId,
        fileName: file.fileName,
        content: Buffer.from(file.content),
        attempt: claimed.attempt,
        maxAttempts: claimed.maxAttempts,
      }
    })
  }

  async markSucceeded(input: {
    jobId: string
    workerId: string
    previewId: string
    now: Date
  }): Promise<boolean> {
    const [updated] = await this.database
      .update(studentImportProcessingJobs)
      .set({
        status: 'SUCCEEDED',
        previewId: input.previewId,
        lockedAt: null,
        lockedBy: null,
        lastErrorCode: null,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(studentImportProcessingJobs.id, input.jobId),
          eq(studentImportProcessingJobs.status, 'PROCESSING'),
          eq(studentImportProcessingJobs.lockedBy, input.workerId),
        ),
      )
      .returning({ id: studentImportProcessingJobs.id })
    return updated !== undefined
  }

  async markFailed(input: {
    jobId: string
    workerId: string
    errorCode: string
    retryAt: Date
    permanent: boolean
    now: Date
  }): Promise<boolean> {
    const [updated] = await this.database
      .update(studentImportProcessingJobs)
      .set({
        status: input.permanent ? 'FAILED' : 'PENDING',
        nextAttemptAt: input.retryAt,
        lockedAt: null,
        lockedBy: null,
        lastErrorCode: input.errorCode,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(studentImportProcessingJobs.id, input.jobId),
          eq(studentImportProcessingJobs.status, 'PROCESSING'),
          eq(studentImportProcessingJobs.lockedBy, input.workerId),
        ),
      )
      .returning({ id: studentImportProcessingJobs.id })
    return updated !== undefined
  }

  async getStatus(
    jobId: string,
    actorUserId: string,
    now: Date,
  ): Promise<StudentImportJobStatus | null> {
    const [row] = await this.database
      .select({
        id: studentImportProcessingJobs.id,
        status: studentImportProcessingJobs.status,
        errorCode: studentImportProcessingJobs.lastErrorCode,
        previewId: studentImportPreviews.id,
        payload: studentImportPreviews.payload,
        previewExpiresAt: studentImportPreviews.expiresAt,
      })
      .from(studentImportProcessingJobs)
      .leftJoin(
        studentImportPreviews,
        eq(studentImportProcessingJobs.previewId, studentImportPreviews.id),
      )
      .where(
        and(
          eq(studentImportProcessingJobs.id, jobId),
          eq(studentImportProcessingJobs.actorUserId, actorUserId),
        ),
      )
      .limit(1)

    if (!row) return null

    let status = row.status as StudentImportJobStatus['status']
    let errorCode = row.errorCode
    let preview: StudentImportJobStatus['preview'] = null

    if (
      status === 'SUCCEEDED' &&
      row.previewId &&
      row.payload &&
      row.previewExpiresAt &&
      row.previewExpiresAt > now
    ) {
      const payload = row.payload as PreviewPayload
      preview = {
        previewId: row.previewId,
        expiresAt: row.previewExpiresAt.toISOString(),
        ...payload.result,
      }
    } else if (status === 'SUCCEEDED') {
      status = 'FAILED'
      errorCode = 'IMPORT_PREVIEW_EXPIRED'
    }

    return {
      id: row.id,
      status,
      errorCode,
      preview,
    }
  }
}
