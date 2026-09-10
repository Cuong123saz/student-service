import type {
  StudentImportCommitResponse,
  StudentImportDuplicateStrategy,
  StudentImportJobCreatedResponse,
  StudentImportJobStatusResponse,
  StudentImportPreviewResponse,
} from '../types/student-import'
import { readonly, ref } from 'vue'

import { getApiErrorContext, type ApiErrorContext } from '../utils/api-error'

// Đây chỉ là kiểm tra sớm để cải thiện UX.
// Backend vẫn là nơi thực thi giới hạn chính thức.
const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024

interface StudentImportRequestOptions {
  method: 'GET' | 'POST'
  credentials: 'include'
  body?:
    | FormData
    | {
        duplicateStrategy: StudentImportDuplicateStrategy
      }
}

export type StudentImportFetcher = <Response>(
  url: string,
  options: StudentImportRequestOptions,
) => Promise<Response>

export interface UseStudentImportOptions {
  apiBase?: string
  fetcher?: StudentImportFetcher
}

const defaultFetcher: StudentImportFetcher = async <Response>(url, options) =>
  await $fetch<Response>(url, options)

function getPreviewErrorMessage(error: ApiErrorContext): string {
  if (error.status === 400) {
    return 'File không hợp lệ hoặc thiếu các cột bắt buộc.'
  }

  if (error.status === 401) {
    return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
  }

  if (error.status === 403) {
    return 'Bạn không có quyền import sinh viên hoặc dữ liệu nằm ngoài phạm vi được giao.'
  }

  if (error.status === 413) {
    return 'File vượt quá 5 MB hoặc chứa nhiều hơn 1.000 dòng dữ liệu.'
  }

  if (error.status === 429) {
    return 'Bạn thao tác quá nhiều lần. Vui lòng chờ một lúc rồi thử lại.'
  }

  if (error.status === 503) {
    return 'Hệ thống đang xử lý nhiều file import. Vui lòng thử lại sau ít phút.'
  }

  return 'Không thể đọc file import. Vui lòng thử lại sau.'
}

function getConfirmErrorMessage(error: ApiErrorContext): string {
  if (error.code === 'IMPORT_PREVIEW_NOT_FOUND' || error.status === 404) {
    return 'Bản xem trước đã hết hạn hoặc không còn tồn tại. Vui lòng tải lại file.'
  }

  if (error.code === 'IMPORT_COMMIT_CONFLICT') {
    return 'Dữ liệu hệ thống đã thay đổi sau khi xem trước. Vui lòng tải lại file để kiểm tra lại.'
  }

  if (error.code === 'IMPORT_DUPLICATE_BLOCKED') {
    return 'Bạn đã chọn dừng khi có dữ liệu trùng. Hãy chọn bỏ qua hoặc ghi đè để tiếp tục.'
  }

  if (error.code === 'IMPORT_AMBIGUOUS_DUPLICATE') {
    return 'Một số dòng trùng không thể ghi đè an toàn. Hãy chọn bỏ qua hoặc sửa lại file.'
  }

  if (error.code === 'IMPORT_VALIDATION_BLOCKED' || error.status === 422) {
    return 'Bản xem trước còn dòng bị lỗi. Hãy kiểm tra các lỗi, sửa file và tải lên lại.'
  }

  if (error.status === 400) {
    return 'Yêu cầu xác nhận import không hợp lệ.'
  }

  if (error.status === 401) {
    return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
  }

  if (error.status === 403) {
    return 'Bạn không có quyền import sinh viên hoặc dữ liệu nằm ngoài phạm vi được giao.'
  }

  if (error.status === 409) {
    return 'Không thể xử lý dữ liệu trùng theo lựa chọn hiện tại. Hãy đổi cách xử lý hoặc tải lại file.'
  }

  if (error.status === 429) {
    return 'Bạn thao tác quá nhiều lần. Vui lòng chờ một lúc rồi thử lại.'
  }

  return 'Không thể hoàn tất import. Vui lòng thử lại sau.'
}

/**
 * Chỉ những lỗi chứng minh preview không còn đáng tin
 * mới được phép xóa preview.
 */
function shouldInvalidatePreview(error: ApiErrorContext): boolean {
  return (
    error.status === 404 ||
    error.code === 'IMPORT_PREVIEW_NOT_FOUND' ||
    error.code === 'IMPORT_COMMIT_CONFLICT'
  )
}

export function useStudentImport(options: UseStudentImportOptions = {}) {
  // Trong ứng dụng thật, hai dependency này dùng Nuxt.
  // Unit test có thể truyền giá trị thay thế mà không cần
  // khởi động toàn bộ Nuxt runtime.
  const apiBase = options.apiBase ?? useRuntimeConfig().public.apiBase
  const fetcher = options.fetcher ?? defaultFetcher

  const preview = ref<StudentImportPreviewResponse | null>(null)

  const result = ref<StudentImportCommitResponse | null>(null)

  const isPreviewing = ref(false)
  const isConfirming = ref(false)

  const errorMessage = ref('')
  const errorCode = ref<string | null>(null)
  const errorRequestId = ref<string | null>(null)

  function clearError(): void {
    errorMessage.value = ''
    errorCode.value = null
    errorRequestId.value = null
  }

  /**
   * Lưu thông báo thân thiện cùng mã lỗi và requestId.
   * UI không cần hiển thị raw message của server.
   */
  function setError(message: string, error: ApiErrorContext = {}): void {
    errorMessage.value = message
    errorCode.value = error.code ?? null
    errorRequestId.value = error.requestId ?? null
  }

  function hasSupportedExtension(file: File): boolean {
    const fileName = file.name.toLowerCase()

    return fileName.endsWith('.csv') || fileName.endsWith('.xlsx')
  }

  /**
   * Upload và phân tích file.
   * Bước này chưa ghi dữ liệu vào database.
   */
  async function previewImport(file: File): Promise<boolean> {
    if (isPreviewing.value || isConfirming.value) {
      return false
    }

    clearError()
    preview.value = null
    result.value = null

    if (!hasSupportedExtension(file)) {
      setError('Chỉ chấp nhận file CSV hoặc XLSX.', {
        code: 'CLIENT_UNSUPPORTED_FILE',
      })

      return false
    }

    if (file.size === 0) {
      setError('File import đang trống.', {
        code: 'CLIENT_EMPTY_FILE',
      })

      return false
    }

    if (file.size > MAX_IMPORT_FILE_BYTES) {
      setError('File import không được vượt quá 5 MB.', {
        code: 'CLIENT_FILE_TOO_LARGE',
      })

      return false
    }

    const formData = new FormData()
    formData.append('file', file)

    isPreviewing.value = true

    try {
      const created = await fetcher<StudentImportJobCreatedResponse>(
        `${apiBase}/api/v1/admin/students/imports/preview`,
        {
          method: 'POST',
          body: formData,

          // Cần gửi HttpOnly admin cookie.
          credentials: 'include',

          // Không tự đặt Content-Type.
          // Trình duyệt sẽ tạo multipart boundary.
        },
      )

      for (let attempt = 0; attempt < 120; attempt += 1) {
        const job = await fetcher<StudentImportJobStatusResponse>(
          `${apiBase}/api/v1/admin/students/imports/jobs/${encodeURIComponent(created.jobId)}`,
          {
            method: 'GET',
            credentials: 'include',
          },
        )

        if (job.status === 'SUCCEEDED' && job.preview) {
          preview.value = job.preview
          return true
        }

        if (job.status === 'FAILED') {
          setError(
            job.errorCode === 'IMPORT_ARCHIVE_LIMIT_EXCEEDED'
              ? 'File XLSX vượt giới hạn giải nén an toàn.'
              : 'Không thể phân tích file import. Vui lòng kiểm tra file và thử lại.',
            { code: job.errorCode ?? undefined },
          )
          return false
        }

        await new Promise<void>((resolve) => {
          setTimeout(resolve, 500)
        })
      }

      setError('File đang mất quá nhiều thời gian xử lý. Vui lòng thử lại sau.', {
        code: 'CLIENT_IMPORT_JOB_TIMEOUT',
      })
      return false
    } catch (error: unknown) {
      const apiError = getApiErrorContext(error)

      setError(getPreviewErrorMessage(apiError), apiError)

      return false
    } finally {
      isPreviewing.value = false
    }
  }

  /**
   * Xác nhận preview và yêu cầu backend commit.
   */
  async function confirmImport(
    duplicateStrategy: StudentImportDuplicateStrategy,
  ): Promise<boolean> {
    if (isPreviewing.value || isConfirming.value) {
      return false
    }

    const currentPreview = preview.value

    if (!currentPreview) {
      setError('Bạn cần tải file và xem trước dữ liệu trước khi xác nhận.', {
        code: 'CLIENT_PREVIEW_REQUIRED',
      })

      return false
    }

    clearError()
    result.value = null
    isConfirming.value = true

    try {
      const response = await fetcher<StudentImportCommitResponse>(
        `${apiBase}/api/v1/admin/students/imports/${encodeURIComponent(currentPreview.previewId)}/confirm`,
        {
          method: 'POST',
          credentials: 'include',
          body: {
            duplicateStrategy,
          },
        },
      )

      result.value = response

      // Backend đã consume preview sau khi commit.
      // Giữ preview ở đây sẽ cho phép gửi lại một ID
      // chắc chắn không còn hợp lệ.
      preview.value = null

      return true
    } catch (error: unknown) {
      const apiError = getApiErrorContext(error)

      if (shouldInvalidatePreview(apiError)) {
        preview.value = null
      }

      // AMBIGUOUS_DUPLICATE và DUPLICATE_BLOCKED
      // không xóa preview để người dùng đổi strategy.
      setError(getConfirmErrorMessage(apiError), apiError)

      return false
    } finally {
      isConfirming.value = false
    }
  }

  /**
   * Bắt đầu lại toàn bộ quy trình import.
   *
   * Không reset khi request còn chạy để tránh request
   * cũ hoàn thành rồi ghi state trở lại.
   */
  function reset(): boolean {
    if (isPreviewing.value || isConfirming.value) {
      return false
    }

    preview.value = null
    result.value = null
    clearError()

    return true
  }

  return {
    preview: readonly(preview),
    result: readonly(result),
    isPreviewing: readonly(isPreviewing),
    isConfirming: readonly(isConfirming),
    errorMessage: readonly(errorMessage),
    errorCode: readonly(errorCode),
    errorRequestId: readonly(errorRequestId),

    previewImport,
    confirmImport,
    reset,
  }
}
