import type { ProcedureField } from '~/types/procedure'
import type { DraftValues, SubmissionStatus } from '~/types/submission'

export const submissionStatusLabels: Record<SubmissionStatus, string> = {
  DRAFT: 'Bản nháp · Chưa gửi',
  SUBMITTED: 'Đã gửi · Chờ tiếp nhận',
  IN_REVIEW: 'Đang xử lý',
  NEEDS_SUPPLEMENT: 'Chờ bổ sung',
  APPROVED: 'Đã duyệt nội dung',
  REJECTED: 'Không chấp thuận',
}
export const resolutionActionLabels = {
  REQUEST_SUPPLEMENT: 'Yêu cầu bổ sung',
  APPROVE: 'Đã duyệt nội dung',
  REJECT: 'Không chấp thuận',
} as const
export const submissionEventLabels = {
  SUBMITTED: 'Sinh viên gửi hồ sơ',
  CLAIMED: 'Cán bộ nhận xử lý',
  REASSIGNED: 'Bàn giao cán bộ xử lý',
  SUPPLEMENT_REQUESTED: 'Yêu cầu bổ sung',
  RESUBMITTED: 'Sinh viên gửi bổ sung',
  APPROVED: 'Đã duyệt nội dung',
  REJECTED: 'Không chấp thuận',
} as const
export function formatSubmissionTime(value: string | null) {
  return value ? new Date(value).toLocaleString('vi-VN') : 'Chưa có'
}
export function formatSubmissionAnswer(field: ProcedureField, values: DraftValues) {
  const value = values[field.key]
  if (value === null || value === undefined || value === '') return 'Chưa điền'
  if (field.type === 'BOOLEAN') return value ? 'Có' : 'Không'
  if (field.type === 'DATE') return String(value).split('-').reverse().join('/')
  if (field.type === 'SELECT')
    return field.options.find((option) => option.value === value)?.label ?? String(value)
  return String(value)
}
export function submissionIssueAnchor(path: string) {
  const key = path.split('.').at(-1)
  return path.startsWith('attachments.') ? '#attachment-' + key : '#field-' + key
}

// Keep configured limits exact, including small or non-round byte limits.
export function formatSubmissionBytes(bytes: number) {
  if (bytes >= 1048576 && bytes % 1048576 === 0) return `${bytes / 1048576} MiB`
  if (bytes >= 1024 && bytes % 1024 === 0) return `${bytes / 1024} KiB`
  return `${bytes.toLocaleString('vi-VN')} byte`
}
