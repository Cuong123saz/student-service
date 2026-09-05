<script setup lang="ts">
defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{
  id: string
  label: string
  modelValue: string
  type?: 'text' | 'email' | 'password'
  hint?: string
  error?: string
}>(), {
  type: 'text',
  hint: '',
  error: '',
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const revealPassword = ref(false)
const actualType = computed(() => (
  props.type === 'password' && revealPassword.value ? 'text' : props.type
))
const descriptionId = computed(() => (
  props.error || props.hint ? `${props.id}-description` : undefined
))

function updateValue(event: Event) {
  emit('update:modelValue', (event.target as HTMLInputElement).value)
}
</script>

<template>
  <div class="base-input">
    <label :for="id">{{ label }}</label>
    <div class="base-input__control">
      <input
        v-bind="$attrs"
        :id="id"
        :value="modelValue"
        :type="actualType"
        :aria-invalid="error ? 'true' : undefined"
        :aria-describedby="descriptionId"
        @input="updateValue"
      >
      <button
        v-if="type === 'password'"
        type="button"
        class="base-input__reveal"
        :aria-label="revealPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'"
        :aria-pressed="revealPassword"
        @click="revealPassword = !revealPassword"
      >
        {{ revealPassword ? 'Ẩn' : 'Hiện' }}
      </button>
    </div>
    <p
      v-if="error || hint"
      :id="descriptionId"
      class="base-input__description"
      :class="{ 'base-input__description--error': error }"
    >
      {{ error || hint }}
    </p>
  </div>
</template>

<style scoped>
.base-input { display: grid; gap: 8px; }
.base-input label { color: var(--color-text); font-size: 14px; font-weight: 700; }
.base-input__control { position: relative; }
.base-input input {
  width: 100%;
  min-height: 48px;
  padding: 11px 14px;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  color: var(--color-text);
  background: #fbfdff;
  box-shadow: inset 0 1px 2px rgb(15 23 42 / 3%);
  transition: border-color 160ms ease, box-shadow 160ms ease, background-color 160ms ease;
}
.base-input input[type="password"],
.base-input input[type="text"]:has(+ .base-input__reveal) { padding-right: 64px; }
.base-input input:hover:not(:disabled) { border-color: #b7c3d5; }
.base-input input:focus { border-color: var(--color-primary); outline: 0; background: #fff; box-shadow: 0 0 0 4px rgb(21 94 239 / 12%); }
.base-input input[aria-invalid="true"] { border-color: var(--color-error); }
.base-input input:disabled { cursor: not-allowed; background: #f2f4f7; }
.base-input__reveal {
  position: absolute;
  top: 0;
  right: 0;
  display: grid;
  min-width: 54px;
  height: 48px;
  place-items: center;
  border: 0;
  color: var(--color-primary);
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  font-weight: 700;
}
.base-input__description { margin: 0; color: var(--color-muted); font-size: 13px; line-height: 1.45; }
.base-input__description--error { color: var(--color-error); }
</style>
