import type { AuditLogItem, AuditLogListResponse } from '../types/audit-log'
import { computed, readonly, ref } from 'vue'
import { getApiErrorContext } from '../utils/api-error'

const DEFAULT_PAGE_SIZE = 25

interface AuditLogRequestOptions {
  credentials: 'include'
  query: {
    limit: number
    before?: string
    action?: string
  }
}

export type AuditLogFetcher = <Response>(
  url: string,
  options: AuditLogRequestOptions,
) => Promise<Response>

export interface UseAuditLogsOptions {
  apiBase?: string
  fetcher?: AuditLogFetcher
  pageSize?: number
}

const defaultFetcher: AuditLogFetcher = async <Response>(url, options) =>
  await $fetch<Response>(url, options)

export function useAuditLogs(options: UseAuditLogsOptions = {}) {
  const apiBase = options.apiBase ?? useRuntimeConfig().public.apiBase
  const fetcher = options.fetcher ?? defaultFetcher
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE

  const auditLogs = ref<AuditLogItem[]>([])
  const isLoading = ref(false)
  const hasLoaded = ref(false)
  const errorMessage = ref('')
  const appliedAction = ref('')

  // cursorBefore là query phân trang. Không nhầm với
  // before snapshot nằm trong từng AuditLogItem.
  const cursorBefore = ref<string | undefined>()
  const cursorHistory = ref<Array<string | undefined>>([])
  const nextCursorBefore = ref<string | null>(null)

  const pageNumber = computed(() => cursorHistory.value.length + 1)

  async function requestPage(requestedCursorBefore: string | undefined): Promise<boolean> {
    if (isLoading.value) {
      return false
    }

    isLoading.value = true
    errorMessage.value = ''

    try {
      const response = await fetcher<AuditLogListResponse>(`${apiBase}/api/v1/admin/audit-logs`, {
        credentials: 'include',
        query: {
          limit: pageSize,
          ...(requestedCursorBefore ? { before: requestedCursorBefore } : {}),
          ...(appliedAction.value ? { action: appliedAction.value } : {}),
        },
      })

      auditLogs.value = response.auditLogs
      cursorBefore.value = requestedCursorBefore

      const lastEvent = response.auditLogs.at(-1)
      nextCursorBefore.value =
        response.auditLogs.length === pageSize && lastEvent ? lastEvent.occurredAt : null

      return true
    } catch (error: unknown) {
      const apiError = getApiErrorContext(error)

      if (apiError.status === 401) {
        errorMessage.value = 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
      } else if (apiError.status === 403) {
        errorMessage.value = 'Tài khoản của bạn chưa được cấp quyền xem audit log.'
      } else if (apiError.status === 400) {
        errorMessage.value = 'Bộ lọc audit log không hợp lệ.'
      } else {
        errorMessage.value = 'Không thể tải audit log. Vui lòng thử lại sau.'
      }

      return false
    } finally {
      isLoading.value = false
      hasLoaded.value = true
    }
  }

  async function load(action = ''): Promise<boolean> {
    if (isLoading.value) {
      return false
    }

    appliedAction.value = action
    cursorHistory.value = []
    cursorBefore.value = undefined
    nextCursorBefore.value = null

    return await requestPage(undefined)
  }

  async function nextPage(): Promise<boolean> {
    const nextCursor = nextCursorBefore.value

    if (!nextCursor || isLoading.value) {
      return false
    }

    const previousCursor = cursorBefore.value
    cursorHistory.value.push(previousCursor)

    const succeeded = await requestPage(nextCursor)

    if (!succeeded) {
      cursorHistory.value.pop()
    }

    return succeeded
  }

  async function previousPage(): Promise<boolean> {
    if (cursorHistory.value.length === 0 || isLoading.value) {
      return false
    }

    const previousCursor = cursorHistory.value.pop()
    const succeeded = await requestPage(previousCursor)

    if (!succeeded) {
      cursorHistory.value.push(previousCursor)
    }

    return succeeded
  }

  return {
    auditLogs: readonly(auditLogs),
    isLoading: readonly(isLoading),
    hasLoaded: readonly(hasLoaded),
    errorMessage: readonly(errorMessage),
    appliedAction: readonly(appliedAction),
    nextCursorBefore: readonly(nextCursorBefore),
    pageNumber,

    load,
    nextPage,
    previousPage,
  }
}
