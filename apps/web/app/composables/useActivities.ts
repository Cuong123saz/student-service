import type {
  Activity,
  ActivityDetail,
  ActivityDraft,
  ActivityKind,
  ActivityOptions,
  MandatoryOwner,
  StudentActivity,
  StudentRegistrationView,
  RegistrationHistoryItem,
  ActivityRoster,
} from '~/types/activity'
import { trainingFetchError } from '~/utils/training-point'

export type ActivityTransition = 'publish' | 'cancel' | 'suspend' | 'resume'

/** ADR 0030: activity API for managers (CTSV, Phòng ĐT, club leaders) and students. */
export function useActivities() {
  const base = String(useRuntimeConfig().public.apiBase) + '/api/v1/user/activities'
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
    available: () => request<{ items: StudentActivity[]; truncated: boolean }>('/available'),
    list: () => request<{ items: Activity[]; truncated: boolean }>('/manage'),
    options: () => request<ActivityOptions>('/manage/options'),
    detail: (id: string) => request<ActivityDetail>('/manage/' + id),
    create: (
      body: ActivityDraft & { kind: ActivityKind; ownerType?: MandatoryOwner; clubId?: string },
    ) => request<ActivityDetail>('', { method: 'POST', body }),
    update: (id: string, body: ActivityDraft & { expectedRevision: number }) =>
      request<ActivityDetail>('/' + id, { method: 'PATCH', body }),
    transition: (
      id: string,
      action: ActivityTransition,
      expectedRevision: number,
      reason?: string,
    ) =>
      request<ActivityDetail>('/' + id + '/' + action, {
        method: 'POST',
        body: action === 'publish' ? { expectedRevision } : { expectedRevision, reason },
      }),
    // ADR 0031: registration, waitlist and cancellation.
    register: (id: string) =>
      request<StudentRegistrationView>('/' + id + '/registration', { method: 'POST' }),
    withdraw: (id: string) =>
      request<StudentRegistrationView>('/' + id + '/registration/withdraw', { method: 'POST' }),
    requestCancel: (id: string, reason: string) =>
      request<StudentRegistrationView>('/' + id + '/registration/cancel-request', {
        method: 'POST',
        body: { reason },
      }),
    acknowledgePromotion: (id: string) =>
      request<StudentRegistrationView>('/' + id + '/registration/promotion-seen', {
        method: 'POST',
      }),
    history: () =>
      request<{ items: RegistrationHistoryItem[]; truncated: boolean }>('/registrations'),
    roster: (id: string) => request<ActivityRoster>('/manage/' + id + '/registrations'),
    decide: (
      id: string,
      registrationId: string,
      expectedRevision: number,
      accept: boolean,
      note: string,
    ) =>
      request<ActivityRoster>('/manage/' + id + '/registrations/' + registrationId + '/decision', {
        method: 'POST',
        body: { expectedRevision, accept, ...(note ? { note } : {}) },
      }),
    delegate: (id: string, expectedRevision: number, clubId: string | null, reason: string) =>
      request<ActivityDetail>('/' + id + '/delegation', {
        method: 'POST',
        body: { expectedRevision, clubId, ...(reason ? { reason } : {}) },
      }),
  }
}
