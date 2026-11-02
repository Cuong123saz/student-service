/**
 * Niên khóa of the Học viện: K = admission year − 2006 (2021 → K15). The API returns the
 * admission year (ADR 0025); keep this base year in sync with apps/api student-cohort.ts.
 */
export const COHORT_BASE_YEAR = 2006

export function formatCohort(admissionYear: number | null | undefined): string {
  return typeof admissionYear === 'number' ? `K${admissionYear - COHORT_BASE_YEAR}` : 'Chưa có'
}

/**
 * Parses a comma/space separated list such as "K15, K16" or "15 16" into admission years.
 * Returns null when any item is not a valid niên khóa (K1–K94, i.e. 2007–2100).
 */
export function parseCohortList(text: string): number[] | null {
  const items = text
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  const years: number[] = []
  for (const item of items) {
    const m = /^[Kk]?(\d{1,2})$/.exec(item)
    const k = m ? Number(m[1]) : NaN
    if (!Number.isInteger(k) || k < 1 || k > 94) return null
    if (!years.includes(k + COHORT_BASE_YEAR)) years.push(k + COHORT_BASE_YEAR)
  }
  return years.sort((a, b) => a - b)
}
