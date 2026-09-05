<script setup lang="ts">
withDefaults(defineProps<{
  variant?: 'info' | 'success' | 'warning' | 'error'
  title?: string
}>(), {
  variant: 'info',
  title: '',
})
</script>

<template>
  <div
    class="base-alert"
    :class="`base-alert--${variant}`"
    :role="variant === 'error' ? 'alert' : 'status'"
  >
    <strong v-if="title">{{ title }}</strong>
    <div class="base-alert__content"><slot /></div>
  </div>
</template>

<style scoped>
.base-alert {
  padding: 14px 16px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  font-size: 14px;
  line-height: 1.55;
}
.base-alert strong { display: block; margin-bottom: 3px; }
.base-alert__content :deep(p:last-child) { margin-bottom: 0; }
.base-alert--info { border-color: #bfdbfe; color: var(--color-info); background: var(--color-info-background); }
.base-alert--success { border-color: #bbf7d0; color: var(--color-success); background: var(--color-success-background); }
.base-alert--warning { border-color: #fed7aa; color: var(--color-warning); background: var(--color-warning-background); }
.base-alert--error { border-color: #fecaca; color: var(--color-error); background: var(--color-error-background); }
</style>
