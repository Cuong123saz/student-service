import type { TrainingAnswers, TrainingCriterion, TrainingError } from '~/types/training-point'
export const trainingStatuses = { DRAFT: 'Bản nháp', OPEN: 'Đã mở', CLOSED: 'Đã đóng' }
export const trainingActions: Record<string, string> = {
  CREATED: 'Tạo bản kê khai',
  SAVED: 'Lưu bản nháp',
  FILE_ADDED: 'Thêm minh chứng',
  FILE_REMOVED: 'Gỡ minh chứng',
  SUBMITTED: 'Nộp bản kê khai',
}
export function trainingDate(value: string) {
  return new Date(value).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })
}
export function trainingIssues(
  answers: TrainingAnswers,
  criteria: TrainingCriterion[],
  files: { criterion: string }[],
) {
  const issues: { path: string; message: string }[] = []
  for (const c of criteria) {
    const a = answers[c.code]
    if (
      !a ||
      a.points === null ||
      !Number.isInteger(a.points) ||
      a.points < 0 ||
      a.points > c.maxPoints
    )
      issues.push({ path: c.code, message: 'Nhập điểm nguyên từ 0 đến ' + c.maxPoints + '.' })
    else if (a.points > 0 && !a.note.trim())
      issues.push({ path: c.code, message: 'Bổ sung giải trình cho điểm tự kê khai.' })
    else if (a.points > 0 && c.evidenceRequired && !files.some((f) => f.criterion === c.code))
      issues.push({ path: c.code, message: 'Bổ sung minh chứng cho nhóm này.' })
  }
  return issues
}
export function trainingError(error: unknown): TrainingError {
  const e = error as {
    statusCode?: number
    response?: { status?: number }
    data?: { message?: string; issues?: TrainingError['issues'] }
  }
  const status = e?.statusCode ?? e?.response?.status
  return {
    status,
    message:
      status === 401
        ? 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
        : status === 403
          ? 'Tài khoản hiện không có quyền sử dụng chức năng trong phạm vi này.'
          : (e?.data?.message ??
            'Chưa kết nối được máy chủ. Tải lại trạng thái trước khi tiếp tục.'),
    issues: Array.isArray(e?.data?.issues) ? e.data.issues : [],
  }
}

// File downloads use Blob responses even when the API returns a small JSON error.
export async function trainingFetchError(error: unknown): Promise<TrainingError> {
  const e = error as { statusCode?: number; response?: { status?: number }; data?: unknown }
  if (
    typeof Blob !== 'undefined' &&
    e?.data instanceof Blob &&
    e.data.size <= 16384 &&
    e.data.type.toLowerCase().includes('application/json')
  ) {
    try {
      const data: unknown = JSON.parse(await e.data.text())
      return trainingError({ statusCode: e.statusCode, response: e.response, data })
    } catch {
      /* Preserve the safe fallback when a bounded error body cannot be decoded. */
    }
  }
  return trainingError(error)
}
