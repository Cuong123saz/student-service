import { createHash } from 'node:crypto'
import type { Sql, TransactionSql } from 'postgres'
import QRCode from 'qrcode'
import { databaseClient } from '../../db/client.js'
import { env } from '../../config/env.js'
import type { EvidenceStorage } from '../submissions/submission.storage.js'
import { SubmissionError, type SubmissionActor } from '../submissions/submission.types.js'
import {
  captureWindowMs,
  newCertificateCode,
  newCheckinSecret,
  rotatingCheckinCode,
  staticCheckinCode,
  verifyCheckinCode,
} from './activity-checkin.js'
import { stripJpegMetadata } from './activity-photo.js'
import { ActivityRepository } from './activity.repository.js'

type Tx = TransactionSql
const fail = (n: number, code: string, msg: string) => new SubmissionError(n, code, msg)
const missing = () =>
  fail(404, 'ACTIVITY_NOT_FOUND', 'Không tìm thấy hoạt động trong phạm vi của bạn.')
const conflict = (msg = 'Lượt điểm danh đã thay đổi hoặc không còn phù hợp. Hãy tải lại.') =>
  fail(409, 'ACTIVITY_ATTENDANCE_CONFLICT', msg)
const iso = (c: string) =>
  `CASE WHEN ${c} IS NULL THEN NULL ELSE to_char(${c} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END`
/** ADR 0032 assumption: photos are deleted 90 days after the activity ends. */
export const activityPhotoRetentionDays = 90

export type AttendanceStatus = 'SCANNED' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED'
export interface MyAttendance {
  activityId: string
  status: AttendanceStatus | null
  captureExpiresAt: string | null
  reviewNote: string | null
  certificateCode: string | null
}
export interface AttendanceEntry {
  id: string
  studentUserId: string
  studentCode: string
  fullName: string
  classCode: string
  status: AttendanceStatus
  scannedAt: string
  submittedAt: string | null
  reviewedAt: string | null
  reviewer: string | null
  reviewNote: string | null
  hasPhoto: boolean
  certificate: {
    id: string
    code: string
    status: 'ISSUED' | 'REVOKED'
    revokeReason: string | null
  } | null
  revision: number
}
export interface Certificate {
  id: string
  code: string
  activityId: string
  activityTitle: string
  activityStartsAt: string
  issuedAt: string
  issuedBy: string
  payloadSha256: string
  status: 'ISSUED' | 'REVOKED'
  revokedAt: string | null
  revokeReason: string | null
  technicalSignatureStatus: 'NOT_VERIFIED'
  legalEffect: false
}

/** ADR 0032: QR check-in, in-page photo, attendance review and participation certificates. */
export class ActivityAttendanceRepository {
  private readonly activities: ActivityRepository
  constructor(
    private readonly storage: EvidenceStorage,
    private readonly db: Sql = databaseClient,
  ) {
    this.activities = new ActivityRepository(db)
  }

  private async lock(tx: Tx, id: string) {
    const [a] = await tx<
      {
        status: string
        secret: string
        rotating: boolean
        startsMs: number
        endsMs: number
        revision: number
      }[]
    >`SELECT status,checkin_secret AS secret,rotating_qr AS rotating,revision,(extract(epoch from starts_at)*1000)::float8 AS "startsMs",(extract(epoch from ends_at)*1000)::float8 AS "endsMs"
      FROM activities WHERE id=${id} FOR UPDATE`
    if (!a) throw missing()
    await tx`SELECT activity_settle(${id}::uuid)`
    return a
  }
  /** Owner unit staff or the owner/delegated club leader review; CTSV (moderate) may view photos. */
  private async staff(tx: Tx, user: string, activityId: string) {
    const access = await this.activities.access(tx, user)
    const a = await this.activities.row(tx, activityId)
    if (!a || !this.activities.visible(access, a)) throw missing()
    const canReview =
      this.activities.owns(access, a) ||
      (!!a.delegatedClub && access.leaderClubs.includes(a.delegatedClub.id))
    return { a, access, canReview, owner: this.activities.owns(access, a) }
  }
  private async audit(
    tx: Tx,
    actor: SubmissionActor,
    action: string,
    id: string,
    metadata: Record<string, unknown>,
  ) {
    await tx`INSERT INTO audit_logs(actor_type,actor_user_id,actor_username,action,resource_type,resource_id,outcome,request_id,ip_address,user_agent,metadata)
      SELECT 'USER',id,username,${action},'activity_attendance',${id},'SUCCESS',${actor.requestId},${actor.ipAddress},${actor.userAgent},${tx.json(metadata as never)}
      FROM users WHERE id=${actor.userId}`
  }
  private async mineView(tx: Tx, user: string, activityId: string): Promise<MyAttendance> {
    const [v] = await tx<MyAttendance[]>`
      SELECT ${activityId}::uuid AS "activityId",t.status,${tx.unsafe(iso('t.capture_expires_at'))} AS "captureExpiresAt",t.review_note AS "reviewNote",c.code AS "certificateCode"
      FROM (SELECT 1) one LEFT JOIN activity_attendances t ON t.activity_id=${activityId} AND t.student_user_id=${user}
      LEFT JOIN activity_certificates c ON c.attendance_id=t.id AND c.status='ISSUED'`
    return v!
  }

  async mine(user: string, activityId: string) {
    return this.db.begin('isolation level repeatable read, read only', (tx) =>
      this.mineView(tx, user, activityId),
    )
  }

  async scan(actor: SubmissionActor, activityId: string, code: string) {
    return this.db.begin(async (tx) => {
      const a = await this.lock(tx, activityId)
      const [reg] = await tx<{ id: string; status: string }[]>`
        SELECT id,status FROM activity_registrations WHERE activity_id=${activityId} AND student_user_id=${actor.userId} FOR UPDATE`
      const [eligible] = await tx<
        { ok: boolean }[]
      >`SELECT activity_student_eligible(${actor.userId}::uuid,${activityId}::uuid) AS ok`
      if (!reg || !eligible?.ok) throw missing()
      if (!verifyCheckinCode(a.secret, a.rotating, code))
        throw fail(
          400,
          'INVALID_CHECKIN_CODE',
          'Mã QR không đúng hoặc đã hết hạn. Hãy quét lại mã tại hội trường.',
        )
      const now = Date.now()
      if (a.status !== 'PUBLISHED' || now < a.startsMs || now > a.endsMs)
        throw fail(409, 'ACTIVITY_CHECKIN_CLOSED', 'Chỉ điểm danh trong giờ diễn ra hoạt động.')
      if (reg.status !== 'REGISTERED')
        throw fail(
          409,
          'ACTIVITY_NOT_REGISTERED',
          'Chỉ người đang có chỗ trong hoạt động được điểm danh.',
        )
      const [existing] = await tx<{ id: string; status: string; expired: boolean }[]>`
        SELECT id,status,capture_expires_at<=clock_timestamp() AS expired FROM activity_attendances
        WHERE activity_id=${activityId} AND student_user_id=${actor.userId} FOR UPDATE`
      const expires = new Date(now + captureWindowMs).toISOString()
      if (!existing)
        await tx`INSERT INTO activity_attendances(activity_id,student_user_id,registration_id,status,scanned_at,capture_expires_at)
          VALUES(${activityId},${actor.userId},${reg.id},'SCANNED',clock_timestamp(),${expires})`
      else if (existing.status !== 'SCANNED')
        throw conflict('Bạn đã gửi ảnh điểm danh cho hoạt động này.')
      else if (existing.expired)
        // ADR 0032 assumption: an expired capture session without a photo may be retried.
        await tx`UPDATE activity_attendances SET scanned_at=clock_timestamp(),capture_expires_at=${expires},revision=revision+1,updated_at=clock_timestamp() WHERE id=${existing.id}`
      return this.mineView(tx, actor.userId, activityId)
    })
  }

  async submitPhoto(actor: SubmissionActor, activityId: string, upload: Buffer) {
    const bytes = stripJpegMetadata(upload)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const key = await this.storage.put(bytes)
    try {
      return await this.db.begin(async (tx) => {
        await this.lock(tx, activityId)
        const [t] = await tx<{ id: string; status: string; expired: boolean }[]>`
          SELECT id,status,capture_expires_at<=clock_timestamp() AS expired FROM activity_attendances
          WHERE activity_id=${activityId} AND student_user_id=${actor.userId} FOR UPDATE`
        if (!t) throw conflict('Hãy quét mã QR trước khi chụp ảnh.')
        if (t.status !== 'SCANNED') throw conflict('Bạn đã gửi ảnh điểm danh cho hoạt động này.')
        if (t.expired)
          throw fail(409, 'ACTIVITY_CHECKIN_EXPIRED', 'Đã hết thời gian chụp. Hãy quét lại mã QR.')
        await tx`UPDATE activity_attendances SET status='PENDING_REVIEW',photo_storage_key=${key},photo_sha256=${sha256},photo_size=${bytes.length},
          submitted_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp() WHERE id=${t.id}`
        return this.mineView(tx, actor.userId, activityId)
      })
    } catch (e) {
      await this.storage.remove(key).catch(() => {})
      throw e
    }
  }

  async queue(user: string, activityId: string) {
    return this.db.begin('isolation level repeatable read, read only', async (tx) => {
      const { canReview, access } = await this.staff(tx, user, activityId)
      const items = await tx<AttendanceEntry[]>`
        SELECT t.id,t.student_user_id AS "studentUserId",sp.student_code AS "studentCode",u.full_name AS "fullName",c.code AS "classCode",t.status,
          ${tx.unsafe(iso('t.scanned_at'))} AS "scannedAt",${tx.unsafe(iso('t.submitted_at'))} AS "submittedAt",${tx.unsafe(iso('t.reviewed_at'))} AS "reviewedAt",
          ru.username AS reviewer,t.review_note AS "reviewNote",(t.photo_storage_key IS NOT NULL) AS "hasPhoto",
          CASE WHEN ce.id IS NULL THEN NULL ELSE jsonb_build_object('id',ce.id,'code',ce.code,'status',ce.status,'revokeReason',ce.revoke_reason) END AS certificate,
          t.revision
        FROM activity_attendances t JOIN users u ON u.id=t.student_user_id
        LEFT JOIN student_profiles sp ON sp.user_id=t.student_user_id LEFT JOIN academic_classes c ON c.id=sp.class_id
        LEFT JOIN users ru ON ru.id=t.reviewed_by_user_id LEFT JOIN activity_certificates ce ON ce.attendance_id=t.id
        WHERE t.activity_id=${activityId} AND t.status<>'SCANNED'
        ORDER BY CASE t.status WHEN 'PENDING_REVIEW' THEN 0 ELSE 1 END,t.submitted_at,t.id LIMIT 5001`
      const count = (s: AttendanceStatus) => items.filter((i) => i.status === s).length
      return {
        canReview,
        canRevoke: access.moderate,
        summary: {
          pending: count('PENDING_REVIEW'),
          approved: count('APPROVED'),
          rejected: count('REJECTED'),
        },
        items: items.slice(0, 5000),
        truncated: items.length > 5000,
      }
    })
  }

  async photo(actor: SubmissionActor, activityId: string, attendanceId: string) {
    const meta = await this.db.begin(async (tx) => {
      const { canReview, access } = await this.staff(tx, actor.userId, activityId)
      if (!canReview && !access.moderate) throw missing()
      const [t] = await tx<{ key: string | null; sha256: string }[]>`
        SELECT photo_storage_key AS key,photo_sha256 AS sha256 FROM activity_attendances WHERE id=${attendanceId} AND activity_id=${activityId}`
      if (!t?.key) throw fail(404, 'ACTIVITY_PHOTO_NOT_FOUND', 'Ảnh không còn được lưu.')
      await this.audit(tx, actor, 'activity.attendance.photo_viewed', attendanceId, { activityId })
      return t as { key: string; sha256: string }
    })
    const bytes = await this.storage.read(meta.key)
    if (createHash('sha256').update(bytes).digest('hex') !== meta.sha256)
      throw fail(409, 'ACTIVITY_PHOTO_INTEGRITY', 'Ảnh lưu trữ không khớp mã kiểm tra.')
    return { bytes, name: 'attendance.jpg', mimeType: 'image/jpeg' }
  }

  async review(
    actor: SubmissionActor,
    activityId: string,
    entries: { id: string; revision: number }[],
    approve: boolean,
    note: string | null,
  ) {
    if (
      !entries.length ||
      entries.length > 100 ||
      new Set(entries.map((e) => e.id)).size !== entries.length
    )
      throw fail(400, 'INVALID_ACTIVITY', 'Chọn từ 1 đến 100 lượt khác nhau.')
    if (!approve && !note)
      throw fail(400, 'INVALID_ACTIVITY', 'Từ chối lượt tham gia phải ghi lý do.')
    await this.db.begin(async (tx) => {
      await this.activities.lockRights(tx)
      await this.lock(tx, activityId)
      const { canReview, a } = await this.staff(tx, actor.userId, activityId)
      if (!canReview)
        throw fail(
          403,
          'ACTIVITY_FORBIDDEN',
          'Chỉ chủ hoạt động hoặc CLB được giao duyệt lượt tham gia.',
        )
      for (const e of entries) {
        const [t] = await tx<
          {
            id: string
            status: string
            studentUserId: string
            revision: number
            studentCode: string | null
          }[]
        >`
          SELECT t.id,t.status,t.student_user_id AS "studentUserId",t.revision,sp.student_code AS "studentCode" FROM activity_attendances t
          LEFT JOIN student_profiles sp ON sp.user_id=t.student_user_id WHERE t.id=${e.id} AND t.activity_id=${activityId} FOR UPDATE OF t`
        if (!t) throw missing()
        if (t.studentUserId === actor.userId)
          throw fail(
            403,
            'ACTIVITY_SELF_DECISION',
            'Không được tự duyệt lượt tham gia của chính mình.',
          )
        if (t.status !== 'PENDING_REVIEW' || t.revision !== e.revision) throw conflict()
        await tx`UPDATE activity_attendances SET status=${approve ? 'APPROVED' : 'REJECTED'},reviewed_by_user_id=${actor.userId},reviewed_at=clock_timestamp(),
          review_note=${note},revision=revision+1,updated_at=clock_timestamp() WHERE id=${t.id}`
        if (approve) {
          const certificate = newCertificateCode(),
            issuedAt = new Date().toISOString()
          // Canonical payload: fixed key order, hashed once and stored with the certificate.
          const payload = JSON.stringify({
            version: 1,
            code: certificate,
            activityId,
            activityTitle: a.title,
            activityStartsAt: a.startsAt,
            studentUserId: t.studentUserId,
            studentCode: t.studentCode,
            attendanceId: t.id,
            issuedByUserId: actor.userId,
            issuedAt,
            technicalSignatureStatus: 'NOT_VERIFIED',
            legalEffect: false,
          })
          await tx`INSERT INTO activity_certificates(code,activity_id,student_user_id,attendance_id,issued_by_user_id,issued_at,payload_sha256)
            VALUES(${certificate},${activityId},${t.studentUserId},${t.id},${actor.userId},${issuedAt},${createHash('sha256').update(payload).digest('hex')})`
        }
        await this.audit(
          tx,
          actor,
          approve ? 'activity.attendance.approved' : 'activity.attendance.rejected',
          t.id,
          {
            activityId,
            batchSize: entries.length,
          },
        )
      }
    })
    return this.queue(actor.userId, activityId)
  }

  async revoke(actor: SubmissionActor, certificateId: string, reason: string) {
    return this.db.begin(async (tx) => {
      await this.activities.lockRights(tx)
      const access = await this.activities.access(tx, actor.userId)
      if (!access.moderate) throw fail(403, 'ACTIVITY_FORBIDDEN', 'Chỉ CTSV thu hồi chứng nhận.')
      const [c] = await tx<{ id: string; status: string; activityId: string }[]>`
        SELECT id,status,activity_id AS "activityId" FROM activity_certificates WHERE id=${certificateId} FOR UPDATE`
      if (!c) throw fail(404, 'ACTIVITY_CERTIFICATE_NOT_FOUND', 'Không tìm thấy chứng nhận.')
      if (c.status !== 'ISSUED') throw conflict('Chứng nhận đã bị thu hồi.')
      await tx`UPDATE activity_certificates SET status='REVOKED',revoked_by_user_id=${actor.userId},revoked_at=clock_timestamp(),revoke_reason=${reason} WHERE id=${c.id}`
      await tx`INSERT INTO audit_logs(actor_type,actor_user_id,actor_username,action,resource_type,resource_id,outcome,request_id,ip_address,user_agent,metadata)
        SELECT 'USER',id,username,'activity.certificate.revoked','activity_certificate',${c.id},'SUCCESS',${actor.requestId},${actor.ipAddress},${actor.userAgent},${tx.json({ activityId: c.activityId, reason })}
        FROM users WHERE id=${actor.userId}`
      return { activityId: c.activityId }
    })
  }

  async certificates(user: string) {
    return this.db.begin('isolation level repeatable read, read only', async (tx) => {
      const items = await tx<Certificate[]>`
        SELECT c.id,c.code,c.activity_id AS "activityId",a.title AS "activityTitle",${tx.unsafe(iso('a.starts_at'))} AS "activityStartsAt",
          ${tx.unsafe(iso('c.issued_at'))} AS "issuedAt",u.username AS "issuedBy",c.payload_sha256 AS "payloadSha256",c.status,
          ${tx.unsafe(iso('c.revoked_at'))} AS "revokedAt",c.revoke_reason AS "revokeReason",c.technical_signature_status AS "technicalSignatureStatus",c.legal_effect AS "legalEffect"
        FROM activity_certificates c JOIN activities a ON a.id=c.activity_id JOIN users u ON u.id=c.issued_by_user_id
        WHERE c.student_user_id=${user} ORDER BY c.issued_at DESC,c.id LIMIT 500`
      return { items }
    })
  }

  /** Printable QR (static) or the current on-screen code (rotating), as SVG. Never exposes the secret. */
  async qr(user: string, activityId: string) {
    const { secret, rotating } = await this.db.begin(
      'isolation level repeatable read, read only',
      async (tx) => {
        const { canReview } = await this.staff(tx, user, activityId)
        if (!canReview) throw missing()
        const [a] = await tx<{ secret: string; rotating: boolean }[]>`
        SELECT checkin_secret AS secret,rotating_qr AS rotating FROM activities WHERE id=${activityId}`
        return a!
      },
    )
    const code = rotating ? rotatingCheckinCode(secret) : staticCheckinCode(secret)
    const url = env.corsOrigin + '/activities/' + activityId + '/check-in?code=' + code
    return {
      svg: await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 2 }),
      rotating,
    }
  }

  /** Owner only: new secret (all QR codes invalid) or switching static/rotating mode. */
  async configureCheckin(
    actor: SubmissionActor,
    activityId: string,
    expectedRevision: number,
    change: { reset: true } | { rotating: boolean },
  ) {
    await this.db.begin(async (tx) => {
      await this.activities.lockRights(tx)
      const a = await this.lock(tx, activityId)
      const { owner } = await this.staff(tx, actor.userId, activityId)
      if (!owner) throw fail(403, 'ACTIVITY_FORBIDDEN', 'Chỉ chủ hoạt động đổi cách điểm danh.')
      if (a.revision !== expectedRevision || a.status === 'CANCELLED') throw conflict()
      const reset = 'reset' in change
      if (!reset && change.rotating === a.rotating) throw conflict()
      if (reset)
        await tx`UPDATE activities SET checkin_secret=${newCheckinSecret()},revision=revision+1,updated_at=clock_timestamp() WHERE id=${activityId}`
      else
        await tx`UPDATE activities SET rotating_qr=${change.rotating},revision=revision+1,updated_at=clock_timestamp() WHERE id=${activityId}`
      const action = reset ? 'CHECKIN_RESET' : 'CHECKIN_MODE_CHANGED'
      await tx`INSERT INTO activity_events(activity_id,revision,action,actor_user_id,before,after)
        VALUES(${activityId},${a.revision + 1},${action},${actor.userId},${reset ? null : tx.json({ rotating: a.rotating })},${reset ? null : tx.json({ rotating: !a.rotating })})`
      await tx`INSERT INTO audit_logs(actor_type,actor_user_id,actor_username,action,resource_type,resource_id,outcome,request_id,ip_address,user_agent,metadata)
        SELECT 'USER',id,username,${'activity.' + action.toLowerCase()},'activity',${activityId},'SUCCESS',${actor.requestId},${actor.ipAddress},${actor.userAgent},${tx.json({ activityId })}
        FROM users WHERE id=${actor.userId}`
    })
    return this.activities.detail(actor.userId, activityId)
  }

  /** Deletes photo bytes of activities that ended more than the retention period ago. */
  async purgeExpiredPhotos(limit = 500) {
    const rows = await this.db<{ id: string; key: string }[]>`
      SELECT t.id,t.photo_storage_key AS key FROM activity_attendances t JOIN activities a ON a.id=t.activity_id
      WHERE t.photo_storage_key IS NOT NULL AND a.ends_at < clock_timestamp() - make_interval(days => ${activityPhotoRetentionDays})
      ORDER BY a.ends_at,t.id LIMIT ${limit}`
    let removed = 0
    for (const r of rows) {
      await this.storage.remove(r.key)
      const done = await this
        .db`UPDATE activity_attendances SET photo_storage_key=NULL,photo_deleted_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp()
        WHERE id=${r.id} AND photo_storage_key=${r.key}`
      removed += done.count
    }
    return { removed }
  }
}
