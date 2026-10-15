<script setup lang="ts">
import type { ReviewDetail } from '~/types/training-review'
import type { TrainingError } from '~/types/training-point'
import { reviewLabels, reviewActions } from '~/utils/training-review'
import { trainingDate } from '~/utils/training-point'
const props = defineProps<{ declarationId: string }>(),
  emit = defineEmits<{ unavailable: [error: TrainingError] }>(),
  api = useTrainingReviews(),
  row = ref<ReviewDetail | null>(null),
  error = ref<TrainingError | null>(null),
  busy = ref(false)
let generation = 0
async function load() {
  const g = ++generation
  row.value = null
  error.value = null
  busy.value = true
  try {
    const d = await api.own(props.declarationId)
    if (g === generation && d.id === props.declarationId) row.value = d
  } catch (e) {
    if (g !== generation) return
    error.value = e as TrainingError
    if ([401, 403, 404].includes(error.value.status ?? 0)) emit('unavailable', error.value)
  } finally {
    if (g === generation) busy.value = false
  }
}
watch(() => props.declarationId, load, { immediate: true })
onBeforeUnmount(() => {
  generation++
})
</script>
<template>
  <section class="tp-panel" aria-label="Kết quả xét duyệt">
    <h2>Kết quả xét duyệt</h2>
    <p v-if="busy" role="status">Đang tải kết quả…</p>
    <p v-if="error" role="alert">{{ error.message }}</p>
    <template v-if="row"
      ><p>
        <strong>{{ reviewLabels[row.state] }}</strong>
      </p>
      <p v-if="row.decisions.length" class="tp-score">
        {{ row.decisions.at(-1)!.totalPoints }} / 100
      </p>
      <p>
        Điểm tự kê khai được giữ riêng. Chỉ sau khi khoa duyệt, bản này mới hoàn tất quy trình xét
        duyệt trong hệ thống.
      </p>
      <p class="tp-muted">
        Quy chế giả định chưa tạo xếp loại chính thức. Xác nhận bằng tài khoản chưa phải chữ ký số
        đã xác minh.
      </p>
      <ol class="tp-history">
        <li v-for="d in row.decisions" :key="d.id">
          <strong>{{ reviewActions[d.action] }} · {{ d.totalPoints }} / 100</strong>
          <p>{{ d.actor.fullName }} · {{ trainingDate(d.confirmedAt) }}</p>
          <p>{{ d.comment }}</p>
          <details>
            <summary>Điểm xét duyệt từng nhóm</summary>
            <p v-for="c in row.period.criteria" :key="c.code">
              {{ c.code }}: {{ d.answers[c.code]?.points }} / {{ c.maxPoints }} ·
              {{ d.answers[c.code]?.note || 'Không có nhận xét' }}
            </p>
            <p>Mã đối chiếu: {{ d.payloadSha256 }}</p>
          </details>
        </li>
      </ol>
      <p v-if="row.historyTruncated">Hiển thị 100 cập nhật gần nhất.</p></template
    ><button class="button button--secondary" :disabled="busy" @click="load">
      Tải lại kết quả xét duyệt
    </button>
  </section>
</template>
