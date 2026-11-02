import type { ClubDetail, ClubList, ClubStatus } from '~/types/club'
import { trainingFetchError } from '~/utils/training-point'

/** ADR 0029: user-portal club API (CTSV manages, Phòng Đào tạo and leaders read). */
export function useClubs() {
  const base = String(useRuntimeConfig().public.apiBase) + '/api/v1/user/clubs'
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
    list: () => request<ClubList>(''),
    detail: (id: string) => request<ClubDetail>('/' + id),
    create: (body: { code: string; name: string; description: string }) =>
      request<ClubDetail>('', { method: 'POST', body }),
    update: (id: string, body: { expectedRevision: number; name: string; description: string }) =>
      request<ClubDetail>('/' + id, { method: 'PATCH', body }),
    changeStatus: (
      id: string,
      body: { expectedRevision: number; status: ClubStatus; reason: string },
    ) => request<ClubDetail>('/' + id + '/status', { method: 'POST', body }),
    assignLeader: (id: string, username: string) =>
      request<ClubDetail>('/' + id + '/leaders', { method: 'POST', body: { username } }),
    endLeader: (id: string, assignmentId: string, reason: string) =>
      request<ClubDetail>('/' + id + '/leaders/' + assignmentId + '/end', {
        method: 'POST',
        body: { reason },
      }),
  }
}
