import type {
  ReviewSubmissionSummary,
  ReviewSubmissionDetail,
  ResolutionAction,
} from '~/types/submission'
import type { ProcedureApiError } from '~/types/procedure'
import { getApiErrorContext } from '~/utils/api-error'

export function useReviewSubmissions(portal: 'user' | 'admin') {
  const base =
    String(useRuntimeConfig().public.apiBase) + '/api/v1/' + portal + '/review-submissions'
  async function request<T>(path: string, options: Parameters<typeof $fetch<T>>[1] = {}) {
    try {
      return await $fetch<T>(base + path, { ...options, credentials: 'include' })
    } catch (error) {
      const context = getApiErrorContext(error)
      const e = error as { data?: { message?: string; issues?: ProcedureApiError['issues'] } }
      throw {
        ...context,
        message:
          context.status === 401
            ? 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
            : (e.data?.message ?? 'Không thể kết nối tới máy chủ. Vui lòng thử lại.'),
        issues: e.data?.issues ?? [],
      } as ProcedureApiError
    }
  }
  return {
    list: (status?: ReviewSubmissionSummary['status']) =>
      request<ReviewSubmissionSummary[]>('', status ? { query: { status } } : {}),
    get: (id: string) => request<ReviewSubmissionDetail>('/' + encodeURIComponent(id)),
    claim: (id: string, expectedRevision: number) =>
      request<ReviewSubmissionDetail>('/' + encodeURIComponent(id) + '/claim', {
        method: 'POST',
        body: { expectedRevision },
      }),
    resolve: (id: string, expectedRevision: number, action: ResolutionAction, note: string) =>
      request<ReviewSubmissionDetail>('/' + encodeURIComponent(id) + '/resolve', {
        method: 'POST',
        body: { expectedRevision, action, note },
      }),
    roundDownloadUrl: (id: string, roundNumber: number, fileId: string) =>
      base +
      '/' +
      encodeURIComponent(id) +
      '/rounds/' +
      roundNumber +
      '/files/' +
      encodeURIComponent(fileId),
    downloadUrl: (id: string, fileId: string) =>
      base + '/' + encodeURIComponent(id) + '/files/' + encodeURIComponent(fileId),
  }
}
