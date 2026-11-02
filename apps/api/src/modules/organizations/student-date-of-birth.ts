/**
 * ADR 0027: date of birth is personal data. Values are ISO dates (yyyy-mm-dd) internally and
 * dd/mm/yyyy for people; text is always read day-first (Vietnamese convention).
 */
export const MIN_DATE_OF_BIRTH = '1940-01-01'

function iso(year: number, month: number, day: number): string | null {
  const d = new Date(Date.UTC(year, month - 1, day))
  // Rejects impossible dates such as 30/02 that Date would silently roll over.
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day)
    return null
  return d.toISOString().slice(0, 10)
}

/**
 * Accepts an Excel date cell (read as 00:00 UTC — its UTC date is used), "dd/mm/yyyy",
 * "d/m/yyyy" or "yyyy-mm-dd". Plain numbers are rejected: an unformatted serial is not
 * reliably a date. Returns null when invalid, in the future or before 1940.
 */
export function parseDateOfBirth(value: Date | string | number, today = new Date()): string | null {
  let result: string | null = null
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return null
    result = iso(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate())
  } else if (typeof value === 'string') {
    const text = value.trim()
    const vn = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text)
    const isoText = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
    if (vn) result = iso(Number(vn[3]), Number(vn[2]), Number(vn[1]))
    else if (isoText) result = iso(Number(isoText[1]), Number(isoText[2]), Number(isoText[3]))
  }
  if (result === null) return null
  const todayIso = today.toISOString().slice(0, 10)
  return result >= MIN_DATE_OF_BIRTH && result <= todayIso ? result : null
}

export function formatDateOfBirth(value: string | null | undefined): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return ''
  return `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}`
}
