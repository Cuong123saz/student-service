import {
  mountSuspended,
  mockNuxtImport,
} from '@nuxt/test-utils/runtime'
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { nextTick, ref } from 'vue'

import type {
  StudentImportCommitResponse,
  StudentImportPreviewResponse,
} from '../../app/types/student-import'
import StudentImportPage from '../../app/pages/admin/students/import.vue'

function createStudentImportMock() {
  return {
    preview: ref<StudentImportPreviewResponse | null>(null),
    result: ref<StudentImportCommitResponse | null>(null),
    isPreviewing: ref(false),
    isConfirming: ref(false),
    errorMessage: ref(''),
    errorRequestId: ref<string | null>(null),
    previewImport: vi.fn(),
    confirmImport: vi.fn(),
    reset: vi.fn(() => true),
  }
}

let studentImportMock = createStudentImportMock()

mockNuxtImport('useStudentImport', () => (
  () => studentImportMock
))

const validPreview: StudentImportPreviewResponse = {
  previewId: '00000000-0000-4000-8000-000000000001',
  expiresAt: '2026-09-09T09:00:00.000Z',
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
  validRecords: [{
    sourceRow: 2,
    studentCode: '001',
    username: '001',
    fullName: 'Nguyễn Văn A',
    email: 'sv001@example.edu.vn',
    classCode: 'K15A',
  }],
  errorRecords: [],
  duplicateRecords: [],
}

async function selectFile(
  wrapper: Awaited<ReturnType<typeof mountSuspended>>,
  file: File,
) {
  const input = wrapper.get<HTMLInputElement>(
    '#student-import-file',
  )

  Object.defineProperty(input.element, 'files', {
    configurable: true,
    value: {
      0: file,
      length: 1,
      item: () => file,
    },
  })
  await input.trigger('change')
}

beforeEach(() => {
  studentImportMock = createStudentImportMock()
})

describe('trang import sinh viên', () => {
  it('đi từ chọn file, preview đến xác nhận thành công', async () => {
    studentImportMock.previewImport.mockImplementation(
      async (file: File) => {
        expect(file.name).toBe('students.csv')
        studentImportMock.preview.value = validPreview
        return true
      },
    )
    studentImportMock.confirmImport.mockImplementation(
      async (strategy: string) => {
        expect(strategy).toBe('SKIP')
        studentImportMock.preview.value = null
        studentImportMock.result.value = {
          imported: 1,
          updated: 0,
          skipped: 0,
        }
        return true
      },
    )

    const wrapper = await mountSuspended(StudentImportPage)
    const file = new File(
      ['studentCode,fullName,email,classCode\n'
        + '001,Nguyễn Văn A,sv001@example.edu.vn,K15A'],
      'students.csv',
      { type: 'text/csv' },
    )

    await selectFile(wrapper, file)
    expect(wrapper.text()).toContain('students.csv')

    await wrapper.get('form.student-import__upload')
      .trigger('submit')
    await nextTick()

    expect(studentImportMock.previewImport)
      .toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain('Đã kiểm tra file')
    expect(wrapper.text()).toContain('Xác nhận ghi dữ liệu')

    await wrapper.get<HTMLInputElement>(
      'input[value="SKIP"]',
    ).setValue(true)
    await wrapper.get('form.student-import__confirm')
      .trigger('submit')
    await nextTick()

    expect(studentImportMock.confirmImport)
      .toHaveBeenCalledWith('SKIP')
    expect(wrapper.text())
      .toContain('Import sinh viên thành công')
    expect(wrapper.text()).toContain('Đã tạo mới')
  })

  it('chặn file sai định dạng ngay tại giao diện', async () => {
    const wrapper = await mountSuspended(StudentImportPage)

    await selectFile(
      wrapper,
      new File(['invalid'], 'students.txt', {
        type: 'text/plain',
      }),
    )

    expect(wrapper.text())
      .toContain('Chỉ hỗ trợ file .csv hoặc .xlsx.')
    expect(studentImportMock.previewImport)
      .not.toHaveBeenCalled()
  })

  it('hiển thị lỗi preview hết hạn và mã tra cứu', async () => {
    studentImportMock.preview.value = validPreview
    studentImportMock.errorMessage.value =
      'Bản xem trước không còn tồn tại hoặc đã hết hạn.'
    studentImportMock.errorRequestId.value = 'req-expired-preview'

    const wrapper = await mountSuspended(StudentImportPage)

    expect(wrapper.text()).toContain(
      'Bản xem trước không còn tồn tại hoặc đã hết hạn.',
    )
    expect(wrapper.text()).toContain('req-expired-preview')
  })
})
