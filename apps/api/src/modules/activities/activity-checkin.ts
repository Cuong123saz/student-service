import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/** ADR 0032: rotating codes change every 30 seconds; the previous window is still accepted. */
export const rotatingWindowMs = 30_000
/** Photo capture session opened by a successful scan. */
export const captureWindowMs = 3 * 60_000

const code = (secret: string, label: string) =>
  createHmac('sha256', secret).update(label).digest('base64url').slice(0, 32)

export const staticCheckinCode = (secret: string) => code(secret, 'static')
export const rotatingCheckinCode = (secret: string, now = Date.now()) =>
  code(secret, 'window:' + Math.floor(now / rotatingWindowMs))

const same = (a: string, b: string) => {
  const x = Buffer.from(a),
    y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}
/** Static mode accepts only the printed code; rotating mode only the current or previous window. */
export function verifyCheckinCode(
  secret: string,
  rotating: boolean,
  given: string,
  now = Date.now(),
) {
  if (!/^[A-Za-z0-9_-]{32}$/.test(given)) return false
  if (!rotating) return same(given, staticCheckinCode(secret))
  return (
    same(given, rotatingCheckinCode(secret, now)) ||
    same(given, rotatingCheckinCode(secret, now - rotatingWindowMs))
  )
}
export const newCheckinSecret = () => randomBytes(32).toString('hex')

const base32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
/** Certificate code `CN-` + 12 base32 characters (60 random bits). */
export function newCertificateCode() {
  const bytes = randomBytes(8)
  let bits = 0,
    value = 0,
    out = ''
  for (const b of bytes) {
    value = (value << 8) | b
    bits += 8
    while (bits >= 5 && out.length < 12) {
      out += base32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  return 'CN-' + out
}
