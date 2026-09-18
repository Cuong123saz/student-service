import { createHash, randomBytes } from 'node:crypto'

export interface GeneratedActionToken {
  rawToken: string
  tokenHash: string
}

export function hashActionToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex')
}

/**
 * Tạo token một lần dùng cho các hành động nhạy cảm.
 *
 * SECURITY:
 * - Chỉ tokenHash được phép lưu vào database.
 * - rawToken chỉ được dùng để tạo đường dẫn gửi cho người dùng.
 * - Không ghi rawToken vào log.
 */
export function generateActionToken(): GeneratedActionToken {
  const rawToken = randomBytes(32).toString('base64url')

  return {
    rawToken,
    tokenHash: hashActionToken(rawToken),
  }
}
