<script setup lang="ts">
import type { ActivitySuggestion } from '~/types/activity'
import type { TrainingError } from '~/types/training-point'
import { formatActivityTime } from '~/utils/activity'

/** ADR 0033: suggestions from participation certificates; advisory only. */
const props = defineProps<{
  declarationId: string
  mode: 'student' | 'review'
  canApply?: boolean
}>()
const emit = defineEmits<{ apply: [suggestion: ActivitySuggestion] }>()
const api = useActivitySuggestions(),
  suggestion = ref<ActivitySuggestion | null>(null),
  error = ref<TrainingError | null>(null),
  busy = ref(false)
async function load() {
  busy.value = true
  error.value = null
  try {
    suggestion.value =
      props.mode === 'student'
        ? await api.forStudent(props.declarationId)
        : await api.forReview(props.declarationId)
  } catch (e) {
    error.value = e as TrainingError
    suggestion.value = null
  } finally {
    busy.value = false
  }
}
const hasPoints = computed(() => Object.values(suggestion.value?.totals ?? {}).some((p) => p > 0))
watch(() => props.declarationId, load)
onMounted(load)
</script>
<template>
  <section class="tp-panel" aria-labelledby="suggestion-title">
    <h2 id="suggestion-title">Gợi ý từ hoạt động ngoại khóa</h2>
    <div v-if="error" class="tp-notice tp-notice--error" role="alert">{{ error.message }}</div>
    <p v-if="busy && !suggestion" role="status">Đang tính gợi ý…</p>
    <template v-if="suggestion">
      <p class="tp-muted">
        Tính trong khoảng {{ formatActivityTime(suggestion.window.from) }} –
        {{ formatActivityTime(suggestion.window.to) }}. {{ suggestion.notice }}
      </p>
      <ul class="tp-files">
        <li v-for="(l, i) in suggestion.lines" :key="i">
          <p>
            <strong>Nhóm {{ l.group }}: +{{ l.points }}</strong> · {{ l.explanation }}
          </p>
          <p v-if="l.certificateCodes.length" class="tp-muted">
            Chứng nhận: {{ l.certificateCodes.join(', ') }}
          </p>
        </li>
      </ul>
      <div v-if="mode === 'student' && canApply && hasPoints" class="tp-actions">
        <BaseButton variant="secondary" @click="emit('apply', suggestion)">Điền gợi ý</BaseButton>
      </div>
      <p v-if="mode === 'student' && canApply && hasPoints" class="tp-muted">
        Chỉ điền vào bản nháp trên trình duyệt; bạn vẫn kiểm tra, lưu và nộp như bình thường.
      </p>
    </template>
  </section>
</template>
