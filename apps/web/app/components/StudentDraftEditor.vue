<script setup lang="ts">
import type { DraftValues, StudentDraft } from '~/types/submission'
import type { ProcedureApiError, ProcedureField, ProcedureIssue } from '~/types/procedure'
import {
  formatSubmissionAnswer,
  formatSubmissionTime,
  submissionIssueAnchor,
  submissionStatusLabels,
} from '~/utils/submission'
const props = defineProps<{ initialDraft: StudentDraft }>()
const api = useSubmissions()
const draft = ref<StudentDraft>(structuredClone(toRaw(props.initialDraft)))
const answers = ref<DraftValues>({})
const savedAnswers = ref('')
const busy = ref(false)
const message = ref('')
const failure = ref<ProcedureApiError | null>(null)
const reviewed = ref(false)
const confirmed = ref(false)
const reloadRequired = ref(false)
const uncertainSubmit = ref(false)
const localUnsavedAnswers = ref<DraftValues | null>(null)
let viewGeneration = 0
const summary = ref<HTMLElement | null>(null)
const errorSummary = ref<HTMLElement | null>(null)
function studentAnswers(view: StudentDraft) {
  return Object.fromEntries(
    view.procedure.fields
      .filter((f) => f.source === 'STUDENT_INPUT')
      .map((f) => [f.key, view.values[f.key] ?? null]),
  )
}
function resetConfirmation() {
  reviewed.value = false
  confirmed.value = false
}
function initialize(view: StudentDraft) {
  draft.value = view
  answers.value = studentAnswers(view)
  savedAnswers.value = JSON.stringify(answers.value)
  resetConfirmation()
}
initialize(draft.value)
watch(answers, resetConfirmation, { deep: true, flush: 'sync' })
const supplementing = computed(() => draft.value.status === 'NEEDS_SUPPLEMENT')
const submitted = computed(() => draft.value.status !== 'DRAFT' && !supplementing.value)
const latestResolution = computed(() =>
  [...draft.value.events]
    .reverse()
    .find((event) => ['SUPPLEMENT_REQUESTED', 'APPROVED', 'REJECTED'].includes(event.action)),
)
const canEdit = computed(() => !submitted.value && draft.value.editable && !reloadRequired.value)
const dirty = computed(
  () => !submitted.value && JSON.stringify(answers.value) !== savedAnswers.value,
)
const values = computed(() =>
  submitted.value ? draft.value.values : { ...draft.value.values, ...answers.value },
)
const incomplete = computed<ProcedureIssue[]>(() => [
  ...draft.value.procedure.fields
    .filter(
      (f) =>
        f.required &&
        (values.value[f.key] === null ||
          values.value[f.key] === undefined ||
          (typeof values.value[f.key] === 'string' && !String(values.value[f.key]).trim())),
    )
    .map((f) => ({
      path: 'values.' + f.key,
      message: 'Cần bổ sung ' + f.label.toLowerCase() + '.',
    })),
  ...draft.value.procedure.attachments
    .filter((a) => a.required && !draft.value.files.some((f) => f.attachmentKey === a.key))
    .map((a) => ({
      path: 'attachments.' + a.key,
      message: 'Cần bổ sung ' + a.label.toLowerCase() + '.',
    })),
])
const canSubmit = computed(
  () =>
    canEdit.value &&
    !busy.value &&
    !dirty.value &&
    !incomplete.value.length &&
    reviewed.value &&
    confirmed.value,
)
function issueFor(path: string) {
  return (
    failure.value?.issues.find((i) => i.path === path)?.message ??
    (reviewed.value ? incomplete.value.find((i) => i.path === path)?.message : undefined)
  )
}
function fieldIssue(key: string) {
  return issueFor('values.' + key)
}
function inputValue(field: ProcedureField, event: Event) {
  if (!canEdit.value || busy.value) return
  const value = (event.target as HTMLInputElement).value
  answers.value[field.key] =
    value === ''
      ? null
      : field.type === 'NUMBER'
        ? Number(value)
        : field.type === 'BOOLEAN'
          ? value === 'true'
          : value
  failure.value = null
  message.value = ''
}
function display(field: ProcedureField) {
  return formatSubmissionAnswer(field, values.value)
}
function fail(e: unknown) {
  failure.value = e as ProcedureApiError
  if (failure.value.status === 409) reloadRequired.value = true
  void nextTick(() => errorSummary.value?.focus())
}
async function save() {
  if (!canEdit.value || busy.value) return
  const generation = viewGeneration
  busy.value = true
  failure.value = null
  resetConfirmation()
  try {
    const current = await api.save(draft.value.id, draft.value.revision, { ...answers.value })
    if (generation !== viewGeneration) return
    initialize(current)
    message.value = supplementing.value
      ? 'Đã lưu bổ sung. Nội dung mới chưa được gửi đến cán bộ.'
      : 'Đã lưu bản nháp. Hồ sơ chưa được gửi.'
  } catch (e) {
    if (generation !== viewGeneration) return
    fail(e)
  } finally {
    if (generation === viewGeneration) busy.value = false
  }
}
async function submit() {
  if (!canSubmit.value) return
  const generation = viewGeneration
  busy.value = true
  failure.value = null
  message.value = ''
  confirmed.value = false
  try {
    const wasSupplementing = supplementing.value
    const current = await api.submit(draft.value.id, draft.value.revision)
    if (generation !== viewGeneration) return
    initialize(current)
    message.value = wasSupplementing
      ? 'Đã gửi bổ sung đến cán bộ đang xử lý.'
      : 'Đã gửi hồ sơ đến đơn vị xử lý.'
    void nextTick(() => summary.value?.focus())
  } catch (e) {
    if (generation !== viewGeneration) return
    const error = e as ProcedureApiError
    if (!error.status || error.status >= 500) {
      uncertainSubmit.value = true
      reloadRequired.value = true
    }
    fail(e)
  } finally {
    if (generation === viewGeneration) busy.value = false
  }
}
async function reloadKeepingInput() {
  if (busy.value) return
  const generation = viewGeneration
  busy.value = true
  resetConfirmation()
  try {
    const local = { ...answers.value }
    const hadUnsavedInput = dirty.value
    const current = await api.get(draft.value.id)
    if (generation !== viewGeneration) return
    if (current.status === 'DRAFT' || current.status === 'NEEDS_SUPPLEMENT') {
      draft.value = current
      savedAnswers.value = JSON.stringify(studentAnswers(current))
      message.value =
        'Đã tải bản lưu mới và giữ nội dung bạn đang nhập. Hãy đối chiếu phần xem lại trước khi lưu.'
    } else {
      const authoritative = studentAnswers(current)
      if (hadUnsavedInput && JSON.stringify(local) !== JSON.stringify(authoritative))
        localUnsavedAnswers.value = local
      initialize(current)
      message.value = 'Hồ sơ đã được gửi. Nội dung bên dưới là bản đã gửi đến đơn vị xử lý.'
    }
    failure.value = null
    reloadRequired.value = false
    uncertainSubmit.value = false
  } catch (e) {
    if (generation !== viewGeneration) return
    fail(e)
  } finally {
    if (generation === viewGeneration) busy.value = false
  }
}
async function upload(key: string, event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || busy.value || dirty.value || !canEdit.value) return
  resetConfirmation()
  const requirement = draft.value.procedure.attachments.find((a) => a.key === key)!
  if (
    !requirement.mimeTypes.some((type) => type === file.type) ||
    file.size > requirement.maxBytes ||
    file.size === 0 ||
    draft.value.files.filter((f) => f.attachmentKey === key).length >= requirement.maxFiles ||
    draft.value.files.reduce((total, stored) => total + stored.size, 0) + file.size >
      draft.value.procedure.maxTotalAttachmentBytes
  ) {
    fail({
      message: 'Tệp không đúng định dạng hoặc dung lượng cho phép.',
      issues: [
        { path: 'attachments.' + key, message: 'Kiểm tra định dạng, số lượng và dung lượng tệp.' },
      ],
    })
    input.value = ''
    return
  }
  const generation = viewGeneration
  busy.value = true
  failure.value = null
  try {
    const current = await api.upload(draft.value.id, draft.value.revision, key, file)
    if (generation !== viewGeneration) return
    initialize(current)
    message.value = 'Đã lưu minh chứng. Chữ ký chưa được xác minh.'
  } catch (e) {
    if (generation !== viewGeneration) return
    fail(e)
  } finally {
    if (generation === viewGeneration) busy.value = false
    input.value = ''
  }
}
async function remove(fileId: string) {
  if (busy.value || dirty.value || !canEdit.value) return
  const generation = viewGeneration
  busy.value = true
  failure.value = null
  resetConfirmation()
  try {
    const current = await api.remove(draft.value.id, draft.value.revision, fileId)
    if (generation !== viewGeneration) return
    initialize(current)
    message.value = supplementing.value
      ? 'Đã gỡ khỏi bản bổ sung. Minh chứng trong các lần gửi trước vẫn được giữ.'
      : 'Đã gỡ minh chứng khỏi bản nháp.'
  } catch (e) {
    if (generation !== viewGeneration) return
    fail(e)
  } finally {
    if (generation === viewGeneration) busy.value = false
  }
}
function review() {
  if (busy.value) return
  reviewed.value = true
  confirmed.value = false
  void nextTick(() => summary.value?.focus())
}
function beforeUnload(event: BeforeUnloadEvent) {
  if (dirty.value || localUnsavedAnswers.value) {
    event.preventDefault()
    event.returnValue = ''
  }
}
onMounted(() => window.addEventListener('beforeunload', beforeUnload))
onBeforeUnmount(() => {
  viewGeneration += 1
  window.removeEventListener('beforeunload', beforeUnload)
})
watch(
  () => props.initialDraft,
  (current) => {
    viewGeneration += 1
    busy.value = false
    failure.value = null
    message.value = ''
    reloadRequired.value = false
    uncertainSubmit.value = false
    localUnsavedAnswers.value = null
    initialize(structuredClone(toRaw(current)))
  },
)
onBeforeRouteLeave(
  () =>
    (!dirty.value && !localUnsavedAnswers.value) ||
    window.confirm('Bạn có thông tin chưa lưu. Rời trang và bỏ các thay đổi này?'),
)
</script>
<template>
  <div class="draft-editor">
    <header class="draft-heading">
      <div>
        <p class="page-eyebrow">Kê khai thủ tục · Biểu mẫu v{{ draft.procedure.versionNumber }}</p>
        <h1 class="page-title">{{ draft.serviceName }}</h1>
      </div>
      <span class="draft-badge" role="status">{{ submissionStatusLabels[draft.status] }}</span>
    </header>
    <p v-if="draft.status === 'DRAFT'" class="draft-notice">
      Bản nháp chưa được chuyển đến đơn vị xử lý. Lưu thông tin, xem lại và xác nhận trước khi gửi
      hồ sơ.
    </p>
    <div v-else-if="supplementing" class="draft-warning" role="status">
      <strong>Hồ sơ cần bổ sung</strong>
      <p v-if="latestResolution?.note" class="draft-reason">{{ latestResolution.note }}</p>
      <p>
        Sửa thông tin, tải hoặc gỡ minh chứng rồi xem lại và gửi bổ sung. Cán bộ chỉ thấy bản đã gửi
        lần {{ draft.roundNumber }}; nội dung bạn đang sửa chưa được chuyển đến cán bộ.
      </p>
    </div>
    <div v-else class="draft-notice">
      <p>Thông tin và minh chứng của lần gửi gần nhất được giữ nguyên.</p>
      <p>Quyết định nội dung trong ứng dụng chưa phải là cấp văn bản hoặc xác minh chữ ký số.</p>
      <p
        v-if="
          (draft.status === 'APPROVED' || draft.status === 'REJECTED') && latestResolution?.note
        "
        class="draft-reason"
      >
        <strong>Lý do xử lý:</strong> {{ latestResolution.note }}
      </p>
      <p>
        Đã gửi lần đầu:
        <time :datetime="draft.submittedAt ?? undefined">{{
          formatSubmissionTime(draft.submittedAt)
        }}</time>
      </p>
      <p v-if="draft.lastSubmittedAt">
        Lần gửi {{ draft.roundNumber }} gần nhất:
        <time :datetime="draft.lastSubmittedAt">{{
          formatSubmissionTime(draft.lastSubmittedAt)
        }}</time>
      </p>
      <p v-if="draft.decisionAt">
        Quyết định nội dung:
        <time :datetime="draft.decisionAt">{{ formatSubmissionTime(draft.decisionAt) }}</time>
      </p>
      <p v-if="draft.reviewStartedAt">
        Bắt đầu xử lý:
        <time :datetime="draft.reviewStartedAt">{{
          formatSubmissionTime(draft.reviewStartedAt)
        }}</time>
      </p>
    </div>
    <SubmissionDocumentDownloads
      v-if="draft.rounds.length"
      :submission-id="draft.id"
      :round-number="draft.roundNumber"
    />
    <p v-if="!draft.editable && !submitted" class="draft-warning" role="alert">
      {{ draft.readOnlyReason }}
      <NuxtLink :to="'/services/' + draft.serviceId">Xem hướng dẫn hiện hành</NuxtLink>
    </p>
    <div v-if="failure" ref="errorSummary" class="draft-error" role="alert" tabindex="-1">
      <strong>{{ failure.message }}</strong>
      <ul v-if="failure.issues?.length">
        <li v-for="issue in failure.issues" :key="issue.path">
          <a :href="submissionIssueAnchor(issue.path)">{{ issue.message }}</a>
        </li>
      </ul>
      <BaseButton
        v-if="reloadRequired || failure.status === 503"
        variant="secondary"
        :loading="busy"
        @click="reloadKeepingInput"
        >{{
          uncertainSubmit ? 'Kiểm tra trạng thái hồ sơ' : 'Tải bản lưu mới, giữ nội dung đang nhập'
        }}</BaseButton
      >
      <p v-if="uncertainSubmit">
        Chưa xác định được hồ sơ đã gửi hay chưa. Kiểm tra trạng thái trước khi gửi lại hoặc chỉnh
        sửa.
      </p>
      <small v-if="failure.requestId">Mã hỗ trợ: {{ failure.requestId }}</small>
      <NuxtLink v-if="failure.status === 401" to="/login">Đăng nhập lại</NuxtLink>
    </div>
    <details v-if="localUnsavedAnswers" class="draft-warning draft-local-copy">
      <summary>Nội dung bạn nhập chưa nằm trong hồ sơ đã gửi</summary>
      <p>
        Giữ lại tại trang này để bạn đối chiếu hoặc sao chép. Nội dung này chưa được lưu và chưa
        chuyển đến đơn vị xử lý.
      </p>
      <dl>
        <div
          v-for="field in draft.procedure.fields.filter((f) => f.source === 'STUDENT_INPUT')"
          :key="field.key"
        >
          <dt>{{ field.label }}</dt>
          <dd>{{ formatSubmissionAnswer(field, localUnsavedAnswers) }}</dd>
        </div>
      </dl>
    </details>
    <p v-if="message" class="draft-success" role="status">{{ message }}</p>
    <div class="draft-columns">
      <form class="draft-panel" novalidate @submit.prevent="save">
        <h2>{{ submitted ? 'Thông tin đã gửi' : 'Thông tin kê khai' }}</h2>
        <p class="draft-help">
          Đơn vị xử lý: {{ draft.procedure.processingUnitName }}. Trường có * là thông tin bắt buộc
          của thủ tục<span v-if="!submitted">; bản nháp được phép để trống</span>.
        </p>
        <p v-if="draft.procedure.processingMode === 'HYBRID'" class="draft-warning">
          Thủ tục kết hợp trực tuyến và trực tiếp. Thực hiện thêm theo hướng dẫn của đơn vị.
        </p>
        <p class="draft-contact">{{ draft.procedure.contactInstructions }}</p>
        <fieldset :disabled="busy || !canEdit" class="draft-fields">
          <div v-for="field in draft.procedure.fields" :key="field.key" class="draft-field">
            <label :for="'field-' + field.key"
              >{{ field.label }}<span v-if="field.required"> *</span></label
            >
            <p v-if="submitted" :id="'field-' + field.key" class="draft-readonly">
              {{ display(field) }}
            </p>
            <input
              v-else-if="field.source === 'PROFILE'"
              :id="'field-' + field.key"
              :value="draft.values[field.key] ?? ''"
              readonly
              class="draft-profile"
              :aria-describedby="'hint-' + field.key"
            />
            <textarea
              v-else-if="field.type === 'TEXTAREA'"
              :id="'field-' + field.key"
              :value="answers[field.key] ?? ''"
              :maxlength="field.maxLength"
              rows="4"
              :aria-invalid="Boolean(fieldIssue(field.key))"
              :aria-describedby="fieldIssue(field.key) ? 'error-' + field.key : undefined"
              @input="inputValue(field, $event)"
            />
            <select
              v-else-if="field.type === 'SELECT' || field.type === 'BOOLEAN'"
              :id="'field-' + field.key"
              :value="answers[field.key] === null ? '' : String(answers[field.key])"
              :aria-invalid="Boolean(fieldIssue(field.key))"
              :aria-describedby="fieldIssue(field.key) ? 'error-' + field.key : undefined"
              @change="inputValue(field, $event)"
            >
              <option value="">Chưa chọn</option>
              <template v-if="field.type === 'BOOLEAN'"
                ><option value="true">Có</option>
                <option value="false">Không</option></template
              >
              <template v-else
                ><option v-for="option in field.options" :key="option.value" :value="option.value">
                  {{ option.label }}
                </option></template
              >
            </select>
            <input
              v-else
              :id="'field-' + field.key"
              :type="field.type === 'NUMBER' ? 'number' : field.type === 'DATE' ? 'date' : 'text'"
              :value="answers[field.key] ?? ''"
              :maxlength="field.maxLength"
              :step="field.type === 'NUMBER' ? 'any' : undefined"
              :aria-invalid="Boolean(fieldIssue(field.key))"
              :aria-describedby="fieldIssue(field.key) ? 'error-' + field.key : undefined"
              @input="inputValue(field, $event)"
            />
            <small v-if="field.source === 'PROFILE'" :id="'hint-' + field.key" class="draft-help">{{
              submitted
                ? 'Thông tin được chốt khi gửi hồ sơ.'
                : 'Lấy từ hồ sơ sinh viên. Liên hệ CTSV nếu thông tin chưa đúng.'
            }}</small>
            <small
              v-if="fieldIssue(field.key)"
              :id="'error-' + field.key"
              class="draft-field-error"
              >{{ fieldIssue(field.key) }}</small
            >
          </div>
        </fieldset>
        <div v-if="!submitted" class="draft-actions">
          <BaseButton type="submit" :loading="busy" :disabled="!canEdit">{{
            supplementing ? 'Lưu bổ sung' : 'Lưu bản nháp'
          }}</BaseButton
          ><BaseButton type="button" variant="secondary" :disabled="busy" @click="review"
            >Xem lại thông tin</BaseButton
          >
        </div>
        <p v-if="!submitted" class="draft-help" role="status">
          {{ dirty ? 'Có thay đổi chưa lưu.' : 'Thông tin đang hiển thị đã được lưu.' }} Bản lưu lần
          {{ draft.revision }}.
        </p>
        <h2>Minh chứng</h2>
        <p v-if="!draft.procedure.attachments.length" class="draft-help">
          Biểu mẫu này không yêu cầu tệp minh chứng.
        </p>
        <p v-else class="draft-help">
          Tổng tệp tối đa {{ (draft.procedure.maxTotalAttachmentBytes / 1048576).toFixed(1) }} MiB.
          Tệp được lưu riêng cho hồ sơ của bạn.
        </p>
        <p v-if="dirty && draft.procedure.attachments.length" class="draft-warning">
          Lưu thông tin trước khi tải hoặc gỡ minh chứng.
        </p>
        <div
          v-for="attachment in draft.procedure.attachments"
          :key="attachment.key"
          :id="'attachment-' + attachment.key"
          class="draft-attachment"
          tabindex="-1"
        >
          <label :for="!submitted ? 'upload-' + attachment.key : undefined"
            >{{ attachment.label }}{{ attachment.required ? ' *' : '' }}</label
          >
          <p class="draft-help">
            {{
              attachment.mimeTypes
                .map((m) => (m === 'application/pdf' ? 'PDF' : m === 'image/png' ? 'PNG' : 'JPEG'))
                .join(', ')
            }}
            · Tối đa {{ attachment.maxFiles }} tệp ·
            {{ (attachment.maxBytes / 1048576).toFixed(1) }} MiB/tệp
          </p>
          <p
            v-if="issueFor('attachments.' + attachment.key)"
            :id="'error-attachment-' + attachment.key"
            class="draft-field-error"
          >
            {{ issueFor('attachments.' + attachment.key) }}
          </p>
          <div v-if="!submitted" class="draft-upload">
            <input
              :id="'upload-' + attachment.key"
              type="file"
              :aria-invalid="Boolean(issueFor('attachments.' + attachment.key))"
              :aria-describedby="
                issueFor('attachments.' + attachment.key)
                  ? 'error-attachment-' + attachment.key
                  : undefined
              "
              :accept="attachment.mimeTypes.join(',')"
              :disabled="
                busy ||
                dirty ||
                !canEdit ||
                draft.files.filter((f) => f.attachmentKey === attachment.key).length >=
                  attachment.maxFiles
              "
              @change="upload(attachment.key, $event)"
            />
            <span aria-hidden="true">Chọn tệp minh chứng</span>
          </div>
          <ul class="draft-file-list">
            <li
              v-for="file in draft.files.filter((f) => f.attachmentKey === attachment.key)"
              :key="file.id"
            >
              <a :href="api.downloadUrl(draft.id, file.id)">{{ file.name }}</a>
              <small>{{ (file.size / 1024).toFixed(1) }} KiB · Chữ ký chưa được xác minh</small>
              <BaseButton
                v-if="!submitted"
                type="button"
                variant="secondary"
                :disabled="busy || dirty || !canEdit"
                :aria-label="'Gỡ minh chứng ' + file.name"
                @click="remove(file.id)"
                >Gỡ</BaseButton
              >
            </li>
          </ul>
        </div>
      </form>
      <aside
        ref="summary"
        tabindex="-1"
        class="draft-panel draft-review"
        aria-label="Xem lại thông tin"
      >
        <h2>Xem lại thông tin</h2>
        <p class="draft-help">
          {{
            submitted
              ? 'Nội dung hồ sơ đã gửi.'
              : dirty
                ? 'Nội dung đang nhập, có thay đổi chưa lưu.'
                : supplementing
                  ? 'Nội dung bổ sung đã lưu, chưa gửi đến cán bộ.'
                  : 'Nội dung bản nháp đã lưu.'
          }}
        </p>
        <dl>
          <div v-for="field in draft.procedure.fields" :key="field.key">
            <dt>{{ field.label }}</dt>
            <dd>{{ display(field) }}</dd>
          </div>
        </dl>
        <h3 v-if="!submitted">Thông tin cần bổ sung</h3>
        <ul v-if="!submitted && incomplete.length">
          <li v-for="issue in incomplete" :key="issue.path">
            <a
              :href="
                issue.path.startsWith('values.')
                  ? '#field-' + issue.path.split('.').at(-1)
                  : '#attachment-' + issue.path.split('.').at(-1)
              "
              >{{ issue.message }}</a
            >
          </li>
        </ul>
        <p v-else-if="!submitted">
          Đã điền các mục bắt buộc trong biểu mẫu.
          {{ supplementing ? 'Phần bổ sung vẫn chưa được gửi.' : 'Hồ sơ vẫn chưa được gửi.' }}
        </p>
        <div v-if="!submitted" class="draft-submit">
          <p v-if="dirty" class="draft-help">Lưu thay đổi trước khi xác nhận và gửi hồ sơ.</p>
          <p v-else-if="!reviewed" class="draft-help">
            Chọn “Xem lại thông tin” trước khi xác nhận.
          </p>
          <label class="draft-confirm" for="confirm-submission">
            <input
              id="confirm-submission"
              v-model="confirmed"
              type="checkbox"
              :disabled="!canEdit || busy || dirty || !reviewed || Boolean(incomplete.length)"
            />
            <span
              >Tôi đã xem lại và xác nhận thông tin đã lưu cùng các minh chứng là chính xác.</span
            >
          </label>
          <BaseButton type="button" :loading="busy" :disabled="!canSubmit" @click="submit">{{
            supplementing ? 'Gửi bổ sung' : 'Gửi hồ sơ'
          }}</BaseButton>
        </div>
        <p class="draft-warning">
          Hình dấu đỏ hoặc chữ ký trên tệp không phải kết quả xác minh chữ ký số.
        </p>
      </aside>
    </div>
    <SubmissionHistory
      :submission-id="draft.id"
      :rounds="draft.rounds"
      :events="draft.events"
      :procedure="draft.procedure"
      :download-url="(roundNumber, fileId) => api.roundDownloadUrl(draft.id, roundNumber, fileId)"
    />
  </div>
</template>
<style scoped>
.draft-editor > .submission-history {
  margin-top: 24px;
}
.draft-reason {
  white-space: pre-wrap;
}
.draft-readonly {
  margin: 0;
  white-space: pre-wrap;
}
.draft-submit {
  border-top: 1px solid var(--color-border);
  padding-top: 20px;
  margin-top: 24px;
}
.draft-confirm {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  min-height: 44px;
  margin: 16px 0;
  line-height: 1.65;
}
.draft-confirm input {
  flex: none;
  width: 20px;
  height: 20px;
  margin-top: 4px;
  accent-color: var(--color-primary);
}
.draft-local-copy summary {
  cursor: pointer;
  font-weight: 700;
  min-height: 44px;
}
.draft-local-copy dd {
  white-space: pre-wrap;
  margin: 8px 0 16px;
}
.draft-attachment {
  scroll-margin-top: 110px;
}
.draft-editor {
  overflow-wrap: anywhere;
}
.draft-heading > div {
  min-width: 0;
}
.draft-field input,
.draft-field select,
.draft-field textarea,
.draft-review {
  scroll-margin-top: 110px;
}
.draft-heading {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 20px;
}
.draft-badge {
  flex: none;
  padding: 8px 12px;
  border-radius: 999px;
  color: var(--color-primary);
  background: var(--color-primary-soft);
  font-weight: 700;
  font-size: 13px;
}
.draft-notice,
.draft-warning,
.draft-error,
.draft-success {
  padding: 16px;
  border-radius: var(--radius-sm);
  margin: 16px 0;
  line-height: 1.65;
}
.draft-notice {
  color: var(--color-info);
  background: var(--color-info-background);
}
.draft-warning {
  color: var(--color-warning);
  background: var(--color-warning-background);
}
.draft-error,
.draft-field-error {
  color: var(--color-error);
}
.draft-error {
  background: var(--color-error-background);
}
.draft-success {
  color: var(--color-success);
  background: var(--color-success-background);
}
.draft-columns {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
  gap: 24px;
  align-items: start;
}
.draft-panel {
  padding: 26px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  min-width: 0;
}
.draft-panel h2 {
  font-size: 21px;
  margin-bottom: 14px;
}
.draft-fields {
  margin: 22px 0;
  border: 0;
  padding: 0;
  min-width: 0;
}
.draft-field {
  display: grid;
  gap: 8px;
  margin-bottom: 20px;
}
.draft-field label,
.draft-attachment label {
  font-weight: 700;
}
.draft-field input,
.draft-field select,
.draft-field textarea {
  width: 100%;
  min-height: 44px;
  border: 1px solid var(--color-border-strong);
  border-radius: 8px;
  padding: 10px 12px;
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
}
.draft-field textarea {
  resize: vertical;
}
.draft-field [aria-invalid='true'] {
  border-color: var(--color-error);
}
.draft-field .draft-profile {
  background: var(--color-surface-subtle);
}
.draft-help {
  font-size: 13px;
  color: var(--color-muted);
  line-height: 1.65;
}
.draft-contact {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 14px;
  line-height: 1.7;
}
.draft-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.draft-attachment {
  margin-top: 20px;
  padding-top: 18px;
  border-top: 1px solid var(--color-border);
}
.draft-attachment input {
  max-width: 100%;
  font: inherit;
  min-height: 44px;
}
.draft-upload {
  position: relative;
  display: inline-flex;
  min-height: 44px;
}
.draft-upload input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}
.draft-upload span {
  padding: 11px 16px;
  border: 1px solid var(--color-border-strong);
  border-radius: 8px;
  color: var(--color-primary);
  font-weight: 700;
  pointer-events: none;
}
.draft-upload:focus-within {
  outline: 3px solid var(--color-primary);
  outline-offset: 3px;
  border-radius: 8px;
}
.draft-upload input:disabled {
  cursor: not-allowed;
}
.draft-upload input:disabled + span {
  opacity: 0.6;
}
.draft-file-list {
  list-style: none;
  padding: 0;
}
.draft-file-list li {
  display: grid;
  gap: 8px;
  margin-top: 14px;
  padding: 12px;
  border-radius: 8px;
  background: var(--color-surface-subtle);
}
.draft-file-list small {
  color: var(--color-warning);
}
.draft-file-list button {
  justify-self: start;
}
.draft-panel a {
  color: var(--color-primary);
  overflow-wrap: anywhere;
}
.draft-review dl {
  margin: 20px 0;
}
.draft-review dl div {
  padding: 12px 0;
  border-bottom: 1px solid var(--color-border);
}
.draft-review dt {
  color: var(--color-muted);
  font-size: 13px;
  margin-bottom: 6px;
}
.draft-review dd {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.draft-review li {
  margin: 10px 0;
  line-height: 1.65;
}
@media (max-width: 850px) {
  .draft-columns {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 540px) {
  .draft-heading {
    flex-direction: column;
    gap: 4px;
  }
  .draft-panel {
    padding: 18px;
  }
  .draft-actions {
    flex-direction: column;
  }
}
</style>
