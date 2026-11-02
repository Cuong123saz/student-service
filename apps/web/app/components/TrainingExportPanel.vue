<script setup lang="ts">
import type { ReviewQueue } from '~/types/training-review'
import type { TrainingError } from '~/types/training-point'
import type { TrainingExportResult } from '~/composables/useTrainingReviews'
import { trainingExportFormats, type TrainingExportFormat } from '~/utils/training-export'

const props = defineProps<{ period: ReviewQueue['period']; summary: ReviewQueue['summary'] }>()
const emit = defineEmits<{ 'lost-access': [error: TrainingError] }>()
const api = useTrainingReviews(),
  busy = ref<TrainingExportFormat | ''>(''),
  error = ref<TrainingError | null>(null),
  result = ref<(TrainingExportResult & { format: TrainingExportFormat }) | null>(null)
const formats = Object.keys(trainingExportFormats) as TrainingExportFormat[]
const pending = computed(
  () =>
    props.summary.waitingAdvisor + props.summary.waitingFaculty + props.summary.returnedToAdvisor,
)
let generation = 0
watch(
  () => props.period.id,
  () => {
    generation++
    busy.value = ''
    error.value = null
    result.value = null
  },
)
onBeforeUnmount(() => {
  generation++
})
async function download(format: TrainingExportFormat) {
  if (busy.value) return
  const g = ++generation,
    periodId = props.period.id
  busy.value = format
  error.value = null
  result.value = null
  try {
    const r = await api.exportPeriod(periodId, format)
    if (g === generation) result.value = { ...r, format }
  } catch (e) {
    if (g !== generation) return
    error.value = e as TrainingError
    if ([401, 403, 404].includes(error.value.status ?? 0)) emit('lost-access', error.value)
    await nextTick()
    document.getElementById('training-export-error')?.focus()
  } finally {
    if (g === generation) busy.value = ''
  }
}
function size(bytes: number) {
  return bytes < 1024 * 1024
    ? Math.max(1, Math.round(bytes / 1024)) + ' KB'
    : (bytes / 1024 / 1024).toFixed(1).replace('.', ',') + ' MB'
}
</script>
<template>
  <section class="tp-panel" aria-labelledby="training-export-title">
    <h2 id="training-export-title">Xuất kết quả {{ period.classCode }}</h2>
    <p>
      Phạm vi: <strong>{{ period.name }}</strong> · {{ period.academicYear }} · học kỳ
      {{ period.semester }}
    </p>
    <p>
      Sẽ xuất <strong>{{ summary.approved }}</strong> bản khoa đã duyệt.
      <span v-if="pending">
        {{ pending }} bản chưa duyệt chỉ được đếm trong thống kê, không có hàng điểm.</span
      >
    </p>
    <p v-if="!summary.approved" class="tp-muted">
      Chưa có bản được duyệt: tệp xuất chỉ gồm thống kê và ghi chú, không có bảng điểm.
    </p>
    <p class="tp-muted">
      Số lượng trên lấy tại lúc tải trang. Mỗi lần tải là một snapshot mới; chỉ các tệp cùng mã
      snapshot mới cùng nội dung. Gói ZIP chứa Excel, Word và PDF của cùng một snapshot.
    </p>
    <div class="tp-actions">
      <BaseButton
        v-for="f in formats"
        :key="f"
        :variant="f === 'zip' ? 'primary' : 'secondary'"
        :loading="busy === f"
        :disabled="!!busy"
        :aria-describedby="'training-export-' + f"
        @click="download(f)"
      >
        {{ trainingExportFormats[f].label }}
      </BaseButton>
    </div>
    <dl class="tp-muted">
      <template v-for="f in formats" :key="f">
        <dt>{{ trainingExportFormats[f].label }}</dt>
        <dd :id="'training-export-' + f">{{ trainingExportFormats[f].description }}</dd>
      </template>
    </dl>
    <p v-if="busy" role="status">
      Đang tạo {{ trainingExportFormats[busy].label.replace('Tải ', '') }}… Bản PDF và ZIP có thể
      mất vài chục giây.
    </p>
    <div
      v-if="error"
      id="training-export-error"
      class="tp-notice tp-notice--error"
      role="alert"
      tabindex="-1"
    >
      {{ error.message }}
    </div>
    <div v-if="result" class="tp-notice" role="status">
      <p>
        Đã tải <strong>{{ result.name }}</strong> ({{ size(result.size) }}).
      </p>
      <p>
        Mã snapshot: <code>{{ result.snapshotId }}</code>
      </p>
      <p>
        SHA-256: <code>{{ result.sha256 }}</code>
        <span v-if="result.verified"> — đã đối chiếu trên trình duyệt.</span>
        <span v-else> — trình duyệt không tự tính được, hãy đối chiếu thủ công nếu cần.</span>
      </p>
      <p class="tp-muted">
        Mã kiểm tra chỉ chứng minh tệp không bị thay đổi, không phải chữ ký số.
      </p>
    </div>
  </section>
</template>
