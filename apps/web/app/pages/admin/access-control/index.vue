<script setup lang="ts">
import type { SystemRoleCode } from '~/types/auth'
import type {
  AccessRole,
  AccessScope,
  ManagedAccessUser,
  UserAccessApiError,
} from '~/types/user-access'

definePageMeta({
  layout: 'admin',
  middleware: 'admin-auth',
})

const { data, isLoading, hasLoaded, errorMessage, load, replaceAssignments } = useUserAccess()
const { logout } = useAdminAuth()

const search = ref('')
const appliedSearch = ref('')
const editingUser = ref<ManagedAccessUser | null>(null)
const selectedRoles = ref<SystemRoleCode[]>([])
const scopeDrafts = reactive<Partial<Record<SystemRoleCode, string[]>>>({})
const isSaving = ref(false)
const editorError = ref('')
const feedback = ref('')
const isRedirectingToLogin = ref(false)

const users = computed(() => data.value?.users ?? [])
const roles = computed(() => data.value?.roles ?? [])
const scopes = computed(() => data.value?.scopes ?? [])
const activeCount = computed(() => users.value.filter((user) => user.status === 'ACTIVE').length)
const assignedCount = computed(
  () =>
    users.value.filter((user) =>
      user.assignments.some((assignment) => assignment.scopeIds.length > 0),
    ).length,
)
const sessionExpired = computed(
  () => errorMessage.value.includes('hết hạn') || editorError.value.includes('hết hạn'),
)

watch(sessionExpired, async (expired) => {
  if (!expired) return
  await nextTick()
  document.getElementById('session-expired-login')?.focus()
})

async function goToAdminLogin() {
  if (isRedirectingToLogin.value) return
  isRedirectingToLogin.value = true
  try {
    await logout()
  } catch {
    // The server session may already be gone; local auth state is cleared in logout().
  }
  await navigateTo('/admin/login', { replace: true })
}

function scopeLabel(scopeId: string) {
  return scopes.value.find((scope) => scope.id === scopeId)?.label ?? 'Phạm vi không còn khả dụng'
}

function scopesForRole(role: AccessRole): AccessScope[] {
  return scopes.value.filter((scope) => role.allowedScopeTypes.includes(scope.type))
}

function openEditor(user: ManagedAccessUser) {
  editingUser.value = user
  selectedRoles.value = user.assignments.map((row) => row.roleCode)
  for (const role of roles.value) scopeDrafts[role.code] = []
  for (const assignment of user.assignments) {
    scopeDrafts[assignment.roleCode] = [...assignment.scopeIds]
  }
  editorError.value = ''
  feedback.value = ''
}

function closeEditor() {
  editingUser.value = null
  selectedRoles.value = []
  editorError.value = ''
}

function toggleRole(role: AccessRole, checked: boolean) {
  if (checked) {
    if (!selectedRoles.value.includes(role.code)) {
      selectedRoles.value = [...selectedRoles.value, role.code]
    }
    if (role.code === 'SYSTEM_ADMIN') {
      const globalScope = scopes.value.find((scope) => scope.type === 'GLOBAL')
      scopeDrafts[role.code] = globalScope ? [globalScope.id] : []
    } else if (!scopeDrafts[role.code]) {
      scopeDrafts[role.code] = []
    }
  } else {
    selectedRoles.value = selectedRoles.value.filter((code) => code !== role.code)
    scopeDrafts[role.code] = []
  }
  editorError.value = ''
}

function toggleScope(roleCode: SystemRoleCode, scopeId: string, checked: boolean) {
  const current = scopeDrafts[roleCode] ?? []
  scopeDrafts[roleCode] = checked
    ? [...new Set([...current, scopeId])]
    : current.filter((id) => id !== scopeId)
  editorError.value = ''
}

function isScopeSelected(roleCode: SystemRoleCode, scopeId: string) {
  return (scopeDrafts[roleCode] ?? []).includes(scopeId)
}

async function applySearch() {
  appliedSearch.value = search.value.trim()
  closeEditor()
  await load(appliedSearch.value)
}

async function clearSearch() {
  search.value = ''
  appliedSearch.value = ''
  closeEditor()
  await load()
}

async function saveAssignments() {
  const user = editingUser.value
  if (!user || isSaving.value) return
  if (selectedRoles.value.length === 0) {
    editorError.value = 'Tài khoản phải có ít nhất một vai trò.'
    return
  }

  const assignments = selectedRoles.value.map((roleCode) => ({
    roleCode,
    scopeIds: [...(scopeDrafts[roleCode] ?? [])],
  }))
  const missingScopeRole = assignments.find(
    (assignment) => assignment.roleCode !== 'STUDENT' && assignment.scopeIds.length === 0,
  )
  if (missingScopeRole) {
    const role = roles.value.find((item) => item.code === missingScopeRole.roleCode)
    editorError.value = `Vui lòng chọn phạm vi cho vai trò ${role?.name ?? missingScopeRole.roleCode}.`
    return
  }

  isSaving.value = true
  editorError.value = ''
  feedback.value = ''
  try {
    await replaceAssignments(user.id, assignments)
    await load(appliedSearch.value)
    closeEditor()
    feedback.value = `Đã cập nhật quyền truy cập cho ${user.fullName}.`
  } catch (error: unknown) {
    const parsed = error as UserAccessApiError
    if (parsed.status === 401) {
      editorError.value = 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
    } else if (parsed.status === 403) {
      editorError.value = 'Bạn không được phép cấp vai trò hoặc phạm vi đã chọn.'
    } else if (parsed.status === 409) {
      editorError.value =
        parsed.field === 'userId'
          ? 'Bạn không thể tự thay đổi quyền của chính mình.'
          : 'Không thể thu hồi vai trò khi người dùng còn nhiệm vụ đang hiệu lực hoặc dữ liệu chưa thay đổi.'
    } else if (parsed.status === 422) {
      editorError.value = 'Vai trò và phạm vi chưa tương thích. Vui lòng kiểm tra lại.'
    } else {
      editorError.value = 'Không thể lưu phân quyền. Vui lòng thử lại.'
    }
  } finally {
    isSaving.value = false
  }
}

onMounted(() => {
  void load()
})
</script>

<template>
  <section
    class="access-page"
    :inert="sessionExpired"
    :aria-hidden="sessionExpired ? 'true' : undefined"
  >
    <header class="access-page__header">
      <div>
        <p class="page-eyebrow">Kiểm soát truy cập</p>
        <h1 class="page-title">Vai trò và phạm vi dữ liệu</h1>
        <p class="page-description">
          Cấp đúng vai trò cho từng tài khoản và giới hạn dữ liệu theo khoa, lớp hoặc đơn vị.
        </p>
      </div>
      <NuxtLink class="access-page__guide" to="/admin/organizations"> Quản lý cơ cấu → </NuxtLink>
    </header>

    <div v-if="data" class="access-page__metrics">
      <article>
        <span>Tài khoản hiển thị</span><strong>{{ users.length }}</strong>
      </article>
      <article>
        <span>Đang hoạt động</span><strong>{{ activeCount }}</strong>
      </article>
      <article>
        <span>Đã có phạm vi</span><strong>{{ assignedCount }}</strong>
      </article>
      <article>
        <span>Vai trò có thể cấp</span><strong>{{ roles.length }}</strong>
      </article>
    </div>

    <form class="access-page__search surface-card" @submit.prevent="applySearch">
      <label for="access-search">Tìm tài khoản</label>
      <div>
        <input
          id="access-search"
          v-model="search"
          type="search"
          maxlength="100"
          placeholder="Tên, username hoặc email"
          :disabled="isLoading"
        />
        <BaseButton type="submit" :loading="isLoading">Tìm kiếm</BaseButton>
        <button v-if="appliedSearch" type="button" @click="clearSearch">Xóa lọc</button>
      </div>
    </form>

    <BaseAlert v-if="feedback" variant="success" title="Đã lưu thay đổi">
      {{ feedback }}
    </BaseAlert>

    <div v-if="isLoading" class="access-page__loading" role="status">
      <img src="/images/naem-logo.jpg" alt="" />
      <div>
        <strong>Đang tải dữ liệu phân quyền</strong
        ><span>Hệ thống đang đối chiếu permission và scope…</span>
      </div>
    </div>

    <BaseAlert
      v-else-if="errorMessage && !sessionExpired"
      variant="error"
      title="Không thể tải phân quyền"
    >
      {{ errorMessage }}
      <div class="access-page__error-actions">
        <BaseButton type="button" variant="secondary" @click="load(appliedSearch)"
          >Thử lại</BaseButton
        >
      </div>
    </BaseAlert>

    <div v-else-if="hasLoaded && users.length === 0" class="access-page__empty surface-card">
      <span aria-hidden="true">⌕</span>
      <h2>Không tìm thấy tài khoản phù hợp</h2>
      <p>Thử thay đổi từ khóa hoặc kiểm tra phạm vi dữ liệu được giao.</p>
    </div>

    <div v-else-if="data" class="access-page__content">
      <div class="access-page__table surface-card">
        <table>
          <thead>
            <tr>
              <th>Người dùng</th>
              <th>Trạng thái</th>
              <th>Vai trò và phạm vi</th>
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="account in users" :key="account.id">
              <td>
                <strong>{{ account.fullName }}</strong>
                <small
                  >{{ account.username
                  }}<template v-if="account.studentCode">
                    · {{ account.studentCode }}</template
                  ></small
                >
                <small>{{ account.email || 'Chưa có email' }}</small>
              </td>
              <td>
                <span :class="`access-status access-status--${account.status.toLowerCase()}`">
                  {{ account.status }}
                </span>
              </td>
              <td>
                <div v-if="account.assignments.length" class="access-page__assignments">
                  <div v-for="assignment in account.assignments" :key="assignment.roleCode">
                    <strong>{{ assignment.roleName }}</strong>
                    <span v-if="assignment.scopeIds.length">
                      {{ assignment.scopeIds.map(scopeLabel).join(', ') }}
                    </span>
                    <span v-else>Không dùng phạm vi dữ liệu</span>
                  </div>
                </div>
                <span v-else class="access-page__unconfigured">Chưa có vai trò</span>
              </td>
              <td>
                <button
                  v-if="account.canManage"
                  type="button"
                  class="access-page__edit-button"
                  @click="openEditor(account)"
                >
                  Phân quyền
                </button>
                <span v-else class="access-page__read-only">Chỉ xem</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <aside
        v-if="editingUser"
        class="access-editor surface-card"
        aria-labelledby="access-editor-title"
      >
        <header>
          <div>
            <p>Đang phân quyền</p>
            <h2 id="access-editor-title">{{ editingUser.fullName }}</h2>
            <span>{{ editingUser.username }}</span>
          </div>
          <button type="button" aria-label="Đóng" :disabled="isSaving" @click="closeEditor">
            ×
          </button>
        </header>

        <BaseAlert v-if="editorError" variant="error" title="Chưa thể lưu">
          {{ editorError }}
        </BaseAlert>

        <div class="access-editor__roles">
          <article v-for="role in roles" :key="role.code">
            <label class="access-editor__role-toggle">
              <input
                type="checkbox"
                :checked="selectedRoles.includes(role.code)"
                :disabled="isSaving || role.code === 'STUDENT'"
                @change="toggleRole(role, ($event.target as HTMLInputElement).checked)"
              />
              <span
                ><strong>{{ role.name }}</strong
                ><small>{{ role.description }}</small></span
              >
            </label>

            <div
              v-if="selectedRoles.includes(role.code) && role.allowedScopeTypes.length"
              class="access-editor__scopes"
            >
              <p>Phạm vi áp dụng</p>
              <label v-for="scope in scopesForRole(role)" :key="scope.id">
                <input
                  type="checkbox"
                  :checked="isScopeSelected(role.code, scope.id)"
                  :disabled="isSaving || role.code === 'SYSTEM_ADMIN'"
                  @change="
                    toggleScope(role.code, scope.id, ($event.target as HTMLInputElement).checked)
                  "
                />
                <span
                  ><small>{{ scope.type }}</small
                  >{{ scope.label }}</span
                >
              </label>
            </div>
            <p v-else-if="selectedRoles.includes(role.code)" class="access-editor__no-scope">
              Vai trò sinh viên đi cùng hồ sơ học vụ, chỉ truy cập dữ liệu cá nhân và không chỉnh
              tại đây.
            </p>
          </article>
        </div>

        <footer>
          <button type="button" :disabled="isSaving" @click="closeEditor">Hủy</button>
          <BaseButton type="button" :loading="isSaving" @click="saveAssignments">
            Lưu phân quyền
          </BaseButton>
        </footer>
      </aside>
    </div>
  </section>

  <Teleport to="body">
    <div v-if="sessionExpired" class="session-expired-modal">
      <div
        class="session-expired-modal__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-expired-title"
        aria-describedby="session-expired-description"
      >
        <span class="session-expired-modal__icon" aria-hidden="true">!</span>
        <p class="session-expired-modal__eyebrow">Phiên quản trị đã kết thúc</p>
        <h2 id="session-expired-title">Vui lòng đăng nhập lại</h2>
        <p id="session-expired-description">
          Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại bằng tài khoản quản trị để tiếp tục quản lý
          phân quyền.
        </p>
        <BaseButton
          id="session-expired-login"
          type="button"
          block
          :loading="isRedirectingToLogin"
          @click="goToAdminLogin"
        >
          Đăng nhập lại
        </BaseButton>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.access-page {
  display: grid;
  gap: 22px;
}
.access-page__header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
}
.access-page__header > div {
  max-width: 720px;
}
.access-page__guide {
  flex: 0 0 auto;
  color: var(--color-primary);
  font-size: 13px;
  font-weight: 800;
  text-decoration: none;
}
.access-page__metrics {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}
.access-page__metrics article {
  display: grid;
  gap: 5px;
  padding: 16px 18px;
  border: 1px solid var(--color-border);
  border-radius: 15px;
  background: var(--color-surface);
  box-shadow: 0 4px 18px rgb(15 23 42 / 4%);
}
.access-page__metrics span {
  color: var(--color-muted);
  font-size: 12px;
  font-weight: 700;
}
.access-page__metrics strong {
  color: var(--color-primary-dark);
  font-size: 25px;
}
.access-page__search {
  display: grid;
  gap: 8px;
  padding: 16px 18px;
  border-radius: 15px;
}
.access-page__search > label {
  color: var(--color-muted);
  font-size: 12px;
  font-weight: 800;
}
.access-page__search > div {
  display: flex;
  gap: 8px;
}
.access-page__search input {
  min-width: 0;
  min-height: 42px;
  flex: 1;
  padding: 9px 12px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
}
.access-page__search input:focus {
  border-color: var(--color-primary);
  outline: 0;
  box-shadow: 0 0 0 3px rgb(21 94 239 / 10%);
}
.access-page__search button:not([class]) {
  border: 0;
  color: var(--color-primary);
  background: transparent;
  cursor: pointer;
  font-weight: 750;
}
.access-page__loading {
  display: flex;
  min-height: 260px;
  align-items: center;
  justify-content: center;
  gap: 17px;
  border: 1px solid var(--color-border);
  border-radius: 18px;
  background: var(--color-surface);
}
.access-page__loading img {
  width: 56px;
  height: 56px;
  border-radius: 13px;
  object-fit: cover;
  animation: access-pulse 1.4s ease-in-out infinite;
}
.access-page__loading div {
  display: grid;
  gap: 4px;
}
.access-page__loading span {
  color: var(--color-muted);
  font-size: 13px;
}
.access-page__error-actions {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 10px;
}
.session-expired-modal {
  position: fixed;
  z-index: 1000;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgb(7 16 30 / 68%);
  backdrop-filter: blur(4px);
}
.session-expired-modal__dialog {
  display: grid;
  width: min(100%, 440px);
  justify-items: center;
  padding: 34px;
  border: 1px solid rgb(255 255 255 / 55%);
  border-radius: 22px;
  background: var(--color-surface);
  box-shadow: 0 24px 80px rgb(7 16 30 / 32%);
  text-align: center;
}
.session-expired-modal__icon {
  display: grid;
  width: 52px;
  height: 52px;
  place-items: center;
  margin-bottom: 18px;
  border-radius: 16px;
  color: #fff;
  background: var(--color-primary);
  font-size: 26px;
  font-weight: 850;
}
.session-expired-modal__eyebrow {
  margin: 0 0 6px;
  color: var(--color-primary);
  font-size: 11px;
  font-weight: 850;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.session-expired-modal__dialog h2 {
  margin: 0;
  color: var(--color-primary-dark);
  font-size: 25px;
}
.session-expired-modal__dialog > p:not(.session-expired-modal__eyebrow) {
  max-width: 360px;
  margin: 12px 0 22px;
  color: var(--color-muted);
  line-height: 1.65;
}
.access-page__empty {
  display: grid;
  min-height: 280px;
  place-items: center;
  align-content: center;
  gap: 8px;
  text-align: center;
}
.access-page__empty > span {
  color: var(--color-primary);
  font-size: 38px;
}
.access-page__empty h2,
.access-page__empty p {
  margin: 0;
}
.access-page__empty p {
  color: var(--color-muted);
}
.access-page__content {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 18px;
}
.access-page__content:has(.access-editor) {
  grid-template-columns: minmax(0, 1fr) 390px;
  align-items: start;
}
.access-page__table {
  overflow-x: auto;
  border-radius: 18px;
}
.access-page table {
  width: 100%;
  min-width: 820px;
  border-collapse: collapse;
  font-size: 12px;
}
.access-page th {
  padding: 12px 15px;
  border-bottom: 1px solid var(--color-border);
  color: var(--color-muted);
  background: #f8fafc;
  font-size: 10px;
  letter-spacing: 0.045em;
  text-align: left;
  text-transform: uppercase;
}
.access-page td {
  padding: 15px;
  border-bottom: 1px solid var(--color-border);
  vertical-align: top;
}
.access-page tbody tr:last-child td {
  border-bottom: 0;
}
.access-page td > strong,
.access-page td > small {
  display: block;
}
.access-page td > small {
  max-width: 220px;
  margin-top: 3px;
  overflow: hidden;
  color: var(--color-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.access-status {
  display: inline-flex;
  padding: 5px 8px;
  border-radius: 999px;
  color: var(--color-muted);
  background: #edf1f5;
  font-size: 10px;
  font-weight: 850;
}
.access-status--active {
  color: var(--color-success);
  background: var(--color-success-background);
}
.access-status--invited {
  color: #915b09;
  background: #fff4d6;
}
.access-status--suspended {
  color: var(--color-error);
  background: var(--color-error-background);
}
.access-page__assignments {
  display: grid;
  gap: 7px;
}
.access-page__assignments > div {
  display: grid;
  gap: 2px;
}
.access-page__assignments strong {
  color: var(--color-primary-dark);
  font-size: 11px;
}
.access-page__assignments span {
  max-width: 400px;
  overflow: hidden;
  color: var(--color-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.access-page__unconfigured {
  color: var(--color-error);
  font-weight: 750;
}
.access-page__edit-button {
  min-height: 36px;
  padding: 7px 11px;
  border: 1px solid #b9d6ff;
  border-radius: 9px;
  color: var(--color-primary-dark);
  background: var(--color-primary-soft);
  cursor: pointer;
  font-size: 11px;
  font-weight: 800;
}
.access-page__read-only {
  color: var(--color-subtle);
  font-size: 11px;
}
.access-editor {
  position: sticky;
  top: 24px;
  display: grid;
  gap: 16px;
  max-height: calc(100vh - 48px);
  overflow-y: auto;
  padding: 20px;
  border-radius: 18px;
}
.access-editor > header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 13px;
  border-bottom: 1px solid var(--color-border);
}
.access-editor > header p,
.access-editor > header h2,
.access-editor > header span {
  margin: 0;
}
.access-editor > header p {
  color: var(--color-primary);
  font-size: 10px;
  font-weight: 850;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.access-editor > header h2 {
  margin-top: 4px;
  font-size: 18px;
}
.access-editor > header span {
  color: var(--color-muted);
  font-size: 12px;
}
.access-editor > header button {
  width: 34px;
  height: 34px;
  border: 1px solid var(--color-border);
  border-radius: 9px;
  color: var(--color-muted);
  background: #fff;
  cursor: pointer;
  font-size: 20px;
}
.access-editor__roles {
  display: grid;
  gap: 10px;
}
.access-editor__roles > article {
  padding: 12px;
  border: 1px solid var(--color-border);
  border-radius: 12px;
}
.access-editor__role-toggle {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  cursor: pointer;
}
.access-editor__role-toggle input {
  width: 17px;
  height: 17px;
  margin-top: 2px;
  accent-color: var(--color-primary);
}
.access-editor__role-toggle span {
  display: grid;
  gap: 2px;
}
.access-editor__role-toggle strong {
  color: var(--color-primary-dark);
  font-size: 13px;
}
.access-editor__role-toggle small {
  color: var(--color-muted);
  line-height: 1.4;
}
.access-editor__scopes {
  display: grid;
  gap: 6px;
  margin: 11px 0 0 27px;
  padding-top: 10px;
  border-top: 1px dashed var(--color-border);
}
.access-editor__scopes > p {
  margin: 0 0 2px;
  color: var(--color-muted);
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
}
.access-editor__scopes label {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 7px;
  border-radius: 7px;
  cursor: pointer;
}
.access-editor__scopes label:hover {
  background: #f7faff;
}
.access-editor__scopes input {
  margin-top: 3px;
  accent-color: var(--color-primary);
}
.access-editor__scopes span {
  display: grid;
  color: var(--color-text);
  font-size: 11px;
}
.access-editor__scopes small {
  color: var(--color-primary);
  font-size: 9px;
  font-weight: 850;
}
.access-editor__no-scope {
  margin: 9px 0 0 27px;
  color: var(--color-muted);
  font-size: 11px;
}
.access-editor > footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 14px;
  border-top: 1px solid var(--color-border);
}
.access-editor > footer > button {
  min-height: 40px;
  padding: 8px 13px;
  border: 1px solid var(--color-border);
  border-radius: 9px;
  background: #fff;
  cursor: pointer;
  font-weight: 750;
}
@keyframes access-pulse {
  50% {
    transform: scale(0.95);
    opacity: 0.7;
  }
}
@media (max-width: 1100px) {
  .access-page__content:has(.access-editor) {
    grid-template-columns: 1fr;
  }
  .access-editor {
    position: static;
    max-height: none;
    grid-row: 1;
  }
}
@media (max-width: 760px) {
  .access-page__header {
    align-items: flex-start;
    flex-direction: column;
  }
  .access-page__metrics {
    grid-template-columns: 1fr 1fr;
  }
  .access-page__search > div {
    flex-wrap: wrap;
  }
  .access-page__search input {
    flex-basis: 100%;
  }
}
</style>
