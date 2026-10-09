<script setup lang="ts">
import type { DraftValues, StudentDraft } from '~/types/submission'
import type { ProcedureApiError, ProcedureField, ProcedureIssue } from '~/types/procedure'
const props = defineProps<{ initialDraft: StudentDraft }>()
const api = useSubmissions()
const draft = ref<StudentDraft>(structuredClone(toRaw(props.initialDraft)))
const answers = ref<DraftValues>({})
const savedAnswers = ref('')
const busy = ref(false)
const message = ref('')
const failure = ref<ProcedureApiError | null>(null)
const reviewed = ref(false)
const summary = ref<HTMLElement | null>(null)
const errorSummary = ref<HTMLElement | null>(null)
function initialize(view: StudentDraft) {
  draft.value = view
  answers.value = Object.fromEntries(
    view.procedure.fields
      .filter((f) => f.source === 'STUDENT_INPUT')
      .map((f) => [f.key, view.values[f.key] ?? null]),
  )
  savedAnswers.value = JSON.stringify(answers.value)
}
initialize(draft.value)
const dirty = computed(() => JSON.stringify(answers.value) !== savedAnswers.value)
const values = computed(() => ({ ...draft.value.values, ...answers.value }))
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
function fieldIssue(key: string) {
  return (
    failure.value?.issues.find((i) => i.path === 'values.' + key)?.message ??
    (reviewed.value ? incomplete.value.find((i) => i.path === 'values.' + key)?.message : undefined)
  )
}
function inputValue(field: ProcedureField, event: Event) {
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
  const value = values.value[field.key]
  if (value === null || value === undefined || value === '') return 'Chưa điền'
  if (field.type === 'BOOLEAN') return value ? 'Có' : 'Không'
  if (field.type === 'DATE') return String(value).split('-').reverse().join('/')
  if (field.type === 'SELECT')
    return field.options.find((o) => o.value === value)?.label ?? String(value)
  return String(value)
}
function fail(e: unknown) {
  failure.value = e as ProcedureApiError
  void nextTick(() => errorSummary.value?.focus())
}
async function save() {
  busy.value = true
  failure.value = null
  try {
    initialize(await api.save(draft.value.id, draft.value.revision, { ...answers.value }))
    message.value = 'Đã lưu bản nháp. Hồ sơ chưa được gửi.'
  } catch (e) {
    fail(e)
  } finally {
    busy.value = false
  }
}
async function reloadKeepingInput() {
  busy.value = true
  try {
    draft.value = await api.get(draft.value.id)
    savedAnswers.value = JSON.stringify(
      Object.fromEntries(
        draft.value.procedure.fields
          .filter((f) => f.source === 'STUDENT_INPUT')
          .map((f) => [f.key, draft.value.values[f.key] ?? null]),
      ),
    )
    failure.value = null
    message.value =
      'Đã tải bản lưu mới và giữ nội dung bạn đang nhập. Hãy đối chiếu phần xem lại trước khi lưu.'
  } catch (e) {
    fail(e)
  } finally {
    busy.value = false
  }
}
async function upload(key: string, event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const requirement = draft.value.procedure.attachments.find((a) => a.key === key)!
  if (
    !requirement.mimeTypes.some((type) => type === file.type) ||
    file.size > requirement.maxBytes ||
    file.size === 0 ||
    draft.value.files.reduce((total, stored) => total + stored.size, 0) + file.size >
      draft.value.procedure.maxTotalAttachmentBytes
  ) {
    fail({ message: 'Tệp không đúng định dạng hoặc dung lượng cho phép.', issues: [] })
    input.value = ''
    return
  }
  busy.value = true
  failure.value = null
  try {
    initialize(await api.upload(draft.value.id, draft.value.revision, key, file))
    message.value = 'Đã lưu minh chứng. Chữ ký chưa được xác minh.'
  } catch (e) {
    fail(e)
  } finally {
    busy.value = false
    input.value = ''
  }
}
async function remove(fileId: string) {
  busy.value = true
  failure.value = null
  try {
    initialize(await api.remove(draft.value.id, draft.value.revision, fileId))
    message.value = 'Đã gỡ minh chứng khỏi bản nháp.'
  } catch (e) {
    fail(e)
  } finally {
    busy.value = false
  }
}
function review() {
  reviewed.value = true
  void nextTick(() => summary.value?.focus())
}
function beforeUnload(event: BeforeUnloadEvent) {
  if (dirty.value) {
    event.preventDefault()
    event.returnValue = ''
  }
}
onMounted(() => window.addEventListener('beforeunload', beforeUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload))
onBeforeRouteLeave(
  () =>
    !dirty.value || window.confirm('Bạn có thông tin chưa lưu. Rời trang và bỏ các thay đổi này?'),
)
</script>
<template>
  <div class="draft-editor">
    <header class="draft-heading">
      <div>
        <p class="page-eyebrow">Kê khai thủ tục · Biểu mẫu v{{ draft.procedure.versionNumber }}</p>
        <h1 class="page-title">{{ draft.serviceName }}</h1>
      </div>
      <span class="draft-badge">Bản nháp · Chưa gửi</span>
    </header>
    <p class="draft-notice">
      Bản nháp chưa được chuyển đến đơn vị xử lý. Bạn có thể lưu dù chưa điền đủ thông tin. Chức
      năng gửi hồ sơ hiện chưa được mở.
    </p>
    <p v-if="!draft.editable" class="draft-warning" role="alert">
      {{ draft.readOnlyReason }}
      <NuxtLink :to="'/services/' + draft.serviceId">Xem hướng dẫn hiện hành</NuxtLink>
    </p>
    <div v-if="failure" ref="errorSummary" class="draft-error" role="alert" tabindex="-1">
      <strong>{{ failure.message }}</strong>
      <ul v-if="failure.issues?.length">
        <li v-for="issue in failure.issues" :key="issue.path">
          <a :href="'#field-' + issue.path.split('.').at(-1)">{{ issue.message }}</a>
        </li>
      </ul>
      <BaseButton
        v-if="failure.status === 409 || failure.status === 503"
        variant="secondary"
        :loading="busy"
        @click="reloadKeepingInput"
        >Tải bản lưu mới, giữ nội dung đang nhập</BaseButton
      >
      <NuxtLink v-if="failure.status === 401" to="/login">Đăng nhập lại</NuxtLink>
    </div>
    <p v-if="message" class="draft-success" role="status">{{ message }}</p>
    <div class="draft-columns">
      <form class="draft-panel" novalidate @submit.prevent="save">
        <h2>Thông tin kê khai</h2>
        <p class="draft-help">
          Đơn vị xử lý: {{ draft.procedure.processingUnitName }}. Trường có * là thông tin bắt buộc
          của thủ tục; bản nháp được phép để trống.
        </p>
        <p v-if="draft.procedure.processingMode === 'HYBRID'" class="draft-warning">
          Thủ tục kết hợp trực tuyến và trực tiếp. Thực hiện thêm theo hướng dẫn của đơn vị.
        </p>
        <p class="draft-contact">{{ draft.procedure.contactInstructions }}</p>
        <fieldset :disabled="busy || !draft.editable" class="draft-fields">
          <div v-for="field in draft.procedure.fields" :key="field.key" class="draft-field">
            <label :for="'field-' + field.key"
              >{{ field.label }}<span v-if="field.required"> *</span></label
            >
            <input
              v-if="field.source === 'PROFILE'"
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
            <small v-if="field.source === 'PROFILE'" :id="'hint-' + field.key" class="draft-help"
              >Lấy từ hồ sơ sinh viên. Liên hệ CTSV nếu thông tin chưa đúng.</small
            >
            <small
              v-if="fieldIssue(field.key)"
              :id="'error-' + field.key"
              class="draft-field-error"
              >{{ fieldIssue(field.key) }}</small
            >
          </div>
        </fieldset>
        <div class="draft-actions">
          <BaseButton type="submit" :loading="busy" :disabled="!draft.editable"
            >Lưu bản nháp</BaseButton
          ><BaseButton type="button" variant="secondary" @click="review"
            >Xem lại thông tin</BaseButton
          >
        </div>
        <p class="draft-help" role="status">
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
          class="draft-attachment"
        >
          <label :for="'attachment-' + attachment.key"
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
          <div class="draft-upload">
            <input
              :id="'attachment-' + attachment.key"
              type="file"
              :accept="attachment.mimeTypes.join(',')"
              :disabled="
                busy ||
                dirty ||
                !draft.editable ||
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
                type="button"
                variant="secondary"
                :disabled="busy || dirty || !draft.editable"
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
          {{ dirty ? 'Nội dung đang nhập, có thay đổi chưa lưu.' : 'Nội dung bản nháp đã lưu.' }}
        </p>
        <dl>
          <div v-for="field in draft.procedure.fields" :key="field.key">
            <dt>{{ field.label }}</dt>
            <dd>{{ display(field) }}</dd>
          </div>
        </dl>
        <h3>Thông tin cần bổ sung</h3>
        <ul v-if="incomplete.length">
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
        <p v-else>Đã điền các mục bắt buộc trong biểu mẫu. Hồ sơ vẫn chưa được gửi.</p>
        <p class="draft-warning">
          Hình dấu đỏ hoặc chữ ký trên tệp không phải kết quả xác minh chữ ký số.
        </p>
      </aside>
    </div>
  </div>
</template>
<style scoped>
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
