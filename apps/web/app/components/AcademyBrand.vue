<script setup lang="ts">
withDefaults(defineProps<{
  dark?: boolean
  compact?: boolean
}>(), {
  dark: false,
  compact: false,
})
</script>

<template>
  <span
    class="academy-brand"
    :class="{
      'academy-brand--dark': dark,
      'academy-brand--compact': compact,
    }"
  >
    <img
      class="academy-brand__logo"
      src="/images/naem-logo.jpg"
      alt="Logo Học viện Quản lý Giáo dục"
      width="52"
      height="52"
    >
    <span class="academy-brand__text">
      <strong>HỌC VIỆN QUẢN LÝ GIÁO DỤC</strong>
      <small>NATIONAL ACADEMY OF EDUCATION MANAGEMENT</small>
    </span>
  </span>
</template>

<style scoped>
.academy-brand {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 12px;
}

.academy-brand__logo {
  width: 48px;
  height: 48px;
  flex: none;
  border: 2px solid rgb(200 154 66 / 72%);
  border-radius: 50%;
  object-fit: cover;
  box-shadow: 0 8px 20px rgb(14 35 65 / 18%);
}

.academy-brand__text {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.academy-brand__text strong {
  overflow: hidden;
  color: var(--color-text);
  font-family: Georgia, "Times New Roman", serif;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: .015em;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.academy-brand__text small {
  color: var(--color-muted);
  font-size: 9px;
  font-weight: 750;
  letter-spacing: .045em;
  line-height: 1.3;
}

.academy-brand--dark .academy-brand__text strong { color: #fff; }
.academy-brand--dark .academy-brand__text small { color: rgb(255 255 255 / 56%); }
.academy-brand--dark .academy-brand__logo { box-shadow: 0 9px 24px rgb(0 0 0 / 25%); }

.academy-brand--compact { gap: 10px; }
.academy-brand--compact .academy-brand__logo { width: 42px; height: 42px; }
.academy-brand--compact .academy-brand__text strong { font-size: 12px; }
.academy-brand--compact .academy-brand__text small { font-size: 8px; }

@media (max-width: 460px) {
  .academy-brand__logo { width: 42px; height: 42px; }
  .academy-brand__text strong { font-size: 11px; }
  .academy-brand__text small { display: none; }
}
</style>
