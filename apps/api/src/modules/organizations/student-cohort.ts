/**
 * Niên khóa rule of the Học viện (owner decision, 02/11/2026): K = admission year − 2006,
 * e.g. admission 2021 → K15. The database stores the admission year (ADR 0025).
 */
export const COHORT_BASE_YEAR = 2006
export const MIN_COHORT_YEAR = COHORT_BASE_YEAR + 1
export const MAX_COHORT_YEAR = 2100

export function cohortLabel(admissionYear: number): string {
  return `K${admissionYear - COHORT_BASE_YEAR}`
}

/**
 * Accepts "K15", "15" or the admission year "2021" (numbers from Excel too).
 * Returns null for anything else, including "K2021", which could mean either reading.
 */
export function parseCohortValue(value: number | string): number | null {
  let year: number
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) return null
    year = value < 100 ? COHORT_BASE_YEAR + value : value
  } else {
    const text = value.trim()
    const short = /^[Kk]?(\d{1,2})$/.exec(text)
    if (short) year = COHORT_BASE_YEAR + Number(short[1])
    else if (/^\d{4}$/.test(text)) year = Number(text)
    else return null
  }
  return year >= MIN_COHORT_YEAR && year <= MAX_COHORT_YEAR ? year : null
}
