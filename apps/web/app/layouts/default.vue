<script setup lang="ts">
const { user, ensureCurrentUser, logout } = useUserAuth()
const isLoggingOut = ref(false)

onMounted(() => {
  void ensureCurrentUser()
})

async function handleLogout() {
  if (isLoggingOut.value) return
  isLoggingOut.value = true

  try {
    await logout()
    await navigateTo('/login')
  } finally {
    isLoggingOut.value = false
  }
}
</script>

<template>
  <div class="default-layout">
    <AppHeader
      :user="user"
      :logging-out="isLoggingOut"
      @logout="handleLogout"
    />

    <main class="default-layout__content page-container">
      <slot />
    </main>

    <AcademyFooter />
  </div>
</template>

<style scoped>
.default-layout {
  display: grid;
  grid-template-rows: auto 1fr auto;
  min-height: 100vh;
}
.default-layout__content { width: 100%; padding-top: 42px; padding-bottom: 64px; }
@media (max-width: 640px) {
  .default-layout__content { padding-top: 30px; padding-bottom: 48px; }
}
</style>
