/**
 * Thông tin an toàn mà frontend cần giữ lại
 * để xử lý lỗi và hỗ trợ truy vết.
 *
 * Không đưa raw stack hoặc lỗi database vào đây.
 */
export interface ApiErrorContext {
  status?: number
  code?: string
  requestId?: string
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === 'object'
    && value !== null
  )
}

function readNumber(
  source: Record<string, unknown> | undefined,
  property: string,
): number | undefined {
  const value = source?.[property]

  return typeof value === 'number'
    ? value
    : undefined
}

function readString(
  source: Record<string, unknown> | undefined,
  property: string,
): string | undefined {
  const value = source?.[property]

  return typeof value === 'string'
    ? value
    : undefined
}

/**
 * Chuẩn hóa lỗi do Nuxt $fetch/ofetch trả về.
 *
 * Hàm hỗ trợ cả response mới:
 * {
 *   message,
 *   error: { code, requestId }
 * }
 *
 * Và response cũ:
 * {
 *   message
 * }
 */
export function getApiErrorContext(
  error: unknown,
): ApiErrorContext {
  if (!isRecord(error)) {
    return {}
  }

  const response = isRecord(error.response)
    ? error.response
    : undefined

  const body = isRecord(error.data)
    ? error.data
    : isRecord(response?._data)
      ? response._data
      : undefined

  const details = isRecord(body?.error)
    ? body.error
    : undefined

  return {
    status:
      readNumber(error, 'statusCode')
      ?? readNumber(error, 'status')
      ?? readNumber(response, 'status'),

    // Ưu tiên structured error mới, nhưng vẫn
    // hỗ trợ code phẳng nếu API cũ có sử dụng.
    code:
      readString(details, 'code')
      ?? readString(body, 'code'),

    requestId:
      readString(details, 'requestId')
      ?? readString(body, 'requestId'),
  }
}