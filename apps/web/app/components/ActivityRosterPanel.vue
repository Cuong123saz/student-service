<script setup lang="ts">
import type { ActivityRoster, RosterEntry } from '~/types/activity'
import type { TrainingError } from '~/types/training-point'
import { registrationStatusLabels } from '~/types/activity'
import { formatActivityTime } from '~/utils/activity'

/** ADR 0031: registrations of one activity and cancellation decisions. */
const props = defineProps<{ activityId: string }>()
const api = useActivities(),
  roster = ref<ActivityRoster | null>(null),
  busy = ref(false),
  error = ref<TrainingError | null>(null),
  message = ref(''),
  notes = reactive<Record<string, string>>({})
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
    if ([401, 403, 404].includes(error.value.status ?? 0)) roster.value = null
  } finally {
    if (g === generation) busy.value = false
  }
}
const load = () =>
  run(async (g) => {
    const r = await api.roster(props.activityId)
    if (g === generation) roster.value = r
  })
const decide = (e: RosterEntry, accept: boolean) =>
  run(
    async (g) => {
      const r = await api.decide(props.activityId, e.id, e.revision, accept, notes[e.id] ?? '')
      if (g === generation) roster.value = r
    },
    accept
      ? 'Đã chấp nhận yêu cầu hủy; chỗ trống được chuyển cho danh sách chờ.'
      : 'Đã từ chối yêu cầu hủy.',
  )
const status = (e: RosterEntry) => (e.absent ? 'Vắng' : registrationStatusLabels[e.status])
watch(() => props.activityId, load)
onMounted(load)
onBeforeUnmount(() => {
  generation++
})
</script>
<template>
  <section class="tp-panel" aria-labelledby="activity-roster-title">
    <h2 id="activity-roster-title">Đăng ký</h2>
    <div v-if="error" class="tp-notice tp-notice--error" role="alert">{{ error.message }}</div>
    <p v-if="message" class="tp-notice" role="status">{{ message }}</p>
    <p v-if="busy && !roster" role="status">Đang tải danh sách đăng ký…</p>
    <template v-if="roster">
      <p>
        Đang giữ chỗ: <strong>{{ roster.summary.seats }}</strong
        ><span v-if="roster.activity.capacity !== null"> / {{ roster.activity.capacity }}</span> ·
        Danh sách chờ: <strong>{{ roster.summary.waitlisted }}</strong> · Chờ duyệt hủy:
        <strong>{{ roster.summary.pendingCancellations }}</strong> · Đã hủy:
        {{ roster.summary.cancelled }} · Vắng: {{ roster.summary.absent }}
      </p>
      <p class="tp-muted">
        Yêu cầu hủy chưa xử lý tới giờ bắt đầu được tự động chấp nhận. Không ai tự xử lý yêu cầu của
        chính mình.
      </p>
      <p v-if="!roster.items.length">Chưa có ai đăng ký.</p>
      <ul class="tp-files">
        <li v-for="e in roster.items" :key="e.id">
          <p>
            <strong>{{ e.fullName }}</strong> · {{ e.studentCode }} · {{ e.classCode }} ·
            {{ status(e) }}<span v-if="e.waitlistPosition"> · vị trí {{ e.waitlistPosition }}</span
            ><span v-if="e.autoAccepted"> · tự động chấp nhận</span>
          </p>
          <p v-if="e.cancelReason" class="tp-muted">
            Lý do hủy: {{ e.cancelReason
            }}<span v-if="e.cancelRequestedAt">
              ({{ formatActivityTime(e.cancelRequestedAt) }})</span
            >
          </p>
          <p v-if="e.decisionNote" class="tp-muted">Ghi chú xử lý: {{ e.decisionNote }}</p>
          <div v-if="roster.canDecide && e.status === 'CANCEL_REQUESTED'" class="tp-grid">
            <label class="tp-field" :for="'decision-note-' + e.id"
              >Ghi chú (bắt buộc khi từ chối)<input
                :id="'decision-note-' + e.id"
                v-model="notes[e.id]"
                maxlength="500"
                :disabled="busy"
            /></label>
            <div class="tp-actions">
              <BaseButton :disabled="busy" @click="decide(e, true)"
                >Chấp nhận hủy {{ e.studentCode }}</BaseButton
              ><BaseButton
                variant="secondary"
                :disabled="busy || !(notes[e.id] ?? '').trim()"
                @click="decide(e, false)"
                >Từ chối hủy {{ e.studentCode }}</BaseButton
              >
            </div>
          </div>
        </li>
      </ul>
      <p v-if="roster.truncated" class="tp-muted">Chỉ hiển thị 5.000 lượt đầu.</p>
    </template>
  </section>
</template>
