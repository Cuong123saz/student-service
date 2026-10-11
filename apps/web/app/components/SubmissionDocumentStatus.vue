<script setup lang="ts">
import {
  submissionDocumentStatusUrl,
  submissionDocumentUrl,
  type SubmissionDocumentStatus,
  type SubmissionDocumentState,
} from '~/utils/submission-document'
const props = defineProps<{
  submissionId: string
  roundNumber: number
  reviewPortal?: 'user' | 'admin'
  disabled?: boolean
}>()
const apiBase = String(useRuntimeConfig().public.apiBase)
const result = ref<SubmissionDocumentStatus | null>(null)
const loading = ref(false)
const saving = ref<string | null>(null)
const failure = ref('')
const message = ref('')
const checked = ref<Record<string, boolean>>({})
const requests = new Map<string, { attemptId: string; id: string }>()
let generation = 0
watch(
  () => [props.submissionId, props.roundNumber, props.reviewPortal],
  () => {
    generation++
    result.value = null
    loading.value = false
    saving.value = null
    failure.value = ''
    message.value = ''
    checked.value = {}
    requests.clear()
  },
)
onBeforeUnmount(() => {
  generation++
})
const states = {
  NOT_STARTED: 'Chưa tạo',
  RUNNING: 'Đang tạo',
  WAITING: 'Chờ lượt tải tiếp theo',
  EXHAUSTED: 'Đã hết lượt thử',
  READY: 'Đã lưu thành công',
}
const reasons: Record<string, { code: string; error: string; confirmation: string }> = {
  RENDER_FAILED: {
    code: 'RENDERER_FIXED',
    error: 'Chưa điền được mẫu Word.',
    confirmation: 'Tôi đã kiểm tra và khắc phục việc điền mẫu Word.',
  },
  CONVERT_FAILED: {
    code: 'CONVERTER_FIXED',
    error: 'Chưa chuyển được Word sang PDF.',
    confirmation: 'Tôi đã kiểm tra và khắc phục bộ chuyển PDF.',
  },
  STORAGE_FAILED: {
    code: 'STORAGE_FIXED',
    error: 'Chưa lưu được tài liệu.',
    confirmation: 'Tôi đã kiểm tra và khắc phục việc lưu tài liệu.',
  },
  LEASE_EXPIRED: {
    code: 'WORKER_RESTARTED',
    error: 'Tác vụ trước đã quá thời gian xử lý.',
    confirmation: 'Tôi đã kiểm tra và dừng hoặc khởi động lại tác vụ bị kẹt.',
  },
}
function key(item: SubmissionDocumentState) {
  return item.format + ':' + item.attemptId
}
async function load() {
  if (loading.value || saving.value || props.disabled) return
  const current = generation
  loading.value = true
  failure.value = ''
  try {
    const response = await fetch(
      submissionDocumentStatusUrl(
        apiBase,
        props.reviewPortal,
        props.submissionId,
        props.roundNumber,
      ),
      { credentials: 'include', cache: 'no-store' },
    )
    const body = await response.json()
    if (current !== generation) return
    if (!response.ok) throw new Error(body.message ?? 'Chưa kiểm tra được tình trạng tài liệu.')
    result.value = body as SubmissionDocumentStatus
  } catch (error) {
    if (current === generation)
      failure.value =
        error instanceof Error ? error.message : 'Chưa kết nối được. Hãy kiểm tra lại.'
  } finally {
    if (current === generation) loading.value = false
  }
}
async function retry(item: SubmissionDocumentState) {
  if (
    saving.value ||
    loading.value ||
    props.disabled ||
    !item.retryAllowed ||
    !item.attemptId ||
    !checked.value[key(item)]
  )
    return
  const reason = item.errorCode ? reasons[item.errorCode] : undefined
  if (!reason || !props.reviewPortal) return
  const current = generation
  saving.value = item.format
  failure.value = ''
  message.value = ''
  let request = requests.get(item.format)
  if (!request || request.attemptId !== item.attemptId) {
    request = { attemptId: item.attemptId, id: crypto.randomUUID() }
    requests.set(item.format, request)
  }
  try {
    const response = await fetch(
      submissionDocumentUrl(
        apiBase,
        props.reviewPortal,
        props.submissionId,
        props.roundNumber,
        item.format,
      ) + '/retry',
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: request.id,
          expectedAttemptId: item.attemptId,
          reasonCode: reason.code,
        }),
      },
    )
    const body = await response.json()
    if (current !== generation) return
    if (!response.ok)
      throw new Error(
        body.message ?? 'Chưa mở được lượt tạo tài liệu. Hãy kiểm tra lại tình trạng.',
      )
    item.retryAllowed = false
    item.attemptLimit = body.attemptLimit
    item.state = 'WAITING'
    message.value =
      'Đã ghi nhận người mở thêm một lượt. Chờ vài giây rồi chọn Tải ' +
      (item.format === 'pdf' ? 'PDF' : 'Word') +
      '.'
    checked.value[key(item)] = false
  } catch (error) {
    if (current === generation)
      failure.value =
        (error instanceof Error ? error.message : 'Chưa nhận được phản hồi.') +
        ' Kiểm tra tình trạng trước khi thao tác tiếp; hồ sơ không cần gửi lại.'
  } finally {
    if (current === generation) saving.value = null
  }
}
</script>
<template>
  <div class="document-state">
    <BaseButton
      type="button"
      variant="secondary"
      :loading="loading"
      :disabled="disabled || loading || saving !== null"
      @click="load"
      >{{ loading ? 'Đang kiểm tra...' : 'Kiểm tra tình trạng tài liệu' }}</BaseButton
    >
    <p v-if="result && !result.enabled" role="status">
      Môi trường này chưa bật theo dõi tài liệu đã lưu.
    </p>
    <ul v-if="result?.enabled" aria-label="Tình trạng Word và PDF">
      <li v-for="item in result.documents" :key="item.format">
        <strong>{{ item.format === 'pdf' ? 'PDF' : 'Word' }}: {{ states[item.state] }}</strong>
        <span v-if="item.attempts"> · Đã thử {{ item.attempts }}/{{ item.attemptLimit }} lần.</span>
        <p v-if="item.errorCode && item.state !== 'READY'">
          {{ reasons[item.errorCode]?.error ?? 'Cần người phụ trách kiểm tra.' }}
        </p>
        <p v-if="item.state === 'EXHAUSTED' && !item.retryAllowed">
          Người phụ trách cần kiểm tra nguyên nhân. Bạn vẫn có thể tải bản đã tạo thành công và
          không cần gửi lại hồ sơ.
        </p>
        <div
          v-if="item.retryAllowed && reviewPortal && item.errorCode && reasons[item.errorCode]"
          class="document-state__retry"
        >
          <label
            ><input
              v-model="checked[key(item)]"
              type="checkbox"
              :disabled="disabled || loading || saving !== null"
            />
            {{ reasons[item.errorCode]!.confirmation }}</label
          >
          <p>
            Mở đúng một lượt; hệ thống ghi nhận người thực hiện. Còn
            {{ item.remainingAuthorizations }} lần được phép mở thêm.
          </p>
          <BaseButton
            type="button"
            :loading="saving === item.format"
            :disabled="disabled || loading || saving !== null || !checked[key(item)]"
            @click="retry(item)"
            >Mở thêm một lượt tạo {{ item.format === 'pdf' ? 'PDF' : 'Word' }}</BaseButton
          >
        </div>
      </li>
    </ul>
    <p v-if="failure" role="alert">{{ failure }}</p>
    <p v-if="message" role="status">{{ message }}</p>
  </div>
</template>
<style scoped>
.document-state {
  margin-top: 16px;
  min-width: 0;
  overflow-wrap: anywhere;
}
.document-state ul {
  list-style: none;
  padding: 0;
  margin: 16px 0 0;
}
.document-state li {
  border-top: 1px solid var(--color-border);
  padding: 14px 0;
  line-height: 1.65;
}
.document-state p {
  margin: 8px 0;
}
.document-state__retry {
  padding: 16px;
  margin-top: 12px;
  background: var(--color-background);
  border-radius: var(--radius-md);
}
.document-state label {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  cursor: pointer;
}
.document-state input {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  margin-top: 4px;
  accent-color: var(--color-primary);
}
.document-state [role='alert'] {
  color: var(--color-error);
}
</style>
