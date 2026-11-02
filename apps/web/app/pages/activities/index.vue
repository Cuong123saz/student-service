<script setup lang="ts">
import type {
  Certificate,
  RegistrationHistoryItem,
  StudentActivity,
  StudentRegistrationView,
} from '~/types/activity'
import type { TrainingError } from '~/types/training-point'
import {
  activityCategoryLabels,
  activityKindLabels,
  registrationStatusLabels,
} from '~/types/activity'
import { activityOrganizer, formatActivityTime } from '~/utils/activity'
definePageMeta({ middleware: 'user-auth' })
const api = useActivities(),
  items = ref<StudentActivity[] | null>(null),
  history = ref<RegistrationHistoryItem[]>([]),
  certificates = ref<Certificate[]>([]),
  truncated = ref(false),
  busy = ref(false),
  error = ref<TrainingError | null>(null),
  message = ref(''),
  cancelling = ref(''),
  reason = ref('')
async function run(fn: () => Promise<void>, done = '') {
  if (busy.value) return
  busy.value = true
  error.value = null
  message.value = ''
  try {
    await fn()
    message.value = done
  } catch (e) {
    error.value = e as TrainingError
    if ([401, 403].includes(error.value.status ?? 0)) items.value = null
  } finally {
    busy.value = false
  }
}
const load = () =>
  run(async () => {
    const [r, h, c] = await Promise.all([api.available(), api.history(), api.certificates()])
    items.value = r.items
    truncated.value = r.truncated
    history.value = h.items
    certificates.value = c.items
  })
function merge(id: string, v: StudentRegistrationView) {
  const a = items.value?.find((x) => x.id === id)
  if (a) Object.assign(a, v)
}
async function refreshHistory() {
  history.value = (await api.history()).items
}
const register = (a: StudentActivity) =>
  run(async () => {
    const v = await api.register(a.id)
    merge(a.id, v)
    await refreshHistory()
  }, 'Đã gửi đăng ký.')
const withdraw = (a: StudentActivity) =>
  run(async () => {
    merge(a.id, await api.withdraw(a.id))
    await refreshHistory()
  }, 'Đã rút khỏi danh sách chờ.')
const requestCancel = (a: StudentActivity) =>
  run(async () => {
    merge(a.id, await api.requestCancel(a.id, reason.value))
    cancelling.value = ''
    reason.value = ''
    await refreshHistory()
  }, 'Đã gửi yêu cầu hủy; chủ hoạt động sẽ xử lý.')
const seen = (a: StudentActivity) =>
  run(async () => {
    merge(a.id, await api.acknowledgePromotion(a.id))
  })
const canRegister = (a: StudentActivity) =>
  (!a.myStatus || a.myStatus === 'CANCELLED' || a.myStatus === 'WITHDRAWN') &&
  Date.parse(a.startsAt) > Date.now()
const canCancel = (a: StudentActivity) =>
  a.myStatus === 'REGISTERED' && Date.parse(a.cancelDeadline) > Date.now()
const outcome = (h: RegistrationHistoryItem) =>
  h.absent ? 'Vắng' : h.myStatus ? registrationStatusLabels[h.myStatus] : ''
onMounted(load)
</script>
<template>
  <section class="training-workspace training-workspace--student">
    <header>
      <NuxtLink to="/portal">← Cổng của tôi</NuxtLink>
      <p class="page-eyebrow">Sinh viên</p>
      <h1 class="page-title">Hoạt động ngoại khóa</h1>
      <p class="page-description">
        Chỉ hiển thị hoạt động đã công bố, chưa kết thúc và bạn thuộc đối tượng. Muốn hủy chỗ đã
        đăng ký, gửi yêu cầu kèm lý do trước giờ bắt đầu ít nhất 24 giờ.
      </p>
    </header>
    <div v-if="error" class="tp-notice tp-notice--error" role="alert">{{ error.message }}</div>
    <p v-if="message" class="tp-notice" role="status">{{ message }}</p>
    <p v-if="busy && !items" role="status">Đang tải hoạt động…</p>
    <section v-if="items" class="tp-panel" aria-labelledby="available-title">
      <h2 id="available-title">Hoạt động dành cho bạn</h2>
      <p v-if="!items.length">Hiện chưa có hoạt động phù hợp.</p>
      <ul class="tp-files">
        <li v-for="a in items" :key="a.id">
          <h3>{{ a.title }}</h3>
          <p v-if="a.promotionNotice" class="tp-notice" role="status">
            Bạn đã được chuyển từ danh sách chờ sang danh sách tham gia.
            <BaseButton variant="secondary" :disabled="busy" @click="seen(a)">Đã xem</BaseButton>
          </p>
          <p>
            {{ activityKindLabels[a.kind] }} · {{ activityCategoryLabels[a.category] }} ·
            {{ activityOrganizer(a) }}
          </p>
          <p>
            {{ formatActivityTime(a.startsAt) }} – {{ formatActivityTime(a.endsAt) }} ·
            {{ a.location }} ·
            {{
              a.capacity === null
                ? a.seatsTaken + ' người đã đăng ký'
                : a.seatsTaken + ' / ' + a.capacity + ' chỗ'
            }}
          </p>
          <p v-if="a.myStatus">
            <strong>{{ registrationStatusLabels[a.myStatus] }}</strong
            ><span v-if="a.waitlistPosition"> · vị trí {{ a.waitlistPosition }}</span>
          </p>
          <p v-if="a.description" class="tp-muted">{{ a.description }}</p>
          <div class="tp-actions">
            <BaseButton v-if="canRegister(a)" :disabled="busy" @click="register(a)"
              >Đăng ký {{ a.title }}</BaseButton
            ><BaseButton
              v-if="a.myStatus === 'WAITLISTED'"
              variant="secondary"
              :disabled="busy"
              @click="withdraw(a)"
              >Rút khỏi danh sách chờ</BaseButton
            ><BaseButton
              v-if="canCancel(a) && cancelling !== a.id"
              variant="secondary"
              :disabled="busy"
              @click="cancelling = a.id"
              >Yêu cầu hủy</BaseButton
            >
          </div>
          <p v-if="a.myStatus === 'REGISTERED' && !canCancel(a)" class="tp-muted">
            Đã quá hạn gửi yêu cầu hủy ({{ formatActivityTime(a.cancelDeadline) }}).
          </p>
          <div v-if="cancelling === a.id" class="tp-grid">
            <label class="tp-field" :for="'cancel-reason-' + a.id"
              >Lý do hủy (bắt buộc)<input
                :id="'cancel-reason-' + a.id"
                v-model="reason"
                maxlength="500"
                :disabled="busy"
            /></label>
            <div class="tp-actions">
              <BaseButton :disabled="busy || !reason.trim()" @click="requestCancel(a)"
                >Gửi yêu cầu hủy</BaseButton
              ><BaseButton variant="secondary" :disabled="busy" @click="cancelling = ''"
                >Thôi</BaseButton
              >
            </div>
          </div>
        </li>
      </ul>
      <p v-if="truncated" class="tp-muted">Chỉ hiển thị 200 hoạt động gần nhất.</p>
    </section>
    <section v-if="items && history.length" class="tp-panel" aria-labelledby="history-title">
      <h2 id="history-title">Đăng ký của tôi</h2>
      <ul class="tp-files">
        <li v-for="h in history" :key="h.activityId">
          <p>
            <strong>{{ h.title }}</strong> · {{ formatActivityTime(h.startsAt) }} · {{ outcome(h)
            }}<span v-if="h.excused"> · có lý do được chấp nhận</span>
          </p>
        </li>
      </ul>
    </section>
    <section
      v-if="items && certificates.length"
      class="tp-panel"
      aria-labelledby="certificates-title"
    >
      <h2 id="certificates-title">Chứng nhận tham gia</h2>
      <p class="tp-muted">
        Chứng nhận do hệ thống cấp khi lượt tham gia được duyệt; không phải văn bằng, chứng chỉ và
        chưa có chữ ký số.
      </p>
      <ul class="tp-files">
        <li v-for="c in certificates" :key="c.id">
          <p>
            <strong>{{ c.code }}</strong> · {{ c.activityTitle }} ·
            {{ formatActivityTime(c.activityStartsAt) }} ·
            {{ c.status === 'ISSUED' ? 'Hiệu lực' : 'Đã thu hồi' }}
          </p>
          <p v-if="c.revokeReason" class="tp-muted">Lý do thu hồi: {{ c.revokeReason }}</p>
          <p class="tp-muted">Mã kiểm tra: {{ c.payloadSha256 }}</p>
        </li>
      </ul>
    </section>
  </section>
</template>
<style src="~/assets/css/training.css"></style>
