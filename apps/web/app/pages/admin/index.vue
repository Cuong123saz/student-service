<script setup lang="ts">
const {
  user,
  loadCurrentUser,
  logout,
} = useAdminAuth()

const isLoading = ref(true)
const isLoggingOut = ref(false)

onMounted(async () => {
 try {
  const currentUser =
    await loadCurrentUser()

  if (
    currentUser
      .mustChangePassword
  ) {
    await navigateTo(
      '/admin/change-password',
    )
  }
} catch {
    await navigateTo(
      '/admin/login',
    )
  } finally {
    isLoading.value = false
  }
})

async function handleLogout() {
  if (isLoggingOut.value) {
    return
  }

  isLoggingOut.value = true

  try {
    await logout()

    await navigateTo(
      '/admin/login',
    )
  } finally {
    isLoggingOut.value = false
  }
}
</script>

<template>
  <main class="admin-dashboard">
    <p v-if="isLoading">
      Đang kiểm tra phiên đăng nhập...
    </p>

    <section
      v-else-if="user"
      class="admin-dashboard__card"
    >
      <p class="admin-dashboard__eyebrow">
        Cổng quản trị
      </p>

      <h1>
        Xin chào, {{ user.username }}
      </h1>

      <p>
        Quyền hiện tại:
        <strong>
          {{ user.roles.join(', ') }}
        </strong>
      </p>

      <button
        type="button"
        :disabled="isLoggingOut"
        @click="handleLogout"
      >
        {{
          isLoggingOut
            ? 'Đang đăng xuất...'
            : 'Đăng xuất'
        }}
      </button>
    </section>
  </main>
</template>

<style scoped>
.admin-dashboard__card {
  max-width: 720px;
  padding: 32px;
  border: 1px solid var(--color-border);
  border-radius: 20px;
  background: var(--color-surface);
}

.admin-dashboard__eyebrow {
  color: var(--color-primary);
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.admin-dashboard__card h1 {
  margin-bottom: 16px;
}

.admin-dashboard__card p {
  color: var(--color-muted);
}

.admin-dashboard__card button {
  margin-top: 12px;
  padding: 11px 18px;
  border: 0;
  border-radius: 10px;
  background: var(--color-primary);
  color: #ffffff;
  cursor: pointer;
  font-weight: 700;
}
</style>