export interface StudentExportFilters {
  search?: string
  status?: string
  facultyId?: string
  classId?: string
}

export function buildStudentExportUrl(apiBase: string, filters: StudentExportFilters): string {
  const params = new URLSearchParams()

  for (const [key, value] of Object.entries(filters)) {
    if (value) {
      params.set(key, value)
    }
  }

  const endpoint = `${apiBase}/api/v1/admin/students/export.xlsx`
  const query = params.toString()
  return query ? `${endpoint}?${query}` : endpoint
}
