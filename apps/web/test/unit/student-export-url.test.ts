import { describe, expect, it } from 'vitest'

import { buildStudentExportUrl } from '../../app/utils/student-export-url'

describe('buildStudentExportUrl', () => {
  it('giữ đúng bộ lọc đã áp dụng và encode giá trị tìm kiếm', () => {
    expect(
      buildStudentExportUrl('http://api.test', {
        search: 'Nguyễn Văn A',
        status: 'ACTIVE',
        facultyId: 'faculty-id',
        classId: 'class-id',
      }),
    ).toBe(
      'http://api.test/api/v1/admin/students/export.xlsx?search=Nguy%E1%BB%85n+V%C4%83n+A&status=ACTIVE&facultyId=faculty-id&classId=class-id',
    )
  })

  it('không thêm query string khi chưa áp dụng bộ lọc', () => {
    expect(buildStudentExportUrl('http://api.test', {})).toBe(
      'http://api.test/api/v1/admin/students/export.xlsx',
    )
  })
})
