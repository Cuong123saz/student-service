<script setup lang="ts">
import { roleLabels, type SystemRoleCode } from '~/types/auth'

const props = defineProps<{ role: SystemRoleCode }>()
const label = computed(() => roleLabels[props.role])
</script>

<template>
  <span class="role-badge">{{ label }}</span>
</template>

<style scoped>
.role-badge {
  display: inline-flex;
  padding: 5px 9px;
  border-radius: 999px;
  color: var(--color-info);
  background: var(--color-info-background);
  font-size: 12px;
  font-weight: 700;
}
</style>
