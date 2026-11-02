/** ADR 0025: cohort (niên khóa) is stored as its start year; null/absent means unknown. */
export function formatCohort(cohortYear: number | null | undefined): string {
  return typeof cohortYear === 'number' ? `K${cohortYear}` : 'Chưa có'
}
