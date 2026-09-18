<script setup lang="ts">
defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    id: string
    label: string
    modelValue: string
    hint?: string
    error?: string
  }>(),
  {
    hint: '',
    error: '',
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const descriptionId = computed(() =>
  props.error || props.hint ? `${props.id}-description` : undefined,
)

function updateValue(event: Event) {
  emit('update:modelValue', (event.target as HTMLSelectElement).value)
}
</script>

<template>
  <div class="base-select">
    <label :for="id">{{ label }}</label>
    <select
      v-bind="$attrs"
      :id="id"
      :value="modelValue"
      :aria-invalid="error ? 'true' : undefined"
      :aria-describedby="descriptionId"
      @change="updateValue"
    >
      <slot />
    </select>
    <p
      v-if="error || hint"
      :id="descriptionId"
      class="base-select__description"
      :class="{
        'base-select__description--error': error,
      }"
    >
      {{ error || hint }}
    </p>
  </div>
</template>

<style scoped>
.base-select {
  display: grid;
  gap: 8px;
}
.base-select label {
  color: var(--color-text);
  font-size: 14px;
  font-weight: 700;
}
.base-select select {
  width: 100%;
  min-height: 48px;
  padding: 11px 40px 11px 14px;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  color: var(--color-text);
  background: #fbfdff;
  box-shadow: inset 0 1px 2px rgb(15 23 42 / 3%);
  transition:
    border-color 160ms ease,
    box-shadow 160ms ease,
    background-color 160ms ease;
}
.base-select select:hover:not(:disabled) {
  border-color: #b7c3d5;
}
.base-select select:focus {
  border-color: var(--color-primary);
  outline: 0;
  background: #fff;
  box-shadow: 0 0 0 4px rgb(21 94 239 / 12%);
}
.base-select select[aria-invalid='true'] {
  border-color: var(--color-error);
}
.base-select select:disabled {
  cursor: not-allowed;
  background: #f2f4f7;
}
.base-select__description {
  margin: 0;
  color: var(--color-muted);
  font-size: 13px;
  line-height: 1.45;
}
.base-select__description--error {
  color: var(--color-error);
}
</style>
