import { createHash } from 'node:crypto'
import { SubmissionError, type ReviewQueueQuery } from './submission.types.js'

export function queueFilters(query: ReviewQueueQuery = {}) {
  const q = (query.q ?? '').trim()
  const assignment = query.assignment ?? 'ALL'
  if (
    q.length > 100 ||
    !['ALL', 'MINE', 'UNASSIGNED'].includes(assignment) ||
    (query.status &&
      !['SUBMITTED', 'IN_REVIEW', 'NEEDS_SUPPLEMENT', 'APPROVED', 'REJECTED'].includes(
        query.status,
      ))
  )
    throw new SubmissionError(
      400,
      'INVALID_FILTER',
      'Bộ lọc không hợp lệ. Nhập tối đa100 ký tự tìm kiếm.',
    )
  return { status: query.status, assignment, q }
}
export function queueFingerprint(userId: string, filters: ReturnType<typeof queueFilters>) {
  return createHash('sha256')
    .update(JSON.stringify([userId, filters.status ?? null, filters.assignment, filters.q]))
    .digest('hex')
}
export function queueCursor(raw: string | undefined, fingerprint: string): [string, string] | null {
  if (!raw) return null
  try {
    if (raw.length > 300 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error()
    const value: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    if (!Array.isArray(value) || value.length !== 3 || value.some((v) => typeof v !== 'string'))
      throw new Error()
    const [time, id, scope] = value as [string, string, string]
    if (
      scope !== fingerprint ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(time) ||
      !Number.isFinite(Date.parse(time)) ||
      new Date(time).toISOString().slice(0, 19) !== time.slice(0, 19) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    )
      throw new Error()
    return [time, id]
  } catch {
    throw new SubmissionError(
      400,
      'INVALID_CURSOR',
      'Mốc tải thêm không hợp lệ hoặc bộ lọc đã đổi. Hãy tải lại hàng đợi.',
    )
  }
}
// Search treats SQL LIKE metacharacters as ordinary input.
export function queueSearch(q: string) {
  return '%' + q.replace(/[\\%_]/g, '\\$&') + '%'
}
