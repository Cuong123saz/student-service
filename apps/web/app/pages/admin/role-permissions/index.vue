<script setup lang="ts">
import type { ManagedRolePermissions, RolePermissionApiError } from '~/types/role-permission'

definePageMeta({
  layout: 'admin',
  middleware: 'admin-auth',
})

const { data, isLoading, hasLoaded, errorMessage, load, replacePermissions } = useRolePermissions()

const drafts = reactive<Record<number, string[]>>({})
const savingRoleId = ref<number | null>(null)
const feedback = ref<{
  variant: 'success' | 'error'
  title: string
  message: string
} | null>(null)

const roles = computed(() => data.value?.roles ?? [])
const permissions = computed(() => data.value?.permissions ?? [])
const grantCount = computed(() =>
  roles.value.reduce((total, role) => total + role.permissionCodes.length, 0),
)
const sensitiveCodes = new Set(['role.manage', 'audit.read'])

function syncDrafts() {
  for (const role of roles.value) {
    drafts[role.id] = [...role.permissionCodes]
  }
}

async function loadPage() {
  const loaded = await load()
  if (loaded) syncDrafts()
}

function isSelected(roleId: number, permissionCode: string) {
  return (drafts[roleId] ?? []).includes(permissionCode)
}

function togglePermission(role: ManagedRolePermissions, permissionCode: string, checked: boolean) {
  if (!role.canManage || savingRoleId.value !== null) return
  const current = drafts[role.id] ?? []
  drafts[role.id] = checked
    ? [...new Set([...current, permissionCode])].sort()
    : current.filter((code) => code !== permissionCode)
  feedback.value = null
}

function normalized(codes: string[]) {
  return [...codes].sort().join('|')
}

function isDirty(role: ManagedRolePermissions) {
  return normalized(drafts[role.id] ?? []) !== normalized(role.permissionCodes)
}

function resetRole(role: ManagedRolePermissions) {
  drafts[role.id] = [...role.permissionCodes]
  feedback.value = null
}

async function saveRole(role: ManagedRolePermissions) {
  if (!role.canManage || !isDirty(role) || savingRoleId.value !== null) return
  savingRoleId.value = role.id
  feedback.value = null
  try {
    await replacePermissions(role.id, drafts[role.id] ?? [])
    await loadPage()
    feedback.value = {
      variant: 'success',
      title: 'Đã cập nhật ma trận quyền',
      message: `Quyền của vai trò ${role.name} đã được lưu và có hiệu lực cho các lần kiểm tra tiếp theo.`,
    }
  } catch (error: unknown) {
    const parsed = error as RolePermissionApiError
    feedback.value = {
      variant: 'error',
      title: 'Chưa thể lưu thay đổi',
      message:
        parsed.status === 401
          ? 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
          : parsed.status === 403
            ? 'Bạn không có thẩm quyền thay đổi ma trận quyền.'
            : parsed.status === 409 && parsed.field === 'roleId'
              ? 'Quyền của SYSTEM_ADMIN được hệ thống bảo vệ và không thể chỉnh sửa.'
              : parsed.status === 404
                ? 'Role hoặc permission không còn tồn tại. Hãy tải lại trang.'
                : 'Không thể cập nhật quyền. Vui lòng thử lại.',
    }
  } finally {
    savingRoleId.value = null
  }
}

onMounted(() => {
  void loadPage()
})
</script>

<template>
  <section class="permission-page">
    <header class="permission-page__header">
      <div>
        <p class="page-eyebrow">Chính sách truy cập</p>
        <h1 class="page-title">Ma trận role và permission</h1>
        <p class="page-description">
          Quy định chức năng mà mỗi vai trò hệ thống được sử dụng. Mọi thay đổi đều được ghi audit.
        </p>
      </div>
      <NuxtLink to="/admin/access-control">Gán vai trò cho người dùng →</NuxtLink>
    </header>

    <div v-if="data" class="permission-page__metrics">
      <article>
        <span>Vai trò hệ thống</span><strong>{{ roles.length }}</strong>
      </article>
      <article>
        <span>Permission</span><strong>{{ permissions.length }}</strong>
      </article>
      <article>
        <span>Quan hệ đang cấp</span><strong>{{ grantCount }}</strong>
      </article>
    </div>

    <BaseAlert variant="info" title="Khu vực cấu hình nhạy cảm">
      Chỉ SYSTEM_ADMIN có scope GLOBAL được lưu thay đổi. Quyền của chính SYSTEM_ADMIN luôn bị khóa
      để tránh mất quyền quản trị hệ thống.
    </BaseAlert>

    <BaseAlert v-if="feedback" :variant="feedback.variant" :title="feedback.title">
      {{ feedback.message }}
    </BaseAlert>

    <div v-if="isLoading" class="permission-page__loading" role="status">
      <img src="/images/naem-logo.jpg" alt="" />
      <div>
        <strong>Đang tải ma trận quyền</strong>
        <span>Hệ thống đang đối chiếu role và permission hiện hành…</span>
      </div>
    </div>

    <BaseAlert v-else-if="errorMessage" variant="error" title="Không thể tải ma trận quyền">
      {{ errorMessage }}
      <div class="permission-page__error-actions">
        <BaseButton type="button" variant="secondary" @click="loadPage">Thử lại</BaseButton>
        <NuxtLink v-if="errorMessage.includes('hết hạn')" to="/admin/login">Đăng nhập lại</NuxtLink>
      </div>
    </BaseAlert>

    <div v-else-if="hasLoaded && roles.length === 0" class="permission-page__empty surface-card">
      Chưa có role hệ thống để cấu hình.
    </div>

    <div v-else-if="data" class="permission-page__matrix surface-card">
      <table>
        <thead>
          <tr>
            <th class="permission-page__sticky">Vai trò</th>
            <th v-for="permission in permissions" :key="permission.code">
              <span :class="{ sensitive: sensitiveCodes.has(permission.code) }">
                {{ permission.name }}
              </span>
              <small>{{ permission.code }}</small>
            </th>
            <th>Thao tác</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="role in roles" :key="role.id">
            <th class="permission-page__sticky">
              <strong>{{ role.name }}</strong>
              <small>{{ role.code }}</small>
              <span v-if="!role.canManage">Được bảo vệ</span>
            </th>
            <td v-for="permission in permissions" :key="permission.code">
              <label :title="permission.description ?? permission.name">
                <input
                  type="checkbox"
                  :checked="isSelected(role.id, permission.code)"
                  :disabled="!role.canManage || savingRoleId !== null"
                  :aria-label="`${role.name}: ${permission.name}`"
                  @change="
                    togglePermission(
                      role,
                      permission.code,
                      ($event.target as HTMLInputElement).checked,
                    )
                  "
                />
                <span aria-hidden="true">✓</span>
              </label>
            </td>
            <td>
              <div v-if="role.canManage" class="permission-page__actions">
                <button
                  type="button"
                  :disabled="!isDirty(role) || savingRoleId !== null"
                  @click="resetRole(role)"
                >
                  Hoàn tác
                </button>
                <BaseButton
                  type="button"
                  :disabled="!isDirty(role) || savingRoleId !== null"
                  :loading="savingRoleId === role.id"
                  @click="saveRole(role)"
                >
                  Lưu
                </BaseButton>
              </div>
              <span v-else class="permission-page__locked">Khóa</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.permission-page {
  display: grid;
  gap: 22px;
}
.permission-page__header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
}
.permission-page__header > div {
  max-width: 760px;
}
.permission-page__header > a {
  flex: 0 0 auto;
  color: var(--color-primary);
  font-size: 13px;
  font-weight: 800;
  text-decoration: none;
}
.permission-page__metrics {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}
.permission-page__metrics article {
  display: grid;
  gap: 5px;
  padding: 16px 18px;
  border: 1px solid var(--color-border);
  border-radius: 15px;
  background: var(--color-surface);
  box-shadow: 0 4px 18px rgb(15 23 42 / 4%);
}
.permission-page__metrics span {
  color: var(--color-muted);
  font-size: 12px;
  font-weight: 700;
}
.permission-page__metrics strong {
  color: var(--color-primary-dark);
  font-size: 25px;
}
.permission-page__loading {
  display: flex;
  min-height: 260px;
  align-items: center;
  justify-content: center;
  gap: 17px;
  border: 1px solid var(--color-border);
  border-radius: 18px;
  background: var(--color-surface);
}
.permission-page__loading img {
  width: 56px;
  height: 56px;
  border-radius: 13px;
  object-fit: cover;
  animation: permission-pulse 1.4s ease-in-out infinite;
}
.permission-page__loading div {
  display: grid;
  gap: 4px;
}
.permission-page__loading span {
  color: var(--color-muted);
  font-size: 13px;
}
.permission-page__error-actions {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 10px;
}
.permission-page__error-actions a {
  color: var(--color-primary);
  font-weight: 800;
}
.permission-page__empty {
  padding: 40px;
  border-radius: 18px;
  color: var(--color-muted);
  text-align: center;
}
.permission-page__matrix {
  overflow: auto;
  border-radius: 18px;
}
.permission-page table {
  width: 100%;
  min-width: 1600px;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 12px;
}
.permission-page th,
.permission-page td {
  padding: 12px 10px;
  border-right: 1px solid var(--color-border);
  border-bottom: 1px solid var(--color-border);
  text-align: center;
  vertical-align: middle;
}
.permission-page thead th {
  min-width: 112px;
  color: var(--color-muted);
  background: #f8fafc;
  font-size: 10px;
}
.permission-page thead th > span,
.permission-page thead th > small {
  display: block;
}
.permission-page thead th > span {
  color: var(--color-text);
  font-size: 11px;
}
.permission-page thead th > span.sensitive {
  color: #9a5b08;
}
.permission-page thead th > small {
  margin-top: 3px;
  font-weight: 500;
}
.permission-page__sticky {
  position: sticky;
  left: 0;
  z-index: 1;
  min-width: 190px !important;
  text-align: left !important;
  background: #fff !important;
  box-shadow: 7px 0 12px rgb(15 23 42 / 4%);
}
thead .permission-page__sticky {
  z-index: 2;
  background: #f8fafc !important;
}
.permission-page tbody th > strong,
.permission-page tbody th > small {
  display: block;
}
.permission-page tbody th > strong {
  color: var(--color-primary-dark);
  font-size: 12px;
}
.permission-page tbody th > small {
  margin-top: 3px;
  color: var(--color-muted);
  font-weight: 600;
}
.permission-page tbody th > span {
  display: inline-flex;
  margin-top: 7px;
  padding: 3px 6px;
  border-radius: 999px;
  color: #805b0f;
  background: #fff4d6;
  font-size: 9px;
  font-weight: 800;
}
.permission-page td label {
  display: grid;
  width: 34px;
  height: 34px;
  margin: auto;
  place-items: center;
  border-radius: 9px;
  cursor: pointer;
}
.permission-page td label:hover {
  background: var(--color-primary-soft);
}
.permission-page td input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}
.permission-page td label > span {
  display: grid;
  width: 22px;
  height: 22px;
  place-items: center;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  color: transparent;
  background: #fff;
  font-weight: 900;
}
.permission-page td input:checked + span {
  border-color: var(--color-primary);
  color: #fff;
  background: var(--color-primary);
}
.permission-page td input:disabled + span {
  cursor: not-allowed;
  opacity: 0.6;
}
.permission-page__actions {
  display: flex;
  min-width: 135px;
  justify-content: center;
  gap: 6px;
}
.permission-page__actions > button:first-child {
  border: 0;
  color: var(--color-primary);
  background: transparent;
  cursor: pointer;
  font-size: 11px;
  font-weight: 750;
}
.permission-page__actions button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
.permission-page__locked {
  color: var(--color-muted);
  font-size: 11px;
  font-weight: 750;
}
@keyframes permission-pulse {
  50% {
    transform: scale(0.95);
    opacity: 0.7;
  }
}
@media (max-width: 760px) {
  .permission-page__header {
    align-items: flex-start;
    flex-direction: column;
  }
  .permission-page__metrics {
    grid-template-columns: 1fr;
  }
}
</style>
