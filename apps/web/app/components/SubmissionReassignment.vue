<script setup lang="ts">
import type { ReviewSubmissionDetail } from '~/types/submission'
import type { ProcedureApiError } from '~/types/procedure'
const props = defineProps<{
  portal: 'user' | 'admin'
  detail: ReviewSubmissionDetail
  blocked: boolean
}>()
const emit = defineEmits<{
  pending: [value: boolean]
  updated: [value: ReviewSubmissionDetail]
  failed: [error: ProcedureApiError]
}>()
const api = useReviewSubmissions(props.portal)
const candidates = ref<{ id: string; fullName: string }[]>([]),
  recipient = ref(''),
  note = ref(''),
  loading = ref(false),
  sending = ref(false),
  reviewed = ref(false),
  confirmed = ref(false),
  failure = ref('')
const summary = ref<HTMLElement | null>(null)
let generation = 0
const normalized = computed(() => note.value.trim())
const valid = computed(
  () =>
    !!recipient.value &&
    candidates.value.some((c) => c.id === recipient.value) &&
    normalized.value.length > 0 &&
    normalized.value.length <= 2000,
)
const disabled = computed(
  () => props.blocked || loading.value || sending.value || !props.detail.canReassign,
)
function reset() {
  reviewed.value = false
  confirmed.value = false
}
watch([recipient, note], reset, { flush: 'sync' })
async function loadCandidates() {
  const run = ++generation,
    id = props.detail.id
  candidates.value = []
  loading.value = true
  failure.value = ''
  try {
    const data = await api.assignees(id)
    if (run === generation) candidates.value = data.candidates
  } catch (error) {
    if (run === generation) {
      failure.value = (error as ProcedureApiError).message
      emit('failed', error as ProcedureApiError)
    }
  } finally {
    if (run === generation) loading.value = false
  }
}
watch(
  () => [props.detail.id, props.detail.revision, props.detail.canReassign] as const,
  () => {
    reset()
    if (props.detail.canReassign) void loadCandidates()
    else {
      generation++
      candidates.value = []
      loading.value = false
    }
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  generation++
})
function review() {
  if (disabled.value || !valid.value) return
  reviewed.value = true
  confirmed.value = false
  void nextTick(() => summary.value?.focus())
}
async function submit() {
  if (disabled.value || !valid.value || !reviewed.value || !confirmed.value) return
  const run = generation,
    id = props.detail.id,
    revision = props.detail.revision,
    target = recipient.value,
    reason = normalized.value
  sending.value = true
  emit('pending', true)
  failure.value = ''
  reset()
  try {
    const data = await api.reassign(id, revision, target, reason)
    if (run !== generation) return
    recipient.value = ''
    note.value = ''
    emit('updated', data)
  } catch (error) {
    if (run === generation) {
      failure.value = (error as ProcedureApiError).message
      emit('failed', error as ProcedureApiError)
    }
  } finally {
    if (run === generation) {
      sending.value = false
      emit('pending', false)
    }
  }
}
</script>
<template>
  <section v-if="detail.canReassign || note" class="handover-panel" aria-label="Bàn giao hồ sơ">
    <h2>Bàn giao cán bộ xử lý</h2>
    <p>Chọn cán bộ mới đủ quyền trong đơn vị. Nội dung và từng lần nộp được giữ nguyên.</p>
    <p>
      Người đang xử lý: <strong>{{ detail.reviewerName || 'Chưa có' }}</strong>
    </p>
    <p v-if="failure" role="alert">{{ failure }}</p>
    <p v-if="loading" role="status">Đang tải cán bộ có thể nhận…</p>
    <fieldset :disabled="disabled">
      <label for="handover-recipient">Cán bộ nhận mới *</label>
      <select id="handover-recipient" v-model="recipient">
        <option value="">Chọn cán bộ</option>
        <option
          v-if="recipient && !candidates.some((c) => c.id === recipient)"
          :value="recipient"
          disabled
        >
          Người đã chọn không còn trong danh sách hợp lệ
        </option>
        <option v-for="person in candidates" :key="person.id" :value="person.id">
          {{ person.fullName }}
        </option>
      </select>
      <p v-if="!loading && !candidates.length">Chưa có cán bộ khác đủ điều kiện nhận hồ sơ.</p>
      <label for="handover-note">Lý do bàn giao *</label>
      <textarea id="handover-note" v-model="note" rows="4" aria-describedby="handover-note-help" />
      <small id="handover-note-help"
        >Nhập từ 1 đến 2000 ký tự sau khi bỏ khoảng trắng hai đầu.</small
      >
      <BaseButton type="button" variant="secondary" :disabled="disabled || !valid" @click="review"
        >Xem lại bàn giao</BaseButton
      >
    </fieldset>
    <div v-if="reviewed" ref="summary" class="handover-summary" tabindex="-1">
      <h3>Xác nhận bàn giao</h3>
      <p>{{ detail.reviewerName }} → {{ candidates.find((c) => c.id === recipient)?.fullName }}</p>
      <p class="handover-note">{{ normalized }}</p>
      <label for="handover-confirm"
        ><input id="handover-confirm" v-model="confirmed" type="checkbox" :disabled="disabled" />
        Tôi xác nhận chuyển hồ sơ cho cán bộ đã chọn.</label
      >
      <BaseButton
        type="button"
        :loading="sending"
        :disabled="disabled || !confirmed || !valid"
        @click="submit"
        >Bàn giao hồ sơ</BaseButton
      >
    </div>
  </section>
</template>
<style scoped>
.handover-panel {
  padding: 26px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  min-width: 0;
  overflow-wrap: anywhere;
}
.handover-panel h2 {
  font-size: 21px;
  margin-top: 0;
}
.handover-panel p {
  line-height: 1.65;
}
.handover-panel fieldset {
  border: 0;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 12px;
  min-width: 0;
}
.handover-panel label {
  font-weight: 650;
  line-height: 1.6;
}
.handover-panel select,
.handover-panel textarea {
  width: 100%;
  min-height: 44px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 12px;
  font: inherit;
  background: var(--color-surface);
}
.handover-panel small {
  color: var(--color-muted);
  line-height: 1.6;
}
.handover-summary {
  margin-top: 20px;
  padding: 20px;
  background: var(--color-background);
  border-radius: 8px;
  display: grid;
  gap: 12px;
}
.handover-summary input {
  width: 20px;
  height: 20px;
  vertical-align: middle;
  margin-right: 8px;
}
.handover-note {
  white-space: pre-wrap;
}
.handover-panel :focus-visible {
  outline: 3px solid var(--color-primary);
  outline-offset: 3px;
}
@media (max-width: 640px) {
  .handover-panel {
    padding: 20px;
  }
}
</style>
