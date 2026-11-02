import type { ActivitySuggestion, Organizer, SuggestionSettings } from '~/types/activity'
import type { TrainingCriterion } from '~/types/training-point'
import { trainingFetchError } from '~/utils/training-point'

/** ADR 0033: suggestions (student/reviewer), organising committee and per-period settings. */
export function useActivitySuggestions() {
  const root = String(useRuntimeConfig().public.apiBase) + '/api/v1'
  async function request<T>(path: string, options: Parameters<typeof $fetch<T>>[1] = {}) {
    try {
      return await $fetch<T>(root + path, { ...options, credentials: 'include' })
    } catch (e) {
      throw await trainingFetchError(e)
    }
  }
  return {
    forStudent: (declarationId: string) =>
      request<ActivitySuggestion>(
        '/user/training-declarations/' + declarationId + '/activity-suggestions',
      ),
    forReview: (declarationId: string) =>
      request<ActivitySuggestion>(
        '/user/training-reviews/' + declarationId + '/activity-suggestions',
      ),
    organizers: (activityId: string) =>
      request<{ canEdit: boolean; items: Organizer[] }>(
        '/user/activities/manage/' + activityId + '/organizers',
      ),
    addOrganizer: (activityId: string, studentCode: string) =>
      request<{ canEdit: boolean; items: Organizer[] }>(
        '/user/activities/manage/' + activityId + '/organizers',
        {
          method: 'POST',
          body: { studentCode },
        },
      ),
    removeOrganizer: (activityId: string, organizerId: string) =>
      request<{ canEdit: boolean; items: Organizer[] }>(
        '/user/activities/manage/' + activityId + '/organizers/' + organizerId + '/remove',
        { method: 'POST' },
      ),
    settings: (periodId: string) =>
      request<{
        settings: SuggestionSettings
        revision: number
        isDefault: boolean
        criteria: TrainingCriterion[]
      }>('/admin/training-periods/' + periodId + '/activity-settings'),
    saveSettings: (periodId: string, expectedRevision: number, settings: SuggestionSettings) =>
      request<{
        settings: SuggestionSettings
        revision: number
        isDefault: boolean
        criteria: TrainingCriterion[]
      }>('/admin/training-periods/' + periodId + '/activity-settings', {
        method: 'PUT',
        body: { expectedRevision, settings },
      }),
  }
}
