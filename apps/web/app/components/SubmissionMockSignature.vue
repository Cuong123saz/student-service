<script setup lang="ts">
import { submissionDocumentUrl, submissionDocumentStatusUrl } from '~/utils/submission-document'
interface Check {
  id: string
  checkedAt: string
  result: { outcome: 'SIMULATION_MATCH' | 'SIMULATION_MISMATCH'; reason: string }
}
interface Item {
  format: 'docx' | 'pdf'
  stored: boolean
  expectedRevision: number | null
  canSign: boolean
  receipt: { id: string; simulatedAt: string } | null
  checks: Check[]
  historyTruncated: boolean
}
const props = defineProps<{
  submissionId: string
  roundNumber: number
  reviewPortal?: 'user' | 'admin'
  disabled?: boolean
}>()
const apiBase = String(useRuntimeConfig().public.apiBase)
const result = ref<{ enabled: boolean; notice: string; documents: Item[] } | null>(null)
const busy = ref(false),
  failure = ref(''),
  message = ref(''),
  pending = ref<Item | null>(null),
  confirmed = ref(false)
const confirmation = ref<HTMLElement | null>(null)
const requests = new Map<string, string>()
let generation = 0
const name = (item: Item) => (item.format === 'pdf' ? 'PDF' : 'Word')
const signId = (item: Item) => `mock-sign-${props.submissionId}-${props.roundNumber}-${item.format}`
function reset() {
  generation++
  result.value = null
  busy.value = false
  failure.value = ''
  message.value = ''
  pending.value = null
  confirmed.value = false
  requests.clear()
}
watch(
  () => [props.submissionId, props.roundNumber, props.reviewPortal],
  () => {
    reset()
    void load()
  },
)
onBeforeUnmount(() => generation++)
onMounted(() => void load())
async function load() {
  if (busy.value || props.disabled) return
  const current = generation
  busy.value = true
  failure.value = ''
  result.value = null
  pending.value = null
  confirmed.value = false
  try {
    const response = await fetch(
      submissionDocumentStatusUrl(
        apiBase,
        props.reviewPortal,
        props.submissionId,
        props.roundNumber,
      ).replace(/document-status$/, 'mock-signatures'),
      { credentials: 'include', cache: 'no-store' },
    )
    const body = await response.json()
    if (current !== generation) return
    if (!response.ok) throw new Error(body.message ?? 'Chưa tải được kết quả mô phỏng.')
    result.value = body
  } catch (error) {
    if (current === generation)
      failure.value = error instanceof Error ? error.message : 'Chưa kết nối được. Hãy tải lại.'
  } finally {
    if (current === generation) busy.value = false
  }
}
async function review(item: Item) {
  if (!item.canSign || busy.value || props.disabled) return
  pending.value = item
  confirmed.value = false
  await nextTick()
  confirmation.value?.focus()
}
async function cancel() {
  const item = pending.value
  pending.value = null
  confirmed.value = false
  await nextTick()
  if (item) document.getElementById(signId(item))?.focus()
}
async function act(item: Item, action: 'mock-sign' | 'mock-verify') {
  if (busy.value || props.disabled) return
  if (
    action === 'mock-sign' &&
    (!item.canSign || !confirmed.value || pending.value?.format !== item.format)
  )
    return
  if (action === 'mock-verify' && !item.receipt) return
  const current = generation,
    key = [action, item.format, item.expectedRevision, item.receipt?.id ?? ''].join(':')
  let requestId = requests.get(key)
  if (!requestId) {
    requestId = crypto.randomUUID()
    requests.set(key, requestId)
  }
  busy.value = true
  failure.value = ''
  message.value = ''
  try {
    const response = await fetch(
      submissionDocumentUrl(
        apiBase,
        props.reviewPortal,
        props.submissionId,
        props.roundNumber,
        item.format,
      ) +
        '/' +
        action,
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          action === 'mock-sign'
            ? { requestId, expectedRevision: item.expectedRevision }
            : { requestId, receiptId: item.receipt!.id },
        ),
      },
    )
    const body = await response.json()
    if (current !== generation) return
    if (!response.ok) {
      if ([401, 403, 404, 409].includes(response.status)) {
        result.value = null
        pending.value = null
        confirmed.value = false
      }
      throw new Error(body.message ?? 'Chưa ghi nhận được thao tác mô phỏng.')
    }
    requests.delete(key)
    pending.value = null
    confirmed.value = false
    message.value =
      action === 'mock-sign'
        ? 'Đã ghi kết quả ký mô phỏng ' + name(item) + '. Tài liệu gốc được giữ nguyên.'
        : body.outcome === 'SIMULATION_MATCH'
          ? 'Đối chiếu ' + name(item) + ': khớp byte và kết quả mô phỏng. Chưa xác minh chữ ký số.'
          : 'Đối chiếu ' + name(item) + ': không khớp. Cần người phụ trách kiểm tra tài liệu.'
    busy.value = false
    await load()
  } catch (error) {
    if (current === generation)
      failure.value =
        error instanceof Error ? error.message : 'Chưa kết nối được. Hãy thử lại cùng yêu cầu.'
  } finally {
    if (current === generation) busy.value = false
  }
}
</script>
<template>
  <section
    class="mock-signature"
    :aria-label="'Ký mô phỏng lần gửi ' + roundNumber"
    :aria-busy="busy"
  >
    <h3>Ký và đối chiếu mô phỏng</h3>
    <p class="mock-signature__notice"><strong>DEMO – KHÔNG CÓ GIÁ TRỊ PHÁP LÝ</strong></p>
    <p>Đối chiếu này chưa xác minh chữ ký số và chưa cấp văn bản. Tài liệu gốc được giữ nguyên.</p>
    <BaseButton type="button" variant="secondary" :disabled="busy || disabled" @click="load">{{
      busy ? 'Đang kiểm tra mô phỏng...' : 'Tải lại kết quả mô phỏng'
    }}</BaseButton>
    <p v-if="result && !result.enabled">Mô phỏng chưa bật trong môi trường này.</p>
    <article v-for="item in result?.documents ?? []" :key="item.format">
      <h4>{{ name(item) }}</h4>
      <p v-if="!item.stored">
        Chưa có bản tài liệu cố định. Chọn tải {{ name(item) }} rồi kiểm tra lại tình trạng tài
        liệu.
      </p>
      <p v-else-if="!item.receipt && !item.canSign">
        Chưa có kết quả mô phỏng. Chỉ cán bộ được phân công và cấp quyền riêng được thao tác sau khi
        duyệt.
      </p>
      <p v-if="item.receipt">
        Đã ghi ký mô phỏng · {{ new Date(item.receipt.simulatedAt).toLocaleString('vi-VN') }}
      </p>
      <BaseButton
        v-if="item.canSign"
        :id="signId(item)"
        type="button"
        :disabled="busy || disabled"
        @click="review(item)"
        >Xem lại ký mô phỏng {{ name(item) }}</BaseButton
      >
      <BaseButton
        v-if="item.receipt"
        type="button"
        variant="secondary"
        :disabled="busy || disabled"
        @click="act(item, 'mock-verify')"
        >Đối chiếu mô phỏng {{ name(item) }}</BaseButton
      >
      <ul v-if="item.checks.length" :aria-label="'Lịch sử đối chiếu ' + name(item)">
        <li v-for="check in item.checks" :key="check.id">
          {{ new Date(check.checkedAt).toLocaleString('vi-VN') }} ·
          {{
            check.result.outcome === 'SIMULATION_MATCH'
              ? 'Khớp byte và kết quả mô phỏng'
              : 'Không khớp, cần kiểm tra tài liệu'
          }}
        </li>
      </ul>
      <p v-if="item.historyTruncated">Đang hiển thị 100 lần đối chiếu gần nhất.</p>
    </article>
    <div
      v-if="pending"
      ref="confirmation"
      class="mock-signature__confirmation"
      tabindex="-1"
      role="group"
      aria-label="Xem lại ký mô phỏng"
    >
      <h4>Xem lại ký mô phỏng {{ name(pending) }}</h4>
      <p>
        Ghi kết quả mô phỏng cho {{ name(pending) }} của lần gửi {{ roundNumber }}. Thao tác được
        lưu vào lịch sử.
      </p>
      <label
        ><input v-model="confirmed" type="checkbox" :disabled="busy || disabled" /> Tôi xác nhận chỉ
        ký mô phỏng, không có giá trị pháp lý.</label
      >
      <div class="mock-signature__actions">
        <BaseButton
          type="button"
          :disabled="busy || disabled || !confirmed"
          @click="act(pending, 'mock-sign')"
          >Xác nhận ký mô phỏng {{ name(pending) }}</BaseButton
        ><BaseButton type="button" variant="secondary" :disabled="busy || disabled" @click="cancel"
          >Hủy</BaseButton
        >
      </div>
    </div>
    <p v-if="busy" role="status">Đang kiểm tra hoặc ghi kết quả mô phỏng.</p>
    <p v-if="failure" role="alert">{{ failure }}</p>
    <p v-if="message" role="status">{{ message }}</p>
  </section>
</template>
<style scoped>
.mock-signature {
  margin-top: 20px;
  border-top: 1px solid var(--color-border);
  padding-top: 20px;
  min-width: 0;
  overflow-wrap: anywhere;
  line-height: 1.65;
}
.mock-signature p {
  margin: 10px 0;
}
.mock-signature article {
  padding: 16px 0;
  border-bottom: 1px solid var(--color-border);
}
.mock-signature__notice {
  color: var(--color-warning-text, #854d0e);
}
.mock-signature__confirmation {
  margin-top: 16px;
  padding: 16px;
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}
.mock-signature__confirmation:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 3px;
}
.mock-signature label {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}
.mock-signature input {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  margin-top: 4px;
  accent-color: var(--color-primary);
}
.mock-signature__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 16px;
}
.mock-signature [role='alert'] {
  color: var(--color-error);
}
</style>
