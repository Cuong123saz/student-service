import assert from 'node:assert/strict'
import { test } from 'node:test'
import { zipSync } from 'fflate'

import {
  STUDENT_IMPORT_MAX_ROWS,
  StudentImportArchiveLimitError,
  StudentImportFileParseError,
  StudentImportRowLimitError,
  UnsupportedStudentImportFileError,
  parseStudentImportFile,
} from './student-import.parser.js'
import { createStudentImportTemplateWorkbook } from './student-export.xlsx.js'

const minimalXlsxBase64 =
  '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'

test('parse CSV UTF-8 giữ số dòng gốc và giá trị có dấu phẩy', async () => {
  const csv = [
    'Mã sinh viên,Họ và tên,Email,Mã lớp',
    'SV001,"Nguyễn, Văn A",sv001@example.edu.vn,K15A',
    '',
    'SV002,Trần Thị B,sv002@example.edu.vn,K15A',
  ].join('\r\n')

  const result = await parseStudentImportFile('students.csv', Buffer.from(`\uFEFF${csv}`, 'utf8'))

  assert.equal(result.format, 'CSV')
  assert.deepEqual(result.rows, [
    {
      sourceRow: 2,
      values: {
        studentCode: 'SV001',
        fullName: 'Nguyễn, Văn A',
        email: 'sv001@example.edu.vn',
        classCode: 'K15A',
      },
    },
    {
      sourceRow: 4,
      values: {
        studentCode: 'SV002',
        fullName: 'Trần Thị B',
        email: 'sv002@example.edu.vn',
        classCode: 'K15A',
      },
    },
  ])
})

test('parse CSV xử lý delimiter chấm phẩy quote lồng và dòng cuối không newline', async () => {
  const csv = [
    'studentCode;fullName;email;classCode',
    '001;"Nguyễn ""Văn"", A";sv001@example.edu.vn;K15A',
    '002;Trần Thị B;sv002@example.edu.vn;K15A',
  ].join('\n')

  const result = await parseStudentImportFile('students.csv', Buffer.from(csv))

  assert.equal(result.rows.length, 2)
  assert.equal(result.rows[0]?.values.fullName, 'Nguyễn "Văn", A')
  assert.equal(result.rows[1]?.sourceRow, 3)
})

test('parse CSV giữ source row với mixed line ending và giá trị nhiều dòng', async () => {
  const csv =
    'studentCode,fullName,email,classCode\r\n' +
    '001,"Nguyễn\nVăn A",sv001@example.edu.vn,K15A\n' +
    '\r\n' +
    '002,Trần Thị B,sv002@example.edu.vn,K15A\r\n'

  const result = await parseStudentImportFile('students.csv', Buffer.from(csv))

  assert.deepEqual(
    result.rows.map((row) => row.sourceRow),
    [2, 5],
  )
  assert.equal(result.rows[0]?.values.fullName, 'Nguyễn\nVăn A')
})

test('parse CSV giữ trường trống cuối dòng để validation xử lý', async () => {
  const result = await parseStudentImportFile(
    'students.csv',
    Buffer.from(
      ['studentCode,fullName,email,classCode', '001,Nguyễn Văn A,sv001@example.edu.vn,'].join('\n'),
    ),
  )

  assert.equal(result.rows[0]?.values.classCode, '')
})

test('parse CSV từ chối quote chưa đóng', async () => {
  await assert.rejects(
    () =>
      parseStudentImportFile(
        'students.csv',
        Buffer.from(
          'studentCode,fullName,email,classCode\n001,"Nguyễn Văn A,sv001@example.edu.vn,K15A',
        ),
      ),
    StudentImportFileParseError,
  )
})

test('XLSX preflight từ chối archive có compression ratio bất thường', async () => {
  const bomb = Buffer.from(
    zipSync(
      {
        'xl/worksheets/sheet1.xml': new Uint8Array(2 * 1024 * 1024),
      },
      { level: 9 },
    ),
  )

  await assert.rejects(
    () => parseStudentImportFile('students.xlsx', bomb),
    StudentImportArchiveLimitError,
  )
})

test('parser từ chối định dạng ngoài XLSX và CSV', async () => {
  await assert.rejects(
    () => parseStudentImportFile('students.xls', Buffer.from('legacy')),
    UnsupportedStudentImportFileError,
  )
})

test('parse worksheet đầu tiên của file XLSX', async () => {
  const result = await parseStudentImportFile(
    'students.xlsx',
    createStudentImportTemplateWorkbook(),
  )

  assert.equal(result.format, 'XLSX')
  assert.equal(result.rows.length, 2)
  assert.deepEqual(result.rows[0], {
    sourceRow: 2,
    values: {
      studentCode: '00123456',
      fullName: 'Nguyễn Văn A',
      email: '00123456@example.edu.vn',
      classCode: 'K15A',
    },
  })
})

test('parser từ chối file vượt giới hạn số dòng', async () => {
  const rows = [
    'studentCode,fullName,email,classCode',
    ...Array.from(
      { length: STUDENT_IMPORT_MAX_ROWS + 1 },
      (_, index) => `SV${index},Student ${index},sv${index}@example.edu.vn,K15A`,
    ),
  ]

  await assert.rejects(
    () => parseStudentImportFile('students.csv', Buffer.from(rows.join('\n'))),
    StudentImportRowLimitError,
  )
})
