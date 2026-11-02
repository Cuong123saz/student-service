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
  AttendanceQueue,
  Certificate,
  MyAttendance,
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
    // ADR 0032: check-in, photo, review and certificates.
    attendance: (id: string) => request<MyAttendance>('/' + id + '/attendance'),
    scan: (id: string, code: string) =>
      request<MyAttendance>('/' + id + '/attendance/scan', { method: 'POST', body: { code } }),
    submitPhoto: (id: string, photo: Blob) => {
      const body = new FormData()
      body.append('photo', photo, 'attendance.jpg')
      return request<MyAttendance>('/' + id + '/attendance/photo', { method: 'POST', body })
    },
    certificates: () => request<{ items: Certificate[] }>('/certificates'),
    attendanceQueue: (id: string) => request<AttendanceQueue>('/manage/' + id + '/attendance'),
    attendancePhoto: (id: string, attendanceId: string) =>
      request<Blob>('/manage/' + id + '/attendance/' + attendanceId + '/photo', {
        responseType: 'blob',
      }),
    review: (
      id: string,
      entries: { id: string; revision: number }[],
      approve: boolean,
      note: string,
    ) =>
      request<AttendanceQueue>('/manage/' + id + '/attendance/review', {
        method: 'POST',
        body: { entries, approve, ...(note ? { note } : {}) },
      }),
    revokeCertificate: (certificateId: string, reason: string) =>
      request<{ activityId: string }>('/certificates/' + certificateId + '/revoke', {
        method: 'POST',
        body: { reason },
      }),
    checkinQr: (id: string) =>
      request<Blob>('/manage/' + id + '/checkin-qr.svg', { responseType: 'blob' }),
    configureCheckin: (
      id: string,
      expectedRevision: number,
      change: { reset: true } | { rotating: boolean },
    ) =>
      request<ActivityDetail>('/manage/' + id + '/checkin', {
        method: 'POST',
        body: { expectedRevision, ...change },
      }),
    delegate: (id: string, expectedRevision: number, clubId: string | null, reason: string) =>
      request<ActivityDetail>('/' + id + '/delegation', {
        method: 'POST',
        body: { expectedRevision, clubId, ...(reason ? { reason } : {}) },
      }),
  }
}
