import { and, eq, desc, isNull, or, sql } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { users, roles, userRoles } from '../auth/auth.schema.js'
import { submissions, submissionEvents } from '../submissions/submission.schema.js'
import { reviewerAuthorities, reviewVisibility } from '../submissions/submission.authorization.js'
import { SubmissionError, missingDraft } from '../submissions/submission.types.js'
import { personalNotifications as notices } from './notification.schema.js'
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Portal = 'user' | 'admin'
const labels: Record<string, [string, string]> = {
  SUBMITTED: ['Hồ sơ được chỉ định', 'Có hồ sơ mới chờ bạn tiếp nhận.'],
  CLAIMED: ['Đã nhận hồ sơ', 'Hồ sơ đã được nhận để xử lý.'],
  REASSIGNED: ['Bàn giao hồ sơ', 'Cán bộ xử lý hồ sơ đã được thay đổi.'],
  RESUBMITTED: ['Sinh viên gửi bổ sung', 'Hồ sơ đã có lần gửi bổ sung mới.'],
  SUPPLEMENT_REQUESTED: ['Yêu cầu bổ sung', 'Hồ sơ cần bổ sung theo hướng dẫn của cán bộ.'],
  APPROVED: [
    'Đã duyệt nội dung',
    'Hồ sơ đã có quyết định duyệt nội dung. Chưa phải ký hoặc cấp văn bản.',
  ],
  REJECTED: ['Không chấp thuận', 'Hồ sơ đã có quyết định không chấp thuận. Xem lý do trong hồ sơ.'],
}
function decodeCursor(raw?: string): [string, string] | null {
  if (!raw) return null
  try {
    if (raw.length > 300 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error()
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    if (!Array.isArray(parsed) || parsed.length !== 2 || parsed.some((v) => typeof v !== 'string'))
      throw new Error()
    const [time, id] = parsed as [string, string]
    if (
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(time) ||
      !Number.isFinite(Date.parse(time)) ||
      new Date(time).toISOString().slice(0, 19) !== time.slice(0, 19) ||
      !/^([0-9a-f]{8}-){1}[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    )
      throw new Error()
    return [time, id]
  } catch {
    throw new SubmissionError(
      400,
      'INVALID_CURSOR',
      'Mốc tải thêm không hợp lệ. Hãy tải lại thông báo.',
    )
  }
}
export class DrizzleNotificationRepository {
  constructor(private readonly database: typeof db = db) {}
  private async visible(tx: Transaction, userId: string, portal: Portal) {
    const current = await tx
      .select({ code: roles.code })
      .from(users)
      .innerJoin(userRoles, eq(users.id, userRoles.userId))
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(
        and(eq(users.id, userId), eq(users.status, 'ACTIVE'), eq(users.mustChangePassword, false)),
      )
    const codes = current.map((r) => r.code)
    const usable =
      portal === 'admin'
        ? ['ADMIN', 'SYSTEM_ADMIN']
        : ['STUDENT', 'ACADEMIC_ADVISOR', 'FACULTY_REVIEWER', 'DOCUMENT_SIGNER']
    if (!codes.some((code) => usable.includes(code)))
      throw new SubmissionError(
        403,
        'FORBIDDEN',
        'Tài khoản hiện không đủ điều kiện xem thông báo ở cổng này.',
      )
    const authority = await reviewerAuthorities(tx, { userId })
    const owner =
      portal === 'user' && codes.includes('STUDENT')
        ? and(
            eq(notices.recipientKind, 'OWNER'),
            eq(submissions.studentUserId, userId),
            sql`EXISTS (SELECT 1 FROM student_profiles np JOIN academic_classes nc ON nc.id=np.class_id JOIN faculties nf ON nf.id=nc.faculty_id WHERE np.user_id=${userId} AND nc.status='ACTIVE' AND nf.status='ACTIVE')`,
          )
        : sql`false`
    return and(
      eq(notices.recipientUserId, userId),
      or(owner, and(eq(notices.recipientKind, 'REVIEWER'), reviewVisibility(userId, authority))),
    )!
  }
  private async count(tx: Transaction, predicate: ReturnType<typeof and>) {
    const [row] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(notices)
      .innerJoin(submissions, eq(submissions.id, notices.submissionId))
      .where(and(predicate, isNull(notices.readAt)))
    return row?.count ?? 0
  }
  async unreadCount(userId: string, portal: Portal) {
    return this.database.transaction(async (tx) => ({
      unreadCount: await this.count(tx, await this.visible(tx, userId, portal)),
    }))
  }
  async list(
    userId: string,
    portal: Portal,
    options: { cursor?: string; unreadOnly?: boolean } = {},
  ) {
    const cursor = decodeCursor(options.cursor)
    return this.database.transaction(async (tx) => {
      const predicate = await this.visible(tx, userId, portal)
      const rows = await tx
        .select({
          id: notices.id,
          action: submissionEvents.action,
          createdAt: notices.createdAt,
          readAt: notices.readAt,
          submissionId: notices.submissionId,
          recipientKind: notices.recipientKind,
          cursorAt: sql<string>`to_char(${notices.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        })
        .from(notices)
        .innerJoin(submissions, eq(submissions.id, notices.submissionId))
        .innerJoin(submissionEvents, eq(submissionEvents.id, notices.eventId))
        .where(
          and(
            predicate,
            options.unreadOnly ? isNull(notices.readAt) : undefined,
            cursor
              ? sql`(${notices.createdAt},${notices.id}) < (${cursor[0]}::timestamptz,${cursor[1]}::uuid)`
              : undefined,
          ),
        )
        .orderBy(desc(notices.createdAt), desc(notices.id))
        .limit(21)
      const page = rows.slice(0, 20),
        last = page.at(-1)
      return {
        items: page.map((row) => ({
          id: row.id,
          action: row.action,
          title: labels[row.action]?.[0] ?? 'Cập nhật hồ sơ',
          message: labels[row.action]?.[1] ?? 'Hồ sơ có cập nhật mới.',
          createdAt: row.createdAt.toISOString(),
          readAt: row.readAt?.toISOString() ?? null,
          targetUrl:
            row.recipientKind === 'OWNER'
              ? '/submissions/' + row.submissionId
              : (portal === 'admin' ? '/admin' : '') + '/review-submissions/' + row.submissionId,
        })),
        nextCursor:
          rows.length > 20 && last
            ? Buffer.from(JSON.stringify([last.cursorAt, last.id])).toString('base64url')
            : null,
        unreadCount: await this.count(tx, predicate),
      }
    })
  }
  async read(userId: string, portal: Portal, id: string) {
    return this.database.transaction(async (tx) => {
      const predicate = await this.visible(tx, userId, portal)
      // Lock only the notification, never a submission: no reverse lock order with dossier writers.
      const [visible] = await tx
        .select({ id: notices.id })
        .from(notices)
        .innerJoin(submissions, eq(submissions.id, notices.submissionId))
        .where(and(eq(notices.id, id), predicate))
        .limit(1)
      if (!visible) throw missingDraft()
      const [row] = await tx
        .update(notices)
        .set({ readAt: sql`COALESCE(${notices.readAt},now())` })
        .where(
          and(
            eq(notices.id, id),
            eq(notices.recipientUserId, userId),
            sql`EXISTS (SELECT 1 FROM submissions WHERE submissions.id=${notices.submissionId} AND ${predicate})`,
          ),
        )
        .returning({ id: notices.id, readAt: notices.readAt })
      if (!row?.readAt) throw missingDraft()
      return {
        id: row.id,
        readAt: row.readAt.toISOString(),
        unreadCount: await this.count(tx, predicate),
      }
    })
  }
}
