<script setup lang="ts">
withDefaults(defineProps<{
  loading?: boolean
  variant?: 'primary' | 'secondary' | 'danger'
  block?: boolean
}>(), {
  loading: false,
  variant: 'primary',
  block: false,
})
</script>

<template>
  <button
    class="base-button"
    :class="[
      `base-button--${variant}`,
      { 'base-button--block': block },
    ]"
    :aria-busy="loading"
    :disabled="loading || $attrs.disabled === true"
  >
    <span v-if="loading" class="base-button__spinner" aria-hidden="true" />
    <slot />
  </button>
</template>

<style scoped>
.base-button {
  display: inline-flex;
  min-height: 44px;
  align-items: center;
  justify-content: center;
  gap: 9px;
  padding: 10px 18px;
  border: 1px solid transparent;
  border-radius: 12px;
  cursor: pointer;
  font-weight: 700;
  text-decoration: none;
  box-shadow: 0 1px 2px rgb(15 23 42 / 6%);
  transition: transform 160ms ease, box-shadow 160ms ease, background-color 160ms ease, border-color 160ms ease;
}

.base-button--primary {
  color: #fff;
  background: linear-gradient(135deg, var(--color-primary), #205c94);
  box-shadow: 0 8px 20px rgb(23 76 130 / 20%);
}
.base-button--primary:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 11px 24px rgb(23 76 130 / 28%); }
.base-button--secondary {
  border-color: var(--color-border);
  color: var(--color-text);
  background: var(--color-surface);
}
.base-button--secondary:hover:not(:disabled) {
  transform: translateY(-1px);
  border-color: #bfdbfe;
  background: var(--color-primary-soft);
}
.base-button--danger { color: #fff; background: var(--color-error); }
.base-button--block { width: 100%; }
.base-button:disabled { cursor: not-allowed; opacity: 0.62; }
.base-button:active:not(:disabled) { transform: translateY(0); }

.base-button__spinner {
  width: 16px;
  height: 16px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 999px;
  animation: spin 700ms linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }
</style>
