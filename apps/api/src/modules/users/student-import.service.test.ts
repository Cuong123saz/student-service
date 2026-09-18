import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { ParsedStudentImportFile } from './student-import.parser.js'
import {
  InMemoryStudentImportPreviewStore,
  StudentImportDuplicateBlockedError,
  StudentImportService,
  type CommitStudentImportInput,
  type InspectStudentImportInput,
  type InspectStudentImportResult,
  type StudentImportRepository,
} from './student-import.service.js'

const fixedNow = new Date('2026-09-06T00:00:00.000Z')

class FakeStudentImportRepository implements StudentImportRepository {
  inspection: InspectStudentImportResult = {
    classes: [
      {
        id: '67df3a9f-c816-49c6-87c2-c89e42081c98',
        code: 'K15A',
      },
    ],
    existing: [
      {
        username: 'sv900',
        email: 'existing@example.edu.vn',
        studentCode: '900',
      },
    ],
  }

  inspected: InspectStudentImportInput | undefined
  committed: CommitStudentImportInput | undefined

  async inspect(input: InspectStudentImportInput) {
    this.inspected = input
    return this.inspection
  }

  async commit(input: CommitStudentImportInput) {
    this.committed = input
    return {
      imported: input.rows.length,
      updated: 0,
      skipped: input.preSkipped,
    }
  }
}

function createParser(rows: ParsedStudentImportFile['rows']) {
  return async (): Promise<ParsedStudentImportFile> => ({
    format: 'CSV',
    rows,
  })
}

test('preview tách riêng hợp lệ, lỗi, trùng trong file và trùng hệ thống', async () => {
  const repository = new FakeStudentImportRepository()
  const service = new StudentImportService(
    repository,
    new InMemoryStudentImportPreviewStore(),
    createParser([
      {
        sourceRow: 2,
        values: {
          studentCode: '001',
          fullName: 'Nguyễn Văn A',
          email: 'SV001@EXAMPLE.EDU.VN',
          classCode: 'k15a',
        },
      },
      {
        sourceRow: 3,
        values: {
          studentCode: '002',
          fullName: 'Trần Thị B',
          email: null,
          classCode: 'K15A',
        },
      },
      {
        sourceRow: 4,
        values: {
          studentCode: '001',
          fullName: 'Bản ghi lặp',
          email: 'other@example.edu.vn',
          classCode: 'K15A',
        },
      },
      {
        sourceRow: 5,
        values: {
          studentCode: '003',
          fullName: 'Đã tồn tại',
          email: 'existing@example.edu.vn',
          classCode: 'K15A',
        },
      },
      {
        sourceRow: 6,
        values: {
          studentCode: 12.5,
          fullName: 'Sai kiểu dữ liệu',
          email: 'type@example.edu.vn',
          classCode: 'K15A',
        },
      },
      {
        sourceRow: 7,
        values: {
          studentCode: '007',
          fullName: 'Sai lớp',
          email: 'sv007@example.edu.vn',
          classCode: 'UNKNOWN',
        },
      },
    ]),
    () => fixedNow,
  )

  const preview = await service.previewImport({
    actorUserId: 'actor-1',
    fileName: 'students.csv',
    fileBuffer: Buffer.from('ignored'),
  })

  assert.deepEqual(preview.summary, {
    total: 6,
    valid: 1,
    errors: 3,
    duplicates: 2,
  })
  assert.equal(preview.validRecords[0]?.studentCode, '001')
  assert.deepEqual(
    preview.errorRecords.map((row) => row.sourceRow),
    [3, 6, 7],
  )
  assert.deepEqual(preview.errorRecords[0]?.values, {
    studentCode: {
      kind: 'TEXT',
      text: '002',
    },
    fullName: {
      kind: 'TEXT',
      text: 'Trần Thị B',
    },
    email: {
      kind: 'EMPTY',
      text: null,
    },
    classCode: {
      kind: 'TEXT',
      text: 'K15A',
    },
  })
  assert.equal(preview.errorRecords[1]?.issues[0]?.code, 'INVALID_TYPE')
  assert.deepEqual(
    preview.duplicateRecords.map((row) => ({
      sourceRow: row.record.sourceRow,
      sources: row.duplicates.map((duplicate) => duplicate.source),
    })),
    [
      { sourceRow: 4, sources: ['FILE'] },
      { sourceRow: 5, sources: ['SYSTEM'] },
    ],
  )
})

test('mã số nguyên được nhận và snapshot lỗi giữ nguyên text hoặc date', async () => {
  const repository = new FakeStudentImportRepository()
  const service = new StudentImportService(
    repository,
    new InMemoryStudentImportPreviewStore(),
    createParser([
      {
        sourceRow: 2,
        values: {
          studentCode: '0012',
          fullName: 'A',
          email: 'text@example.edu.vn',
          classCode: 'K15A',
        },
      },
      {
        sourceRow: 3,
        values: {
          studentCode: 12,
          fullName: 'Kiểu số',
          email: 'number@example.edu.vn',
          classCode: 'K15A',
        },
      },
      {
        sourceRow: 4,
        values: {
          studentCode: '004',
          fullName: new Date('2024-05-01T00:00:00.000Z'),
          email: 'date@example.edu.vn',
          classCode: 'K15A',
        },
      },
    ]),
    () => fixedNow,
  )

  const preview = await service.previewImport({
    actorUserId: 'actor-1',
    fileName: 'students.xlsx',
    fileBuffer: Buffer.from('ignored'),
  })

  assert.deepEqual(preview.errorRecords[0]?.values.studentCode, {
    kind: 'TEXT',
    text: '0012',
  })
  assert.deepEqual(preview.validRecords[0]?.studentCode, '12')
  assert.deepEqual(preview.errorRecords[1]?.values.fullName, {
    kind: 'DATE',
    text: null,
  })
})

test('confirm FAIL dừng khi preview có bản ghi trùng', async () => {
  const repository = new FakeStudentImportRepository()
  const service = new StudentImportService(
    repository,
    new InMemoryStudentImportPreviewStore(),
    createParser([
      {
        sourceRow: 2,
        values: {
          studentCode: '900',
          fullName: 'Sinh viên cũ',
          email: 'existing@example.edu.vn',
          classCode: 'K15A',
        },
      },
    ]),
    () => fixedNow,
  )

  const preview = await service.previewImport({
    actorUserId: 'actor-1',
    fileName: 'students.csv',
    fileBuffer: Buffer.from('ignored'),
  })

  await assert.rejects(
    () =>
      service.confirmImport({
        actorUserId: 'actor-1',
        actorUsername: 'system.admin',
        previewId: preview.previewId,
        duplicateStrategy: 'FAIL',
        audit: {
          requestId: null,
          ipAddress: null,
          userAgent: null,
        },
      }),
    StudentImportDuplicateBlockedError,
  )
  assert.equal(repository.committed, undefined)
})

test('confirm SKIP chỉ chuyển bản ghi không trùng sang repository', async () => {
  const repository = new FakeStudentImportRepository()
  const service = new StudentImportService(
    repository,
    new InMemoryStudentImportPreviewStore(),
    createParser([
      {
        sourceRow: 2,
        values: {
          studentCode: '001',
          fullName: 'Sinh viên mới',
          email: 'new@example.edu.vn',
          classCode: 'K15A',
        },
      },
      {
        sourceRow: 3,
        values: {
          studentCode: '900',
          fullName: 'Sinh viên cũ',
          email: 'existing@example.edu.vn',
          classCode: 'K15A',
        },
      },
    ]),
    () => fixedNow,
  )

  const preview = await service.previewImport({
    actorUserId: 'actor-1',
    fileName: 'students.csv',
    fileBuffer: Buffer.from('ignored'),
  })
  const result = await service.confirmImport({
    actorUserId: 'actor-1',
    actorUsername: 'system.admin',
    previewId: preview.previewId,
    duplicateStrategy: 'SKIP',
    audit: {
      requestId: 'request-1',
      ipAddress: '127.0.0.1',
      userAgent: 'node-test',
    },
  })

  assert.equal(result.imported, 1)
  assert.equal(result.skipped, 1)
  assert.equal(repository.committed?.previewTotalRows, 2)
  assert.deepEqual(
    repository.committed?.rows.map((row) => row.studentCode),
    ['001'],
  )
})

test('confirm OVERWRITE dùng bản ghi cuối khi trùng trong file', async () => {
  const repository = new FakeStudentImportRepository()
  repository.inspection.existing = []
  const service = new StudentImportService(
    repository,
    new InMemoryStudentImportPreviewStore(),
    createParser([
      {
        sourceRow: 2,
        values: {
          studentCode: '010',
          fullName: 'Tên cũ trong file',
          email: 'sv010@example.edu.vn',
          classCode: 'K15A',
        },
      },
      {
        sourceRow: 3,
        values: {
          studentCode: '010',
          fullName: 'Tên cuối cùng',
          email: 'sv010@example.edu.vn',
          classCode: 'K15A',
        },
      },
    ]),
    () => fixedNow,
  )

  const preview = await service.previewImport({
    actorUserId: 'actor-1',
    fileName: 'students.csv',
    fileBuffer: Buffer.from('ignored'),
  })
  const result = await service.confirmImport({
    actorUserId: 'actor-1',
    actorUsername: 'system.admin',
    previewId: preview.previewId,
    duplicateStrategy: 'OVERWRITE',
    audit: {
      requestId: null,
      ipAddress: null,
      userAgent: null,
    },
  })

  assert.equal(result.imported, 1)
  assert.equal(repository.committed?.rows.length, 1)
  assert.equal(repository.committed?.rows[0]?.fullName, 'Tên cuối cùng')
  assert.equal(repository.committed?.previewTotalRows, 2)
})
