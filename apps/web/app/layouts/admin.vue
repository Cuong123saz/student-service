<script setup lang="ts">
import { roleLabels } from '~/types/auth'

const route = useRoute()
const { user, logout } = useAdminAuth()
const menuOpen = ref(false)
const isLoggingOut = ref(false)

const navigation = [
  { label: 'Tổng quan', to: '/admin', exact: true },
  { label: 'Danh sách sinh viên', to: '/admin/students' },
  { label: 'Cơ cấu và cố vấn', to: '/admin/organizations' },
  { label: 'Vai trò và phạm vi', to: '/admin/access-control' },
  { label: 'Ma trận quyền', to: '/admin/role-permissions' },
  { label: 'Mời người dùng', to: '/admin/users/invite' },
  { label: 'Tiếp nhận hồ sơ', to: '/admin/review-submissions' },
  { label: 'Biểu mẫu và nơi xử lý', to: '/admin/procedures' },
  { label: 'Đợt điểm rèn luyện', to: '/admin/training-periods' },
  { label: 'Audit log', to: '/admin/audit-logs' },
]

const primaryRole = computed(() => {
  const role = user.value?.roles[0]
  return role ? roleLabels[role] : ''
})

watch(
  () => route.fullPath,
  () => {
    menuOpen.value = false
  },
)

function isActive(item: (typeof navigation)[number]) {
  return item.exact ? route.path === item.to : route.path.startsWith(item.to)
}

async function handleLogout() {
  if (isLoggingOut.value) return
  isLoggingOut.value = true
  try {
    await logout()
    await navigateTo('/admin/login')
  } finally {
    isLoggingOut.value = false
  }
}
</script>

<template>
  <div class="admin-layout">
    <aside
      id="admin-navigation"
      class="admin-layout__sidebar"
      :class="{ 'admin-layout__sidebar--open': menuOpen }"
    >
      <NuxtLink class="admin-brand" to="/admin">
        <AcademyBrand dark compact />
      </NuxtLink>

      <nav aria-label="Điều hướng quản trị">
        <NuxtLink
          v-for="item in navigation"
          :key="item.to"
          :to="item.to"
          :class="{ active: isActive(item) }"
          :aria-current="isActive(item) ? 'page' : undefined"
        >
          {{ item.label }}
        </NuxtLink>
        <NotificationLink portal="admin" />
      </nav>

      <div class="admin-layout__account">
        <strong>{{ user?.username }}</strong>
        <small>{{ primaryRole }}</small>
        <button type="button" :disabled="isLoggingOut" @click="handleLogout">
          {{ isLoggingOut ? 'Đang đăng xuất...' : 'Đăng xuất' }}
        </button>
      </div>
    </aside>

    <button
      v-if="menuOpen"
      type="button"
      class="admin-layout__overlay"
      aria-label="Đóng menu quản trị"
      @click="menuOpen = false"
    />

    <div class="admin-layout__main">
      <header class="admin-layout__mobile-header">
        <button
          type="button"
          aria-controls="admin-navigation"
          :aria-expanded="menuOpen"
          aria-label="Mở menu quản trị"
          @click="menuOpen = true"
        >
          ☰
        </button>
        <strong>Quản trị NAEM</strong>
      </header>
      <main class="admin-layout__content"><slot /></main>
    </div>
  </div>
</template>

<style scoped>
.admin-layout {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  min-height: 100vh;
  background: var(--color-background);
}
.admin-layout__sidebar {
  position: sticky;
  z-index: 40;
  top: 0;
  display: flex;
  height: 100vh;
  flex-direction: column;
  padding: 24px 16px 20px;
  color: #fff;
  background:
    radial-gradient(circle at 15% 0%, rgb(37 99 235 / 20%), transparent 34%),
    linear-gradient(180deg, #0a172a 0%, var(--color-admin) 55%, #07101e 100%);
  box-shadow: 12px 0 40px rgb(8 21 38 / 8%);
}
.admin-brand {
  display: flex;
  align-items: center;
  padding: 0 8px 24px;
  color: #fff;
  text-decoration: none;
}
.admin-layout__sidebar nav {
  display: grid;
  gap: 6px;
}
.admin-layout__sidebar nav a,
.admin-layout__sidebar nav > span {
  display: flex;
  min-height: 44px;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 9px;
  color: rgb(255 255 255 / 68%);
  font-size: 14px;
  text-decoration: none;
}
.admin-layout__sidebar nav a:hover,
.admin-layout__sidebar nav a.active {
  color: #fff;
  background: rgb(255 255 255 / 10%);
}
.admin-layout__sidebar nav a {
  position: relative;
  transition:
    color 150ms ease,
    background-color 150ms ease,
    transform 150ms ease;
}
.admin-layout__sidebar nav a:hover {
  transform: translateX(2px);
}
.admin-layout__sidebar nav a.active::before {
  position: absolute;
  top: 11px;
  bottom: 11px;
  left: -4px;
  width: 3px;
  border-radius: 99px;
  background: #d7aa52;
  content: '';
}
.admin-layout__sidebar nav > span {
  opacity: 0.52;
}
.admin-layout__sidebar nav small {
  font-size: 11px;
}
.admin-layout__account {
  display: grid;
  gap: 4px;
  margin-top: auto;
  padding: 16px 10px 0;
  border-top: 1px solid rgb(255 255 255 / 12%);
}
.admin-layout__account::before {
  display: grid;
  width: 34px;
  height: 34px;
  margin-bottom: 4px;
  place-items: center;
  border: 1px solid rgb(255 255 255 / 12%);
  border-radius: 10px;
  color: #a9d9ff;
  background: rgb(255 255 255 / 7%);
  content: 'AD';
  font-size: 11px;
  font-weight: 800;
}
.admin-layout__account small {
  color: rgb(255 255 255 / 58%);
  font-size: 12px;
}
.admin-layout__account button {
  min-height: 40px;
  margin-top: 10px;
  border: 1px solid rgb(255 255 255 / 18%);
  border-radius: 10px;
  color: #fff;
  background: rgb(255 255 255 / 4%);
  cursor: pointer;
  transition:
    background-color 150ms ease,
    border-color 150ms ease;
}
.admin-layout__account button:hover:not(:disabled) {
  border-color: rgb(255 255 255 / 30%);
  background: rgb(255 255 255 / 9%);
}
.admin-layout__main {
  min-width: 0;
}
.admin-layout__content {
  width: min(1180px, calc(100% - 48px));
  margin: 0 auto;
  padding: 34px 0 60px;
}
.admin-layout__mobile-header {
  display: none;
}
.admin-layout__overlay {
  display: none;
}
@media (max-width: 820px) {
  .admin-layout {
    grid-template-columns: 1fr;
  }
  .admin-layout__sidebar {
    position: fixed;
    left: 0;
    transform: translateX(-100%);
    width: min(280px, 86vw);
    transition: transform 180ms ease;
  }
  .admin-layout__sidebar--open {
    transform: translateX(0);
  }
  .admin-layout__overlay {
    position: fixed;
    z-index: 35;
    inset: 0;
    display: block;
    width: 100%;
    border: 0;
    background: rgb(15 23 42 / 55%);
  }
  .admin-layout__mobile-header {
    display: flex;
    min-height: 62px;
    align-items: center;
    gap: 12px;
    padding: 0 18px;
    border-bottom: 1px solid var(--color-border);
    background: var(--color-surface);
  }
  .admin-layout__mobile-header button {
    display: grid;
    width: 44px;
    height: 44px;
    place-items: center;
    border: 1px solid var(--color-border);
    border-radius: 9px;
    background: #fff;
    cursor: pointer;
  }
  .admin-layout__content {
    width: min(100% - 32px, 1180px);
    padding-top: 26px;
  }
}
</style>
