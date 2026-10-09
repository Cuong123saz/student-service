import type { DraftValues, DraftSummary, StudentDraft } from '~/types/submission'
import type { ProcedureApiError } from '~/types/procedure'
export function useSubmissions() {
  const base = String(useRuntimeConfig().public.apiBase) + '/api/v1/user/submissions'
  async function request<T>(path: string, options: Parameters<typeof $fetch<T>>[1] = {}) {
    try {
      return await $fetch<T>(base + path, { ...options, credentials: 'include' })
    } catch (error) {
      const e = error as {
        statusCode?: number
        response?: { status?: number }
        data?: { message?: string; issues?: ProcedureApiError['issues'] }
      }
      const status = e.statusCode ?? e.response?.status
      throw {
        status,
        message:
          status === 401
            ? 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
            : (e.data?.message ?? 'Không thể kết nối tới máy chủ. Vui lòng thử lại.'),
        issues: e.data?.issues ?? [],
      } as ProcedureApiError
    }
  }
  return {
    list: () => request<DraftSummary[]>(''),
    create: (serviceId: number, versionId: string) =>
      request<StudentDraft>('', { method: 'POST', body: { serviceId, versionId } }),
    get: (id: string) => request<StudentDraft>('/' + id),
    save: (id: string, expectedRevision: number, values: DraftValues) =>
      request<StudentDraft>('/' + id, { method: 'PUT', body: { expectedRevision, values } }),
    upload: (id: string, revision: number, key: string, file: File) => {
      const body = new FormData()
      body.append('file', file)
      return request<StudentDraft>('/' + id + '/attachments/' + key + '?revision=' + revision, {
        method: 'POST',
        body,
      })
    },
    remove: (id: string, revision: number, fileId: string) =>
      request<StudentDraft>('/' + id + '/files/' + fileId + '?revision=' + revision, {
        method: 'DELETE',
      }),
    downloadUrl: (id: string, fileId: string) => base + '/' + id + '/files/' + fileId,
  }
}
