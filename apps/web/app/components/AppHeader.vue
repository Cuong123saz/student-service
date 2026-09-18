<script setup lang="ts">
import { roleLabels, type UserSessionUser } from '~/types/auth'

const props = withDefaults(
  defineProps<{
    user?: UserSessionUser | null
    loggingOut?: boolean
  }>(),
  {
    user: null,
    loggingOut: false,
  },
)

const emit = defineEmits<{ logout: [] }>()
const menuOpen = ref(false)
const primaryRole = computed(() => {
  const role = props.user?.roles[0]
  return role ? roleLabels[role] : ''
})
const route = useRoute()
watch(
  () => route.fullPath,
  () => {
    menuOpen.value = false
  },
)
</script>

<template>
  <header class="app-header">
    <div class="app-header__inner page-container">
      <NuxtLink class="brand" to="/">
        <AcademyBrand />
      </NuxtLink>

      <button
        type="button"
        class="app-header__menu-button"
        :aria-expanded="menuOpen"
        aria-controls="public-navigation"
        :aria-label="menuOpen ? 'Đóng menu' : 'Mở menu'"
        @click="menuOpen = !menuOpen"
      >
        <span aria-hidden="true">{{ menuOpen ? '×' : '☰' }}</span>
      </button>

      <nav
        id="public-navigation"
        class="app-header__navigation"
        :class="{ 'app-header__navigation--open': menuOpen }"
        aria-label="Điều hướng chính"
      >
        <NuxtLink to="/">Trang chủ</NuxtLink>
        <NuxtLink to="/services">Dịch vụ</NuxtLink>
        <template v-if="user">
          <NuxtLink to="/portal">Cổng của tôi</NuxtLink>
          <div class="app-header__identity">
            <strong>{{ user.username }}</strong>
            <small>{{ primaryRole }}</small>
          </div>
          <button
            type="button"
            class="app-header__logout"
            :disabled="loggingOut"
            @click="emit('logout')"
          >
            {{ loggingOut ? 'Đang đăng xuất...' : 'Đăng xuất' }}
          </button>
        </template>
        <template v-else>
          <NuxtLink class="app-header__login" to="/login">Đăng nhập</NuxtLink>
          <NuxtLink class="app-header__admin" to="/admin/login">Cổng quản trị</NuxtLink>
        </template>
      </nav>
    </div>
  </header>
</template>

<style scoped>
.app-header {
  position: sticky;
  z-index: 30;
  top: 0;
  border-bottom: 1px solid rgb(220 228 239 / 80%);
  background: rgb(255 255 255 / 90%);
  box-shadow: 0 1px 0 rgb(255 255 255 / 80%);
  backdrop-filter: blur(16px);
}
.app-header__inner {
  position: relative;
  display: flex;
  min-height: 76px;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
}
.brand {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  text-decoration: none;
}
.app-header__navigation {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px;
  border: 1px solid rgb(220 228 239 / 75%);
  border-radius: 13px;
  background: rgb(248 250 252 / 78%);
  font-size: 14px;
}
.app-header__navigation a {
  color: var(--color-muted);
  font-weight: 650;
  text-decoration: none;
}
.app-header__navigation > a:not(.app-header__admin) {
  padding: 8px 11px;
  border-radius: 8px;
}
.app-header__navigation a:hover,
.app-header__navigation a.router-link-active {
  color: var(--color-primary);
  background: #fff;
}
.app-header__identity {
  display: grid;
  padding: 0 12px;
  border-left: 1px solid var(--color-border);
}
.app-header__identity small {
  color: var(--color-muted);
  font-size: 12px;
}
.app-header__logout,
.app-header__admin {
  min-height: 40px;
  padding: 9px 13px;
  border: 1px solid var(--color-border);
  border-radius: 9px;
  background: var(--color-surface);
}
.app-header__logout {
  color: var(--color-muted);
  cursor: pointer;
  font-weight: 650;
}
.app-header__admin {
  color: #fff !important;
  border-color: var(--color-admin) !important;
  background: var(--color-admin);
  box-shadow: 0 7px 16px rgb(9 21 38 / 14%);
}
.app-header__menu-button {
  display: none;
  width: 44px;
  height: 44px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-surface);
  cursor: pointer;
  font-size: 22px;
}
@media (max-width: 820px) {
  .app-header__menu-button {
    display: grid;
    place-items: center;
  }
  .app-header__navigation {
    position: absolute;
    top: calc(100% + 1px);
    right: 0;
    left: 0;
    display: none;
    align-items: stretch;
    flex-direction: column;
    gap: 8px;
    padding: 16px;
    border: 1px solid var(--color-border);
    border-top: 0;
    border-radius: 0 0 16px 16px;
    background: var(--color-surface);
    box-shadow: var(--shadow-card);
  }
  .app-header__navigation--open {
    display: flex;
  }
  .app-header__navigation a,
  .app-header__logout {
    display: flex;
    min-height: 44px;
    align-items: center;
  }
  .app-header__identity {
    padding: 12px 0;
    border-top: 1px solid var(--color-border);
    border-left: 0;
  }
}
@media (max-width: 440px) {
  .brand {
    max-width: calc(100% - 58px);
  }
}
</style>
