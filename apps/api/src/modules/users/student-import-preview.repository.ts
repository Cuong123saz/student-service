import { randomUUID } from 'node:crypto'

import { and, eq, gt, lte } from 'drizzle-orm'

import { db } from '../../db/client.js'
import { studentImportPreviews } from './student-import.schema.js'
import {
  STUDENT_IMPORT_PREVIEW_TTL_MS,
  type AcquiredStudentImportPreview,
  type StoredStudentImportPreview,
  type StudentImportPreviewStore,
} from './student-import.service.js'

export const STUDENT_IMPORT_PREVIEW_STALE_LOCK_MS = 5 * 60 * 1_000

type StoredPayload = Omit<StoredStudentImportPreview, 'id' | 'expiresAt'>

export class DrizzleStudentImportPreviewStore implements StudentImportPreviewStore {
  constructor(
    private readonly database: typeof db = db,
    private readonly ttlMs = STUDENT_IMPORT_PREVIEW_TTL_MS,
    private readonly staleLockMs = STUDENT_IMPORT_PREVIEW_STALE_LOCK_MS,
  ) {}

  async create(
    input: StoredPayload,
    now: Date,
    sourceJobId = randomUUID(),
  ): Promise<StoredStudentImportPreview> {
    const expiresAt = new Date(now.getTime() + this.ttlMs)

    const [created] = await this.database
      .insert(studentImportPreviews)
      .values({
        sourceJobId,
        actorUserId: input.actorUserId,
        fileName: input.fileName,
        payload: input,
        status: 'PENDING',
        createdAt: now,
        expiresAt,
      })
      .onConflictDoNothing({
        target: studentImportPreviews.sourceJobId,
      })
      .returning({
        id: studentImportPreviews.id,
        payload: studentImportPreviews.payload,
        expiresAt: studentImportPreviews.expiresAt,
      })

    const row =
      created ??
      (
        await this.database
          .select({
            id: studentImportPreviews.id,
            payload: studentImportPreviews.payload,
            expiresAt: studentImportPreviews.expiresAt,
          })
          .from(studentImportPreviews)
          .where(eq(studentImportPreviews.sourceJobId, sourceJobId))
          .limit(1)
      )[0]

    if (!row) {
      throw new Error('Failed to persist student import preview')
    }

    return {
      ...(row.payload as StoredPayload),
      id: row.id,
      expiresAt: row.expiresAt,
    }
  }

  async acquire(
    previewId: string,
    actorUserId: string,
    now: Date,
  ): Promise<AcquiredStudentImportPreview | undefined> {
    const acquisitionId = randomUUID()
    const staleBefore = new Date(now.getTime() - this.staleLockMs)

    const row = await this.database.transaction(async (transaction) => {
      // Reuse the invitation-job lazy reclaim pattern. A
      // preview is reclaimed only by its owner and only
      // after the single shared stale-lock interval.
      await transaction
        .update(studentImportPreviews)
        .set({
          status: 'PENDING',
          lockedAt: null,
          lockedBy: null,
        })
        .where(
          and(
            eq(studentImportPreviews.id, previewId),
            eq(studentImportPreviews.actorUserId, actorUserId),
            eq(studentImportPreviews.status, 'PROCESSING'),
            lte(studentImportPreviews.lockedAt, staleBefore),
            gt(studentImportPreviews.expiresAt, now),
          ),
        )

      const [acquired] = await transaction
        .update(studentImportPreviews)
        .set({
          status: 'PROCESSING',
          lockedAt: now,
          lockedBy: acquisitionId,
        })
        .where(
          and(
            eq(studentImportPreviews.id, previewId),
            eq(studentImportPreviews.actorUserId, actorUserId),
            eq(studentImportPreviews.status, 'PENDING'),
            gt(studentImportPreviews.expiresAt, now),
          ),
        )
        .returning({
          id: studentImportPreviews.id,
          payload: studentImportPreviews.payload,
          expiresAt: studentImportPreviews.expiresAt,
        })

      return acquired
    })

    if (!row) {
      return undefined
    }

    let settled = false
    const preview: StoredStudentImportPreview = {
      ...(row.payload as StoredPayload),
      id: row.id,
      expiresAt: row.expiresAt,
    }

    return {
      preview,
      acquisitionId,
      release: async () => {
        if (settled) return
        await this.database
          .update(studentImportPreviews)
          .set({
            status: 'PENDING',
            lockedAt: null,
            lockedBy: null,
          })
          .where(
            and(
              eq(studentImportPreviews.id, previewId),
              eq(studentImportPreviews.actorUserId, actorUserId),
              eq(studentImportPreviews.status, 'PROCESSING'),
              eq(studentImportPreviews.lockedBy, acquisitionId),
            ),
          )
        settled = true
      },
      complete: async () => {
        if (settled) return
        await this.database
          .update(studentImportPreviews)
          .set({
            status: 'CONSUMED',
            lockedAt: null,
            lockedBy: null,
            consumedAt: now,
          })
          .where(
            and(
              eq(studentImportPreviews.id, previewId),
              eq(studentImportPreviews.actorUserId, actorUserId),
              eq(studentImportPreviews.status, 'PROCESSING'),
              eq(studentImportPreviews.lockedBy, acquisitionId),
            ),
          )
        settled = true
      },
    }
  }
}
