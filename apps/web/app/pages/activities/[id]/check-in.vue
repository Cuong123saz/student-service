<script setup lang="ts">
import type { MyAttendance } from '~/types/activity'
import type { TrainingError } from '~/types/training-point'
import { attendanceStatusLabels } from '~/types/activity'

/**
 * ADR 0032: opened by scanning the printed/on-screen QR. The page opens the front camera itself;
 * there is deliberately no file picker. Timing rules live on the server; the countdown only reminds.
 */
definePageMeta({ middleware: 'user-auth' })
const route = useRoute(),
  api = useActivities(),
  attendance = ref<MyAttendance | null>(null),
  busy = ref(false),
  error = ref<TrainingError | null>(null),
  consent = ref(false),
  video = ref<HTMLVideoElement | null>(null),
  stream = ref<MediaStream | null>(null),
  cameraError = ref(''),
  now = ref(Date.now())
const id = computed(() => String(route.params.id).toLowerCase()),
  code = computed(() => (typeof route.query.code === 'string' ? route.query.code : ''))
const remaining = computed(() => {
  const end = attendance.value?.captureExpiresAt
  return end ? Math.max(0, Math.round((Date.parse(end) - now.value) / 1000)) : 0
})
let timer: ReturnType<typeof setInterval> | undefined
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
function stopCamera() {
  stream.value?.getTracks().forEach((t) => t.stop())
  stream.value = null
}
async function startCamera() {
  cameraError.value = ''
  try {
    stream.value = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 } },
      audio: false,
    })
    await nextTick()
    if (video.value) {
      video.value.srcObject = stream.value
      await video.value.play().catch(() => {})
    }
  } catch {
    cameraError.value =
      'Không mở được camera. Hãy cho phép trình duyệt dùng camera (cần HTTPS) rồi thử lại.'
  }
}
const scan = () =>
  run(async () => {
    attendance.value = await api.scan(id.value, code.value)
    if (attendance.value.status === 'SCANNED') await startCamera()
  })
function capture(): Promise<Blob> {
  const v = video.value!
  const scale = Math.min(1, 1280 / (v.videoWidth || 1280))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round((v.videoWidth || 1280) * scale)
  canvas.height = Math.round((v.videoHeight || 720) * scale)
  canvas.getContext('2d')!.drawImage(v, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('capture'))), 'image/jpeg', 0.85),
  )
}
const send = () =>
  run(async () => {
    const photo = await capture()
    attendance.value = await api.submitPhoto(id.value, photo)
    stopCamera()
  })
onMounted(() => {
  timer = setInterval(() => (now.value = Date.now()), 1000)
  void run(async () => {
    attendance.value = await api.attendance(id.value)
  })
})
onBeforeUnmount(() => {
  clearInterval(timer)
  stopCamera()
})
</script>
<template>
  <section class="training-workspace training-workspace--student">
    <header>
      <NuxtLink to="/activities">← Hoạt động ngoại khóa</NuxtLink>
      <p class="page-eyebrow">Điểm danh</p>
      <h1 class="page-title">Điểm danh hoạt động</h1>
    </header>
    <div v-if="error" class="tp-notice tp-notice--error" role="alert">{{ error.message }}</div>
    <p v-if="cameraError" class="tp-notice tp-notice--error" role="alert">{{ cameraError }}</p>
    <section class="tp-panel" aria-labelledby="checkin-title">
      <h2 id="checkin-title">Trạng thái</h2>
      <p v-if="attendance?.status">
        <strong>{{ attendanceStatusLabels[attendance.status] }}</strong>
        <span v-if="attendance.certificateCode">
          · chứng nhận {{ attendance.certificateCode }}</span
        >
      </p>
      <p v-else>Chưa điểm danh.</p>
      <p v-if="attendance?.reviewNote" class="tp-muted">Lý do: {{ attendance.reviewNote }}</p>
      <template v-if="!attendance?.status || (attendance.status === 'SCANNED' && !stream)">
        <p v-if="!code" class="tp-muted">
          Hãy quét mã QR tại hội trường bằng camera điện thoại để mở trang này.
        </p>
        <template v-else>
          <p class="tp-muted">
            Sau khi xác nhận mã, trang sẽ mở camera trước để bạn chụp một ảnh selfie thấy được hội
            trường hoặc đặc trưng của hoạt động (sân khấu, ban giám khảo). Ảnh được xóa thông tin vị
            trí, chỉ người duyệt của hoạt động và CTSV xem, và bị xóa sau 90 ngày kể từ khi hoạt
            động kết thúc.
          </p>
          <label class="tp-check"
            ><input v-model="consent" type="checkbox" :disabled="busy" />Tôi đã đọc và đồng ý chụp
            ảnh để điểm danh</label
          >
          <div class="tp-actions">
            <BaseButton :disabled="busy || !consent" @click="scan"
              >Xác nhận mã và mở camera</BaseButton
            >
          </div>
        </template>
      </template>
    </section>
    <section v-show="stream" class="tp-panel" aria-labelledby="camera-title">
      <h2 id="camera-title">Chụp ảnh tại hội trường</h2>
      <video ref="video" class="checkin-video" autoplay playsinline muted />
      <p role="timer">Còn {{ remaining }} giây để gửi ảnh.</p>
      <div class="tp-actions">
        <BaseButton :disabled="busy || remaining === 0" @click="send">Chụp và gửi</BaseButton>
      </div>
      <p v-if="remaining === 0" class="tp-muted">
        Hết thời gian chụp. Hãy quét lại mã QR để mở phiên mới.
      </p>
    </section>
  </section>
</template>
<style src="~/assets/css/training.css"></style>
<style scoped>
.checkin-video {
  width: 100%;
  max-width: 480px;
  border-radius: 8px;
  transform: scaleX(-1);
  background: #000;
}
</style>
