import type { ReviewAction, ReviewState, ReviewDecision } from '~/types/training-review'
export const reviewLabels: Record<ReviewState, string> = {
  WAITING_MONITOR: 'Chờ lớp trưởng',
  WAITING_ADVISOR: 'Chờ cố vấn',
  WAITING_FACULTY: 'Chờ khoa',
  RETURNED_TO_ADVISOR: 'Khoa trả về cố vấn',
  APPROVED: 'Khoa đã duyệt',
}
export const reviewActions: Record<ReviewDecision['action'], string> = {
  MONITOR_CONFIRMED: 'Lớp trưởng xác nhận',
  MONITOR_BYPASSED: 'Cố vấn bỏ qua bước lớp trưởng',
  ADVISOR_SIGNED: 'Cố vấn xác nhận',
  FACULTY_RETURNED: 'Khoa trả về cố vấn',
  FACULTY_APPROVED: 'Khoa duyệt',
}

/** Button/confirmation labels and the success message for each review action. */
export const reviewActionLabels: Record<ReviewAction, { label: string; done: string }> = {
  'monitor-confirm': { label: 'Lớp trưởng xác nhận', done: 'xác nhận của lớp trưởng' },
  'monitor-bypass': { label: 'Bỏ qua bước lớp trưởng', done: 'bỏ qua bước lớp trưởng' },
  'advisor-sign': { label: 'Xác nhận cố vấn', done: 'xác nhận cố vấn' },
  'faculty-approve': { label: 'Duyệt của khoa', done: 'duyệt của khoa' },
  'faculty-return': { label: 'Trả về cố vấn', done: 'trả về cố vấn' },
}
