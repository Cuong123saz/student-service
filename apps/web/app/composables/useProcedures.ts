import type {
  ProcedureApiError,
  ProcedureCatalog,
  ProcedureConfig,
  ProcedureVersion,
} from '~/types/procedure'
export function readProcedureError(error: unknown): ProcedureApiError {
  const e = error as {
    statusCode?: number
    response?: { status?: number }
    data?: { message?: string; issues?: ProcedureApiError['issues'] }
  } | null
  const status = e?.statusCode ?? e?.response?.status
  const message =
    status === 401
      ? 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
      : status === 403
        ? 'Bạn chưa được cấp quyền cấu hình thủ tục trong đơn vị này.'
        : status === 409
          ? (e?.data?.message ??
            'Có người đã cập nhật cấu hình. Nội dung bạn đang nhập được giữ lại; hãy tải bản mới để đối chiếu.')
          : (e?.data?.message ?? 'Không thể kết nối tới máy chủ. Vui lòng thử lại.')
  return {
    ...(status ? { status } : {}),
    message,
    issues: Array.isArray(e?.data?.issues) ? e.data.issues : [],
  }
}
export function useProcedures() {
  const runtime = useRuntimeConfig()
  const base = String(runtime.public.apiBase) + '/api/v1/admin'
  async function request<T>(
    path: string,
    options: Parameters<typeof $fetch<T>>[1] = {},
  ): Promise<T> {
    try {
      return await $fetch<T>(base + path, { ...options, credentials: 'include' })
    } catch (error) {
      throw readProcedureError(error)
    }
  }
  return {
    catalog: () => request<ProcedureCatalog>('/procedure-catalog'),
    list: (serviceId: number) =>
      request<ProcedureVersion[]>('/services/' + serviceId + '/procedure-versions'),
    create: (serviceId: number, ownerUnitId: string, cloneVersionId: string | null) =>
      request<ProcedureVersion>('/services/' + serviceId + '/procedure-versions', {
        method: 'POST',
        body: { ownerUnitId, cloneVersionId },
      }),
    update: (id: string, expectedRevision: number, config: ProcedureConfig) =>
      request<ProcedureVersion>('/procedure-versions/' + id, {
        method: 'PUT',
        body: { expectedRevision, config },
      }),
    validate: (id: string) =>
      request<{ valid: boolean; issues: ProcedureApiError['issues'] }>(
        '/procedure-versions/' + id + '/validate',
        { method: 'POST' },
      ),
    publish: (id: string, expectedRevision: number) =>
      request<ProcedureVersion>('/procedure-versions/' + id + '/publish', {
        method: 'POST',
        body: { expectedRevision },
      }),
  }
}
