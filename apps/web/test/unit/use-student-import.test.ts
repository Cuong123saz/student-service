import { beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  StudentImportCommitResponse,
  StudentImportJobCreatedResponse,
  StudentImportJobStatusResponse,
  StudentImportPreviewResponse,
} from '../../app/types/student-import'
import { type StudentImportFetcher, useStudentImport } from '../../app/composables/useStudentImport'

const previewResponse: StudentImportPreviewResponse = {
  previewId: '00000000-0000-4000-8000-000000000001',
  expiresAt: '2026-09-07T04:00:00.000Z',
  file: {
    name: 'students.csv',
    format: 'CSV',
  },
  summary: {
    total: 1,
    valid: 1,
    errors: 0,
    duplicates: 0,
  },
  validRecords: [
    {
      sourceRow: 2,
      studentCode: '001',
      username: '001',
      fullName: 'Nguyễn Văn A',
      email: 'sv001@example.edu.vn',
      classCode: 'K15A',
    },
  ],
  errorRecords: [],
  duplicateRecords: [],
}

const commitResponse: StudentImportCommitResponse = {
  imported: 1,
  updated: 0,
  skipped: 0,
}

const jobCreatedResponse: StudentImportJobCreatedResponse = {
  jobId: '00000000-0000-4000-8000-000000000010',
  status: 'PENDING',
}

const jobSucceededResponse: StudentImportJobStatusResponse = {
  jobId: jobCreatedResponse.jobId,
  status: 'SUCCEEDED',
  errorCode: null,
  preview: previewResponse,
}

function mockSuccessfulPreview() {
  fetchMock.mockResolvedValueOnce(jobCreatedResponse).mockResolvedValueOnce(jobSucceededResponse)
}

function csvFile(): File {
  return new File(
    ['studentCode,fullName,email,classCode\n' + '001,Nguyễn Văn A,sv001@example.edu.vn,K15A'],
    'students.csv',
    { type: 'text/csv' },
  )
}

function structuredError(statusCode: number, code: string) {
  return {
    statusCode,
    data: {
      message: 'Safe server message',
      error: {
        code,
        requestId: 'req-import-test',
      },
    },
  }
}

const fetchMock = vi.fn()

const fetcher: StudentImportFetcher = async <Response>(url, options) =>
  (await fetchMock(url, options)) as Response

function createStudentImport() {
  return useStudentImport({
    apiBase: 'http://api.test',
    fetcher,
  })
}

beforeEach(() => {
  fetchMock.mockReset()
})

describe('useStudentImport', () => {
  it('từ chối file không phải CSV hoặc XLSX trước khi gọi API', async () => {
    const studentImport = createStudentImport()
    const file = new File(['not a spreadsheet'], 'students.txt', { type: 'text/plain' })

    const succeeded = await studentImport.previewImport(file)

    expect(succeeded).toBe(false)
    expect(studentImport.errorCode.value).toBe('CLIENT_UNSUPPORTED_FILE')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('lưu preview và gửi file dưới dạng FormData', async () => {
    mockSuccessfulPreview()
    const studentImport = createStudentImport()

    const succeeded = await studentImport.previewImport(csvFile())

    expect(succeeded).toBe(true)
    expect(studentImport.preview.value).toEqual(previewResponse)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const [url, options] = fetchMock.mock.calls[0] as [
      string,
      {
        method: string
        body: FormData
        credentials: string
        headers?: unknown
      },
    ]

    expect(url).toBe('http://api.test/api/v1/admin/students/imports/preview')
    expect(options.method).toBe('POST')
    expect(options.credentials).toBe('include')
    expect(options.body).toBeInstanceOf(FormData)
    expect(options.body.get('file')).toBeInstanceOf(File)
    expect(options.headers).toBeUndefined()
  })

  it('chặn request preview thứ hai khi request đầu còn chạy', async () => {
    let resolveRequest: ((value: StudentImportJobCreatedResponse) => void) | undefined
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<StudentImportJobCreatedResponse>((resolve) => {
          resolveRequest = resolve
        }),
    )
    fetchMock.mockResolvedValueOnce(jobSucceededResponse)
    const studentImport = createStudentImport()

    const firstRequest = studentImport.previewImport(csvFile())
    expect(studentImport.isPreviewing.value).toBe(true)

    const secondResult = await studentImport.previewImport(csvFile())

    expect(secondResult).toBe(false)
    expect(fetchMock).toHaveBeenCalledOnce()

    resolveRequest?.(jobCreatedResponse)
    await expect(firstRequest).resolves.toBe(true)
  })

  it('confirm thành công consume preview và lưu kết quả', async () => {
    fetchMock
      .mockResolvedValueOnce(jobCreatedResponse)
      .mockResolvedValueOnce(jobSucceededResponse)
      .mockResolvedValueOnce(commitResponse)
    const studentImport = createStudentImport()
    await studentImport.previewImport(csvFile())

    const succeeded = await studentImport.confirmImport('FAIL')

    expect(succeeded).toBe(true)
    expect(studentImport.preview.value).toBeNull()
    expect(studentImport.result.value).toEqual(commitResponse)
  })

  it('xóa preview khi backend trả 404', async () => {
    fetchMock
      .mockResolvedValueOnce(jobCreatedResponse)
      .mockResolvedValueOnce(jobSucceededResponse)
      .mockRejectedValueOnce(structuredError(404, 'IMPORT_PREVIEW_NOT_FOUND'))
    const studentImport = createStudentImport()
    await studentImport.previewImport(csvFile())

    const succeeded = await studentImport.confirmImport('SKIP')

    expect(succeeded).toBe(false)
    expect(studentImport.preview.value).toBeNull()
    expect(studentImport.errorRequestId.value).toBe('req-import-test')
  })

  it('xóa preview khi database thay đổi sau preview', async () => {
    fetchMock
      .mockResolvedValueOnce(jobCreatedResponse)
      .mockResolvedValueOnce(jobSucceededResponse)
      .mockRejectedValueOnce(structuredError(409, 'IMPORT_COMMIT_CONFLICT'))
    const studentImport = createStudentImport()
    await studentImport.previewImport(csvFile())

    await studentImport.confirmImport('FAIL')

    expect(studentImport.preview.value).toBeNull()
    expect(studentImport.errorCode.value).toBe('IMPORT_COMMIT_CONFLICT')
  })

  it.each(['IMPORT_DUPLICATE_BLOCKED', 'IMPORT_AMBIGUOUS_DUPLICATE'])(
    'giữ preview để đổi strategy khi nhận %s',
    async (code) => {
      fetchMock
        .mockResolvedValueOnce(jobCreatedResponse)
        .mockResolvedValueOnce(jobSucceededResponse)
        .mockRejectedValueOnce(structuredError(409, code))
      const studentImport = createStudentImport()
      await studentImport.previewImport(csvFile())

      const succeeded = await studentImport.confirmImport('OVERWRITE')

      expect(succeeded).toBe(false)
      expect(studentImport.preview.value).toEqual(previewResponse)
      expect(studentImport.errorCode.value).toBe(code)
    },
  )

  it('reset xóa toàn bộ trạng thái sau lỗi', async () => {
    fetchMock.mockRejectedValueOnce(structuredError(413, 'IMPORT_FILE_LIMIT_EXCEEDED'))
    const studentImport = createStudentImport()
    await studentImport.previewImport(csvFile())

    expect(studentImport.errorMessage.value).not.toBe('')
    expect(studentImport.reset()).toBe(true)
    expect(studentImport.preview.value).toBeNull()
    expect(studentImport.result.value).toBeNull()
    expect(studentImport.errorMessage.value).toBe('')
    expect(studentImport.errorCode.value).toBeNull()
    expect(studentImport.errorRequestId.value).toBeNull()
  })
})
