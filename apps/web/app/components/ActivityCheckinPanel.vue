<script setup lang="ts">
import type { ActivityDetail } from '~/types/activity'
import type { TrainingError } from '~/types/training-point'

/** ADR 0032: printable QR, optional rotating on-screen QR and secret reset (owner only). */
const props = defineProps<{ activity: ActivityDetail; owner: boolean }>()
const emit = defineEmits<{ changed: [activity: ActivityDetail] }>()
const api = useActivities(),
  qrUrl = ref(''),
  busy = ref(false),
  error = ref<TrainingError | null>(null),
  rotating = ref(false)
let timer: ReturnType<typeof setInterval> | undefined
function setQr(blob: Blob) {
  if (qrUrl.value) URL.revokeObjectURL(qrUrl.value)
  qrUrl.value = URL.createObjectURL(blob)
}
async function loadQr() {
  try {
    setQr(await api.checkinQr(props.activity.id))
  } catch (e) {
    error.value = e as TrainingError
  }
}
async function run(fn: () => Promise<void>) {
  if (busy.value) return
  busy.value = true
  error.value = null
  try {
    await fn()
  } catch (e) {
    error.value = e as TrainingError
  } finally {
    busy.value = false
  }
}
const configure = (change: { reset: true } | { rotating: boolean }) =>
  run(async () => {
    if (
      'reset' in change &&
      !window.confirm('Mọi mã QR đã in hoặc đang chiếu sẽ mất hiệu lực. Tiếp tục?')
    )
      return
    emit('changed', await api.configureCheckin(props.activity.id, props.activity.revision, change))
    await loadQr()
  })
function schedule() {
  clearInterval(timer)
  // Rotating codes change every 30 s; refreshing every 20 s keeps the shown code valid.
  if (rotating.value) timer = setInterval(() => void loadQr(), 20_000)
}
watch(
  () => props.activity.revision,
  () => void loadQr(),
)
watch(rotating, schedule)
onMounted(() => void loadQr())
onBeforeUnmount(() => {
  clearInterval(timer)
  if (qrUrl.value) URL.revokeObjectURL(qrUrl.value)
})
</script>
<template>
  <section class="tp-panel" aria-labelledby="checkin-qr-title">
    <h2 id="checkin-qr-title">Mã QR điểm danh</h2>
    <div v-if="error" class="tp-notice tp-notice--error" role="alert">{{ error.message }}</div>
    <img v-if="qrUrl" :src="qrUrl" alt="Mã QR điểm danh" class="checkin-qr" />
    <p class="tp-muted">
      In mã này hoặc chiếu lên màn hình. Sinh viên quét bằng camera điện thoại trong giờ diễn ra
      hoạt động rồi chụp selfie thấy hội trường.
    </p>
    <div class="tp-actions">
      <a v-if="qrUrl" class="button button--secondary" :href="qrUrl" download="checkin-qr.svg"
        >Tải mã QR (SVG)</a
      >
      <label class="tp-check"
        ><input v-model="rotating" type="checkbox" />Tự làm mới mã khi chiếu màn hình</label
      >
    </div>
    <template v-if="owner">
      <p class="tp-muted">
        Chế độ QR đổi liên tục làm mã in sẵn mất hiệu lực; chỉ dùng khi chiếu mã trên màn hình.
      </p>
      <div class="tp-actions">
        <BaseButton variant="secondary" :disabled="busy" @click="configure({ rotating: true })"
          >Bật QR đổi liên tục</BaseButton
        ><BaseButton variant="secondary" :disabled="busy" @click="configure({ rotating: false })"
          >Dùng QR in sẵn</BaseButton
        ><BaseButton variant="secondary" :disabled="busy" @click="configure({ reset: true })"
          >Đặt lại mã QR</BaseButton
        >
      </div>
    </template>
  </section>
</template>
<style scoped>
.checkin-qr {
  width: 240px;
  max-width: 100%;
  background: #fff;
  padding: 8px;
}
</style>
