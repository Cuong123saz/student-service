<script setup lang="ts">
const props = defineProps<{ portal: 'user' | 'admin' }>()
const api = useNotifications(props.portal)
const route = useRoute()
const href = props.portal === 'admin' ? '/admin/notifications' : '/notifications'
let mounted = false
function refresh() {
  if (document.visibilityState === 'visible') void api.refreshCount()
}
onMounted(() => {
  mounted = true
  refresh()
  window.addEventListener('focus', refresh)
})
onBeforeUnmount(() => {
  mounted = false
  window.removeEventListener('focus', refresh)
})
watch([() => route.fullPath, () => api.identity.value], () => {
  if (mounted) refresh()
})
</script>
<template>
  <NuxtLink
    :to="href"
    class="notification-link"
    :aria-label="
      api.unreadCount.value === null ? 'Thông báo' : `Thông báo, ${api.unreadCount.value} chưa đọc`
    "
    >Thông báo
    <span
      v-if="api.unreadCount.value !== null && api.unreadCount.value > 0"
      aria-hidden="true"
      class="notification-count"
      >{{ api.unreadCount.value > 99 ? '99+' : api.unreadCount.value }}</span
    ></NuxtLink
  >
</template>
<style scoped>
.notification-link {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  max-width: 100%;
  text-decoration: none;
  white-space: nowrap;
}
.notification-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  min-height: 24px;
  padding: 2px 6px;
  border-radius: 99px;
  background: var(--color-primary);
  color: white;
  font-size: 12px;
  font-weight: 700;
}
.notification-link:focus-visible {
  outline: 3px solid var(--color-primary);
  outline-offset: 3px;
}
</style>
