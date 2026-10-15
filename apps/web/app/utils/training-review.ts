import type { ReviewState, ReviewDecision } from '~/types/training-review'
export const reviewLabels: Record<ReviewState, string> = {
  WAITING_ADVISOR: 'Chờ cố vấn',
  WAITING_FACULTY: 'Chờ khoa',
  RETURNED_TO_ADVISOR: 'Khoa trả về cố vấn',
  APPROVED: 'Khoa đã duyệt',
}
export const reviewActions: Record<ReviewDecision['action'], string> = {
  ADVISOR_SIGNED: 'Cố vấn xác nhận',
  FACULTY_RETURNED: 'Khoa trả về cố vấn',
  FACULTY_APPROVED: 'Khoa duyệt',
}
