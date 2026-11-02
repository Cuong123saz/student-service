<script setup lang="ts">
import type { AttendanceEntry, AttendanceQueue } from '~/types/activity'
import type { TrainingError } from '~/types/training-point'
import { attendanceStatusLabels } from '~/types/activity'
import { formatActivityTime } from '~/utils/activity'

/** ADR 0032: review queue with photos, batch approval and certificate revocation (CTSV). */
const props = defineProps<{ activityId: string }>()
const api = useActivities(),
  queue = ref<AttendanceQueue | null>(null),
  busy = ref(false),
  error = ref<TrainingError | null>(null),
  message = ref(''),
  selected = ref<string[]>([]),
  notes = reactive<Record<string, string>>({}),
  photos = reactive<Record<string, string>>({})
let generation = 0
async function run(fn: (g: number) => Promise<void>, done = '') {
  if (busy.value) return
  const g = ++generation
  busy.value = true
  error.value = null
  message.value = ''
  try {
    await fn(g)
    if (g === generation) message.value = done
  } catch (e) {
    if (g !== generation) return
    error.value = e as TrainingError
    if ([401, 403, 404].includes(error.value.status ?? 0)) queue.value = null
  } finally {
    if (g === generation) busy.value = false
  }
}
const load = () =>
  run(async (g) => {
    const q = await api.attendanceQueue(props.activityId)
    if (g === generation) queue.value = q
  })
const pending = computed(
  () => queue.value?.items.filter((i) => i.status === 'PENDING_REVIEW') ?? [],
)
const showPhoto = (e: AttendanceEntry) =>
  run(async () => {
    photos[e.id] = URL.createObjectURL(await api.attendancePhoto(props.activityId, e.id))
  })
function review(entries: AttendanceEntry[], approve: boolean, note = '') {
  if (entries.length > 1 && !window.confirm('Duyệt ' + entries.length + ' lượt tham gia đã chọn?'))
    return
  return run(
    async (g) => {
      const q = await api.review(
        props.activityId,
        entries.map((e) => ({ id: e.id, revision: e.revision })),
        approve,
        note,
      )
      if (g === generation) {
        queue.value = q
        selected.value = []
      }
    },
    approve ? 'Đã duyệt và cấp chứng nhận.' : 'Đã từ chối lượt tham gia.',
  )
}
const approveSelected = () =>
  review(
    pending.value.filter((e) => selected.value.includes(e.id)),
    true,
  )
const revoke = (e: AttendanceEntry) =>
  run(async (g) => {
    await api.revokeCertificate(e.certificate!.id, notes[e.id] ?? '')
    const q = await api.attendanceQueue(props.activityId)
    if (g === generation) queue.value = q
  }, 'Đã thu hồi chứng nhận.')
onMounted(load)
onBeforeUnmount(() => {
  generation++
  Object.values(photos).forEach((u) => URL.revokeObjectURL(u))
})
</script>
<template>
  <section class="tp-panel" aria-labelledby="attendance-title">
    <h2 id="attendance-title">Duyệt lượt tham gia</h2>
    <div v-if="error" class="tp-notice tp-notice--error" role="alert">{{ error.message }}</div>
    <p v-if="message" class="tp-notice" role="status">{{ message }}</p>
    <template v-if="queue">
      <p>
        Chờ duyệt: <strong>{{ queue.summary.pending }}</strong> · Đã duyệt:
        {{ queue.summary.approved }} · Từ chối: {{ queue.summary.rejected }}
      </p>
      <p class="tp-muted">
        Chứng nhận là bản ghi của hệ thống, chưa phải chữ ký số và không có hiệu lực pháp lý. Mọi
        lần xem ảnh được ghi nhật ký.
      </p>
      <div v-if="queue.canReview && pending.length" class="tp-actions">
        <BaseButton :disabled="busy || !selected.length" @click="approveSelected"
          >Duyệt {{ selected.length }} lượt đã chọn</BaseButton
        >
      </div>
      <p v-if="!queue.items.length">Chưa có lượt nào gửi ảnh.</p>
      <ul class="tp-files">
        <li v-for="e in queue.items" :key="e.id">
          <label v-if="queue.canReview && e.status === 'PENDING_REVIEW'" class="tp-check"
            ><input v-model="selected" type="checkbox" :value="e.id" :disabled="busy" />Chọn
            {{ e.studentCode }}</label
          >
          <p>
            <strong>{{ e.fullName }}</strong> · {{ e.studentCode }} · {{ e.classCode }} ·
            {{ attendanceStatusLabels[e.status] }}
            <span v-if="e.submittedAt"> · gửi {{ formatActivityTime(e.submittedAt) }}</span>
          </p>
          <p v-if="e.reviewNote" class="tp-muted">Lý do: {{ e.reviewNote }}</p>
          <p v-if="e.certificate">
            Chứng nhận {{ e.certificate.code
            }}<span v-if="e.certificate.status === 'REVOKED'">
              · đã thu hồi: {{ e.certificate.revokeReason }}</span
            >
          </p>
          <img
            v-if="photos[e.id]"
            :src="photos[e.id]"
            :alt="'Ảnh điểm danh ' + e.studentCode"
            class="attendance-photo"
          />
          <div class="tp-actions">
            <BaseButton
              v-if="e.hasPhoto && !photos[e.id]"
              variant="secondary"
              :disabled="busy"
              @click="showPhoto(e)"
              >Xem ảnh {{ e.studentCode }}</BaseButton
            >
          </div>
          <div
            v-if="
              (queue.canReview && e.status === 'PENDING_REVIEW') ||
              (queue.canRevoke && e.certificate?.status === 'ISSUED')
            "
            class="tp-grid"
          >
            <label class="tp-field" :for="'attendance-note-' + e.id"
              >Lý do (bắt buộc khi từ chối/thu hồi)<input
                :id="'attendance-note-' + e.id"
                v-model="notes[e.id]"
                maxlength="500"
                :disabled="busy"
            /></label>
            <div class="tp-actions">
              <template v-if="queue.canReview && e.status === 'PENDING_REVIEW'">
                <BaseButton :disabled="busy" @click="review([e], true)"
                  >Duyệt {{ e.studentCode }}</BaseButton
                ><BaseButton
                  variant="secondary"
                  :disabled="busy || !(notes[e.id] ?? '').trim()"
                  @click="review([e], false, notes[e.id])"
                  >Từ chối {{ e.studentCode }}</BaseButton
                >
              </template>
              <BaseButton
                v-if="queue.canRevoke && e.certificate?.status === 'ISSUED'"
                variant="secondary"
                :disabled="busy || !(notes[e.id] ?? '').trim()"
                @click="revoke(e)"
                >Thu hồi chứng nhận {{ e.studentCode }}</BaseButton
              >
            </div>
          </div>
        </li>
      </ul>
    </template>
  </section>
</template>
<style scoped>
.attendance-photo {
  width: 220px;
  max-width: 100%;
  border-radius: 6px;
}
</style>
