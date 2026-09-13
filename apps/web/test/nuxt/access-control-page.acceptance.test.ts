import {
  mountSuspended,
  mockNuxtImport,
} from '@nuxt/test-utils/runtime'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { nextTick, ref } from 'vue'

import AccessControlPage from '../../app/pages/admin/access-control/index.vue'

function createAccessMock() {
  return {
    data: ref(null),
    isLoading: ref(false),
    hasLoaded: ref(false),
    errorMessage: ref(''),
    load: vi.fn(),
    replaceAssignments: vi.fn(),
  }
}

const { logoutMock, navigateToMock } = vi.hoisted(() => ({
  logoutMock: vi.fn(),
  navigateToMock: vi.fn(),
}))

let accessMock = createAccessMock()

mockNuxtImport('useUserAccess', () => (
  () => accessMock
))

mockNuxtImport('navigateTo', () => navigateToMock)

mockNuxtImport('useAdminAuth', () => (
  () => ({ logout: logoutMock })
))

beforeEach(() => {
  accessMock = createAccessMock()
  logoutMock.mockReset()
  navigateToMock.mockReset()
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('trang phân quyền', () => {
  it('yêu cầu đăng nhập lại bằng modal khi phiên quản trị hết hạn', async () => {
    logoutMock.mockRejectedValueOnce(new Error('Server session expired'))
    accessMock.load.mockImplementation(async () => {
      accessMock.hasLoaded.value = true
      accessMock.errorMessage.value =
        'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
      return false
    })

    const wrapper = await mountSuspended(AccessControlPage)
    await nextTick()

    const dialog = document.body.querySelector('[role="dialog"]')
    const loginButton = document.body.querySelector<HTMLButtonElement>(
      '#session-expired-login',
    )

    expect(dialog?.getAttribute('aria-modal')).toBe('true')
    expect(dialog?.textContent).toContain('Vui lòng đăng nhập lại')
    expect(dialog?.textContent).toContain('tài khoản quản trị')
    expect(loginButton).toBeTruthy()
    expect(document.activeElement).toBe(loginButton)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)

    loginButton!.click()
    await nextTick()

    expect(logoutMock).toHaveBeenCalledOnce()
    expect(navigateToMock).toHaveBeenCalledWith(
      '/admin/login',
      { replace: true },
    )
  })

  it('giữ cảnh báo có thể thử lại cho lỗi không phải hết phiên', async () => {
    accessMock.load.mockImplementation(async () => {
      accessMock.hasLoaded.value = true
      accessMock.errorMessage.value =
        'Không thể tải dữ liệu phân quyền. Vui lòng thử lại.'
      return false
    })

    const wrapper = await mountSuspended(AccessControlPage)
    await nextTick()

    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    expect(wrapper.text()).toContain('Không thể tải dữ liệu phân quyền')
    expect(wrapper.text()).toContain('Thử lại')
  })
})
