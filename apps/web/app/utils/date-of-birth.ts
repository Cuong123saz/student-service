/** ADR 0027: date of birth arrives as yyyy-mm-dd; shown as dd/mm/yyyy, never guessed. */
export function formatDateOfBirth(value: string | null | undefined): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}`
    : 'Chưa có'
}
