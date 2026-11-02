/**
 * Niên khóa of the Học viện: K = admission year − 2006 (2021 → K15). The API returns the
 * admission year (ADR 0025); keep this base year in sync with apps/api student-cohort.ts.
 */
export const COHORT_BASE_YEAR = 2006

export function formatCohort(admissionYear: number | null | undefined): string {
  return typeof admissionYear === 'number' ? `K${admissionYear - COHORT_BASE_YEAR}` : 'Chưa có'
}
