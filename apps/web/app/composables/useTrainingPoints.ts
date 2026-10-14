import type {
  TrainingPeriod,
  TrainingPeriodInput,
  TrainingCatalog,
  TrainingDeclaration,
  TrainingAnswers,
  TrainingGroup,
} from '~/types/training-point'
import { trainingFetchError } from '~/utils/training-point'
export function useTrainingPoints(admin = false) {
  const runtime = useRuntimeConfig(),
    base = String(runtime.public.apiBase) + '/api/v1/' + (admin ? 'admin' : 'user')
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
    list: () => request<{ items: TrainingPeriod[]; truncated: boolean }>('/training-periods'),
    catalog: () => request<TrainingCatalog>('/training-periods/catalog'),
    create: (config: TrainingPeriodInput) =>
      request<TrainingPeriod>('/training-periods', { method: 'POST', body: config }),
    savePeriod: (p: TrainingPeriod, config: TrainingPeriodInput) =>
      request<TrainingPeriod>('/training-periods/' + p.id, {
        method: 'PUT',
        body: { expectedRevision: p.revision, config },
      }),
    transition: (p: TrainingPeriod, action: 'open' | 'close') =>
      request<TrainingPeriod>('/training-periods/' + p.id + '/' + action, {
        method: 'POST',
        body: { expectedRevision: p.revision },
      }),
    start: (id: string) =>
      request<TrainingDeclaration>('/training-periods/' + id + '/declaration', {
        method: 'POST',
        body: {},
      }),
    detail: (id: string) => request<TrainingDeclaration>('/training-declarations/' + id),
    save: (d: TrainingDeclaration, answers: TrainingAnswers) =>
      request<TrainingDeclaration>('/training-declarations/' + d.id, {
        method: 'PUT',
        body: { expectedRevision: d.revision, answers },
      }),
    submit: (d: TrainingDeclaration, requestId: string) =>
      request<TrainingDeclaration>('/training-declarations/' + d.id + '/submit', {
        method: 'POST',
        body: { expectedRevision: d.revision, requestId },
      }),
    upload: (d: TrainingDeclaration, criterion: TrainingGroup, file: File) => {
      const body = new FormData()
      body.append('file', file)
      return request<TrainingDeclaration>(
        '/training-declarations/' + d.id + '/evidence/' + criterion,
        {
          method: 'POST',
          query: { expectedRevision: d.revision, requestId: crypto.randomUUID() },
          body,
        },
      )
    },
    remove: (d: TrainingDeclaration, id: string) =>
      request<TrainingDeclaration>('/training-declarations/' + d.id + '/files/' + id, {
        method: 'DELETE',
        query: { expectedRevision: d.revision },
      }),
    download: async (d: TrainingDeclaration, file: { id: string; name: string }) => {
      const blob = await request<Blob>('/training-declarations/' + d.id + '/files/' + file.id, {
        responseType: 'blob',
      })
      const url = URL.createObjectURL(blob)
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
