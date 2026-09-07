import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readSheet } from 'read-excel-file/node'

import type {
  AuditRecorder,
} from '../audit/audit.service.js'
import type {
  AuditEventInput,
} from '../audit/audit.types.js'
import {
  STUDENT_EXPORT_MAX_ROWS,
  StudentExportService,
  type ListStudentExportInput,
  type StudentExportRecord,
  type StudentExportRepository,
} from './student-export.service.js'

const records: StudentExportRecord[] = [
  {
    username: 'sv001',
    fullName: 'Nguyễn Văn A & <B>',
    email: 'sv001@example.edu.vn',
    status: 'ACTIVE',
    studentCode: '001234',
    classCode: 'K15A',
    className: 'Quản lý giáo dục K15A',
    facultyCode: 'QLGD',
    facultyName: 'Khoa Quản lý giáo dục',
  },
]

class FakeRepository
implements StudentExportRepository {
  receivedInput:
    ListStudentExportInput | undefined

  async listVisibleForExport(
    input: ListStudentExportInput,
  ) {
    this.receivedInput = input
    return records
  }
}

class FakeAuditRecorder
implements AuditRecorder {
  events: AuditEventInput[] = []

  async record(event: AuditEventInput) {
    this.events.push(event)
  }
}

test(
  'export tạo workbook đọc được và ghi audit theo bộ lọc',
  async () => {
    const repository = new FakeRepository()
    const auditRecorder =
      new FakeAuditRecorder()
    const service = new StudentExportService(
      repository,
      auditRecorder,
      () => new Date('2026-09-06T02:03:04.000Z'),
    )

    const result = await service.exportStudents({
      actorUserId:
        '7aecf61b-cfe1-476f-9b65-0b328136381b',
      actorUsername: 'system.admin',
      status: 'ACTIVE',
      search: '  Nguyễn  ',
      audit: {
        requestId: 'request-1',
        ipAddress: '127.0.0.1',
        userAgent: 'student-export-test',
      },
    })

    assert.deepEqual(repository.receivedInput, {
      actorUserId:
        '7aecf61b-cfe1-476f-9b65-0b328136381b',
      maxRows: STUDENT_EXPORT_MAX_ROWS,
      status: 'ACTIVE',
      search: 'Nguyễn',
    })
    assert.equal(
      result.fileName,
      'students-20260906T020304Z.xlsx',
    )
    assert.equal(result.rowCount, 1)
    assert.ok(result.buffer.length > 0)

    const sheet = await readSheet(result.buffer)
    assert.deepEqual(sheet[0], [
      'STT',
      'Mã sinh viên',
      'Họ và tên',
      'Email',
      'Tên đăng nhập',
      'Trạng thái',
      'Mã lớp',
      'Tên lớp',
      'Mã khoa',
      'Tên khoa',
    ])
    assert.deepEqual(sheet[1], [
      '1',
      '001234',
      'Nguyễn Văn A & <B>',
      'sv001@example.edu.vn',
      'sv001',
      'ACTIVE',
      'K15A',
      'Quản lý giáo dục K15A',
      'QLGD',
      'Khoa Quản lý giáo dục',
    ])

    assert.equal(auditRecorder.events.length, 1)
    assert.deepEqual(
      auditRecorder.events[0]?.metadata,
      {
        format: 'XLSX',
        rowCount: 1,
        status: 'ACTIVE',
        facultyId: null,
        classId: null,
        search: 'Nguyễn',
      },
    )
  },
)

test(
  'không trả file nếu audit bắt buộc ghi thất bại',
  async () => {
    const repository = new FakeRepository()
    const auditRecorder: AuditRecorder = {
      async record() {
        throw new Error('audit unavailable')
      },
    }
    const service = new StudentExportService(
      repository,
      auditRecorder,
    )

    await assert.rejects(
      service.exportStudents({
        actorUserId:
          '7aecf61b-cfe1-476f-9b65-0b328136381b',
        actorUsername: 'system.admin',
        audit: {
          requestId: 'request-2',
          ipAddress: '127.0.0.1',
          userAgent: null,
        },
      }),
      /audit unavailable/,
    )
  },
)
