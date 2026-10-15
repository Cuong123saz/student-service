import type {
  ReviewAction,
  ReviewState,
  ReviewDetail,
  ReviewQueue,
  ReviewPeriod,
} from '~/types/training-review'
import type { TrainingAnswers } from '~/types/training-point'
import { trainingFetchError } from '~/utils/training-point'
export function useTrainingReviews() {
  const base = String(useRuntimeConfig().public.apiBase) + '/api/v1/user'
  async function request<T>(
    path: string,
    options: Parameters<typeof $fetch<T>>[1] = {},
  ): Promise<T> {
    try {
      return await $fetch<T>(base + path, { ...options, credentials: 'include' })
    } catch (e) {
      throw await trainingFetchError(e)
    }
  }
  return {
    periods: () =>
      request<{ items: ReviewPeriod[]; truncated: boolean }>('/training-reviews/periods'),
    queue: (id: string, cursor?: string, state?: ReviewState) =>
      request<ReviewQueue>('/training-reviews/periods/' + id, { query: { cursor, state } }),
    detail: (id: string) => request<ReviewDetail>('/training-reviews/' + id),
    own: (id: string) => request<ReviewDetail>('/training-declarations/' + id + '/review'),
    act: (d: ReviewDetail, action: ReviewAction, comment: string, answers?: TrainingAnswers) =>
      request<ReviewDetail>('/training-reviews/' + d.id + '/' + action, {
        method: 'POST',
        body: {
          expectedRevision: d.revision,
          requestId: crypto.randomUUID(),
          confirmed: true,
          comment,
          ...(action === 'advisor-sign' ? { answers } : {}),
        },
      }),
    download: async (id: string, file: { id: string; name: string }) => {
      const blob = await request<Blob>('/training-reviews/' + id + '/files/' + file.id, {
          responseType: 'blob',
        }),
        url = URL.createObjectURL(blob)
      try {
        const a = document.createElement('a')
        a.href = url
        a.download = file.name
        a.click()
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      }
    },
  }
}
