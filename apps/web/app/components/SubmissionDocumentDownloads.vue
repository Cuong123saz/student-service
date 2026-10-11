<script setup lang="ts">
import type { DocumentFormat } from '~/utils/submission-document'
import { submissionDocumentUrl } from '~/utils/submission-document'
const props = defineProps<{
  submissionId: string
  roundNumber: number
  reviewPortal?: 'user' | 'admin'
  compact?: boolean
}>()
const apiBase = String(useRuntimeConfig().public.apiBase)
const busy = ref<DocumentFormat | null>(null)
const failure = ref('')
const supportCode = ref('')
const loginRequired = ref(false)
const status = ref('')
let generation = 0
watch(
  () => [props.submissionId, props.roundNumber, props.reviewPortal],
  () => {
    generation++
    busy.value = null
    failure.value = ''
    status.value = ''
    supportCode.value = ''
    loginRequired.value = false
  },
)
onBeforeUnmount(() => {
  generation++
})
async function download(format: DocumentFormat) {
  if (busy.value) return
  const current = generation
  const id = props.submissionId,
    roundNumber = props.roundNumber
  busy.value = format
  failure.value = ''
  status.value = ''
  supportCode.value = ''
  loginRequired.value = false
  try {
    const response = await fetch(
      submissionDocumentUrl(apiBase, props.reviewPortal, id, roundNumber, format),
      { credentials: 'include' },
    )
    if (current !== generation) return
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        message?: string
        requestId?: string
      }
      if (current !== generation) return
      supportCode.value = body.requestId ?? ''
      loginRequired.value = response.status === 401
      throw new Error(
        body.message ?? 'Chưa tải được phiếu. Vui lòng thử lại; hồ sơ đã gửi vẫn được giữ nguyên.',
      )
    }
    const expected =
      format === 'pdf'
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    if (response.headers.get('content-type')?.split(';')[0] !== expected)
      throw new Error('Máy chủ chưa trả về đúng định dạng tài liệu. Vui lòng thử lại.')
    const bytes = await response.blob()
    if (current !== generation) return
    if (!bytes.size) throw new Error('Tài liệu chưa có nội dung. Vui lòng thử lại.')
    const url = URL.createObjectURL(bytes)
    const link = document.createElement('a')
    link.href = url
    link.download = 'phieu-ho-so-' + id + '-lan-' + roundNumber + '.' + format
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60000)
    status.value =
      'Đã tải phiếu ' + (format === 'pdf' ? 'PDF' : 'Word') + ' của lần gửi ' + roundNumber + '.'
  } catch (error) {
    if (current === generation)
      failure.value =
        error instanceof Error ? error.message : 'Không thể kết nối để tải phiếu. Vui lòng thử lại.'
  } finally {
    if (current === generation) busy.value = null
  }
}
</script>
<template>
  <section
    class="document-downloads"
    :class="{ 'document-downloads--compact': compact }"
    :aria-label="'Phiếu hồ sơ lần gửi ' + roundNumber"
  >
    <component :is="compact ? 'h4' : 'h2'">{{
      compact ? 'Phiếu của lần gửi ' + roundNumber : 'Phiếu thông tin hồ sơ'
    }}</component>
    <p>
      Hệ thống tự điền toàn bộ thông tin từ lần gửi {{ roundNumber }} đã ghi nhận. Bản kê khai chưa
      ký, chưa phải văn bản được cấp.
    </p>
    <div class="document-downloads__actions">
      <BaseButton
        type="button"
        variant="secondary"
        :loading="busy === 'docx'"
        :disabled="busy !== null"
        @click="download('docx')"
        >{{ busy === 'docx' ? 'Đang tạo Word...' : 'Tải Word' }}</BaseButton
      >
      <BaseButton
        type="button"
        :loading="busy === 'pdf'"
        :disabled="busy !== null"
        @click="download('pdf')"
        >{{ busy === 'pdf' ? 'Đang tạo PDF...' : 'Tải PDF' }}</BaseButton
      >
    </div>
    <p v-if="busy" role="status">Đang chuẩn bị phiếu. Bạn không cần gửi lại hồ sơ.</p>
    <div v-if="failure" role="alert">
      <p>{{ failure }}</p>
      <small v-if="supportCode">Mã hỗ trợ: {{ supportCode }}</small
      ><NuxtLink v-if="loginRequired" :to="reviewPortal === 'admin' ? '/admin/login' : '/login'"
        >Đăng nhập lại</NuxtLink
      >
    </div>
    <p v-if="status" role="status">{{ status }}</p>
  </section>
</template>
<style scoped>
.document-downloads {
  padding: 24px;
  margin: 24px 0;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  min-width: 0;
  overflow-wrap: anywhere;
}
.document-downloads--compact {
  padding: 16px;
  margin: 16px 0;
  background: var(--color-background);
}
.document-downloads h2 {
  font-size: 21px;
  margin: 0 0 10px;
}
.document-downloads h4 {
  font-size: 16px;
  margin: 0 0 10px;
}
.document-downloads p {
  line-height: 1.65;
  margin: 10px 0;
}
.document-downloads__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 16px;
}
.document-downloads [role='alert'] {
  color: var(--color-error);
}
.document-downloads small,
.document-downloads a {
  display: block;
  margin-top: 8px;
}
</style>
