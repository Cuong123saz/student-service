import type { AuditMetadataValue, AuditState } from '../types/audit-log'

const SENSITIVE_FIELD_PATTERN = /(password|token|secret|hash|stack|cookie)/i

/**
 * Lớp che chắn cuối ở UI. Backend vẫn phải tránh ghi
 * dữ liệu nhạy cảm vào audit log ngay từ đầu.
 *
 * Chỉ xét tên field, không suy đoán dựa trên giá trị.
 */
export function sanitizeAuditState(state: AuditState | null): AuditState | null {
  if (state === null) {
    return null
  }

  return Object.fromEntries(
    Object.entries(state).map(([key, value]): [string, AuditMetadataValue] => [
      key,
      SENSITIVE_FIELD_PATTERN.test(key) ? '***' : value,
    ]),
  )
}

export function formatAuditValue(value: AuditMetadataValue): string {
  if (value === null) {
    return 'null'
  }

  if (Array.isArray(value)) {
    return value.join(', ')
  }

  return String(value)
}
