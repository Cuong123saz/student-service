import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { defineComponent } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useReviewSubmissions } from '../../app/composables/useReviewSubmissions'

async function setupApi(portal: 'user' | 'admin') {
  let api!: ReturnType<typeof useReviewSubmissions>
  const wrapper = await mountSuspended(
    defineComponent({
      setup() {
        api = useReviewSubmissions(portal)
        return () => null
      },
    }),
  )
  wrapper.unmount()
  return api
}
const { fetcher } = vi.hoisted(() => ({ fetcher: vi.fn() }))
mockNuxtImport('$fetch', () => fetcher)
beforeEach(() => {
  fetcher.mockReset()
})

describe('review submission API', () => {
  it.each(['user', 'admin'] as const)(
    'keeps %s session/prefix, sends status query and saved revision',
    async (portal) => {
      const api = await setupApi(portal)
      const base = 'http://localhost:3000/api/v1/' + portal + '/review-submissions'
      fetcher.mockResolvedValue([])
      await api.list('SUBMITTED')
      expect(fetcher).toHaveBeenLastCalledWith(base, {
        query: { status: 'SUBMITTED' },
        credentials: 'include',
      })
      await api.list('IN_REVIEW')
      expect(fetcher).toHaveBeenLastCalledWith(base, {
        query: { status: 'IN_REVIEW' },
        credentials: 'include',
      })
      await api.list()
      expect(fetcher).toHaveBeenLastCalledWith(base, { credentials: 'include' })
      await api.get('submission/1')
      expect(fetcher).toHaveBeenLastCalledWith(base + '/submission%2F1', { credentials: 'include' })
      await api.claim('submission/1', 4)
      expect(fetcher).toHaveBeenLastCalledWith(base + '/submission%2F1/claim', {
        method: 'POST',
        body: { expectedRevision: 4 },
        credentials: 'include',
      })
      expect(api.downloadUrl('submission/1', 'file/1')).toBe(
        base + '/submission%2F1/files/file%2F1',
      )
    },
  )
  it('preserves conflict context for required status reloads', async () => {
    fetcher.mockRejectedValue({
      statusCode: 409,
      data: {
        code: 'CONFLICT',
        message: 'Hồ sơ đã được nhận',
        requestId: 'req-intake',
        issues: [],
      },
    })
    const api = await setupApi('user')
    await expect(api.claim('id', 3)).rejects.toMatchObject({
      status: 409,
      code: 'CONFLICT',
      message: 'Hồ sơ đã được nhận',
      requestId: 'req-intake',
      issues: [],
    })
  })
})
