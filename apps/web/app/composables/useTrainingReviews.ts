import type {
  ReviewAction,
  ReviewState,
  ReviewDetail,
  ReviewQueue,
  ReviewPeriod,
  ReviewRoster,
  MonitorAuditItem,
} from '~/types/training-review'
import type { TrainingAnswers } from '~/types/training-point'
import { trainingFetchError } from '~/utils/training-point'
import {
  blobSha256,
  isSha256,
  trainingExportFileName,
  trainingExportFormats,
  type TrainingExportFormat,
} from '~/utils/training-export'

export interface TrainingExportResult {
  name: string
  size: number
  snapshotId: string
  sha256: string
  /** true: browser hash matches the server; null: browser could not compute a hash. */
  verified: boolean | null
}
function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}
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
    // ADR 0028: class roster, monitor appointment and the advisor's view of monitor activity.
    roster: (periodId: string) =>
      request<ReviewRoster>('/training-reviews/periods/' + periodId + '/roster'),
    appointMonitor: (periodId: string, studentUserId: string | null) =>
      request<ReviewRoster>('/training-reviews/periods/' + periodId + '/monitor', {
        method: 'PUT',
        body: { studentUserId },
      }),
    monitorAudit: (periodId: string) =>
      request<{ items: MonitorAuditItem[] }>(
        '/training-reviews/periods/' + periodId + '/monitor-audit',
      ),
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
      })
      saveBlob(blob, file.name)
    },
    /** POST-only export; the file is saved only after its SHA-256 matches the server header. */
    exportPeriod: async (
      periodId: string,
      format: TrainingExportFormat,
      declarationId?: string,
    ): Promise<TrainingExportResult> => {
      let response
      try {
        response = await $fetch.raw<Blob>(
          base +
            '/training-reviews/periods/' +
            periodId +
            '/' +
            (declarationId ? 'declarations/' + declarationId + '/' : '') +
            trainingExportFormats[format].path,
          { method: 'POST', body: {}, credentials: 'include', responseType: 'blob' },
        )
      } catch (e) {
        throw await trainingFetchError(e)
      }
      const blob = response._data,
        snapshotId = response.headers.get('x-export-snapshot-id') ?? '',
        expected = response.headers.get('x-export-sha256')
      if (!(blob instanceof Blob) || !blob.size || !isSha256(expected))
        throw {
          status: response.status,
          message: 'Phản hồi tải tệp không đầy đủ. Hãy thử tải lại.',
          issues: [],
        }
      const actual = await blobSha256(blob)
      if (actual !== null && actual !== expected)
        throw {
          status: response.status,
          message:
            'Tệp nhận được không khớp mã kiểm tra của máy chủ nên chưa được lưu. Hãy tải lại.',
          issues: [],
        }
      const name = trainingExportFileName(format, snapshotId)
      saveBlob(blob, name)
      return { name, size: blob.size, snapshotId, sha256: expected, verified: actual !== null }
    },
  }
}
