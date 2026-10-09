<script setup lang="ts">
import { onBeforeRouteLeave } from 'vue-router'
import type {
  ProcedureApiError,
  ProcedureCatalog,
  ProcedureConfig,
  ProcedureIssue,
  ProcedureVersion,
} from '~/types/procedure'
definePageMeta({ layout: 'admin', middleware: 'admin-auth' })
const api = useProcedures()
const catalog = ref<ProcedureCatalog | null>(null)
const serviceId = ref('')
const ownerUnitId = ref('')
const versions = ref<ProcedureVersion[]>([])
const selected = ref<ProcedureVersion | null>(null)
const form = ref<ProcedureConfig | null>(null)
const busy = ref(false)
const message = ref('')
const errorMessage = ref('')
const issues = ref<ProcedureIssue[]>([])
const showPreview = ref(true)
const needsLogin = ref(false)
const dirty = computed(
  () => !!form.value && JSON.stringify(form.value) !== JSON.stringify(selected.value?.config),
)
const editable = computed(() => selected.value?.status === 'DRAFT')
const reviewers = computed(() =>
  (catalog.value?.reviewers ?? []).filter(
    (r) => r.unitId === null || r.unitId === form.value?.processingUnitId,
  ),
)
const unitName = computed(
  () => catalog.value?.units.find((unit) => unit.id === form.value?.processingUnitId)?.name ?? '',
)
const statuses = { DRAFT: 'Bản nháp', PUBLISHED: 'Đang áp dụng', RETIRED: 'Phiên bản cũ' }
function copy(config: ProcedureConfig): ProcedureConfig {
  return JSON.parse(JSON.stringify(config)) as ProcedureConfig
}
function select(version: ProcedureVersion | null) {
  selected.value = version
  form.value = version ? copy(version.config) : null
  issues.value = []
}
function report(error: unknown) {
  const parsed = error as ProcedureApiError
  errorMessage.value = parsed.message ?? 'Không thể thực hiện yêu cầu.'
  issues.value = parsed.issues ?? []
  needsLogin.value = parsed.status === 401
}
async function run(operation: () => Promise<void>) {
  if (busy.value) return
  busy.value = true
  message.value = ''
  errorMessage.value = ''
  issues.value = []
  try {
    await operation()
  } catch (error) {
    report(error)
  } finally {
    busy.value = false
  }
}
async function loadVersions(preferId?: string) {
  versions.value = await api.list(Number(serviceId.value))
  select(
    versions.value.find((v) => v.id === preferId) ??
      versions.value.find((v) => v.status === 'DRAFT') ??
      versions.value[0] ??
      null,
  )
}
async function changeService() {
  await run(() => loadVersions())
}
function changeVersion(event: Event) {
  select(versions.value.find((v) => v.id === (event.target as HTMLSelectElement).value) ?? null)
}
async function createDraft() {
  await run(async () => {
    const cloned = selected.value
    const created = await api.create(
      Number(serviceId.value),
      cloned?.ownerUnitId ?? ownerUnitId.value,
      cloned?.id ?? null,
    )
    await loadVersions(created.id)
    message.value = 'Đã tạo bản nháp. Bạn có thể chỉnh biểu mẫu và nơi xử lý.'
  })
}
async function save() {
  if (!selected.value || !form.value) return
  const id = selected.value.id,
    revision = selected.value.revision,
    config = copy(form.value)
  await run(async () => {
    const updated = await api.update(id, revision, config)
    await loadVersions(updated.id)
    message.value = 'Đã lưu bản nháp.'
  })
}
async function publish() {
  if (!selected.value || dirty.value) return
  const id = selected.value.id,
    revision = selected.value.revision
  await run(async () => {
    const result = await api.validate(id)
    if (!result.valid) {
      issues.value = result.issues
      errorMessage.value = 'Cần sửa các mục bên dưới trước khi áp dụng.'
      return
    }
    const published = await api.publish(id, revision)
    await loadVersions(published.id)
    message.value = 'Đã áp dụng cấu hình. Sinh viên sẽ thấy hướng dẫn của phiên bản này.'
  })
}
function issue(path: string) {
  return issues.value
    .filter((item) => item.path === path || item.path.startsWith(path + '.'))
    .map((item) => item.message)
    .join(' ')
}
function resetForm() {
  select(selected.value)
}
function addField() {
  form.value?.fields.push({
    key: 'field' + Date.now(),
    label: '',
    type: 'TEXT',
    source: 'STUDENT_INPUT',
    profileKey: null,
    required: false,
    maxLength: 500,
    options: [],
  })
}
function removeField(index: number) {
  form.value?.fields.splice(index, 1)
}
function setSource(index: number, event: Event) {
  const field = form.value?.fields[index]
  if (!field) return
  const value = (event.target as HTMLSelectElement).value
  if (value === 'STUDENT_INPUT') {
    field.source = 'STUDENT_INPUT'
    field.profileKey = null
  } else {
    field.source = 'PROFILE'
    field.profileKey = value as NonNullable<typeof field.profileKey>
    field.type = 'TEXT'
    field.options = []
  }
}
function setType(index: number) {
  const field = form.value?.fields[index]
  if (field && field.type !== 'SELECT') field.options = []
}
function setOptions(index: number, event: Event) {
  const field = form.value?.fields[index]
  if (field)
    field.options = (event.target as HTMLTextAreaElement).value
      .split('\n')
      .map((v) => v.trim())
      .filter(Boolean)
      .map((label, i) => ({ value: String(i + 1), label }))
}
function addAttachment() {
  form.value?.attachments.push({
    key: 'attachment' + Date.now(),
    label: '',
    required: false,
    mimeTypes: ['application/pdf'],
    maxFiles: 1,
    maxBytes: 5 * 1024 * 1024,
  })
}
function removeAttachment(index: number) {
  form.value?.attachments.splice(index, 1)
}
function changeUnit() {
  if (form.value) form.value.processorUserId = null
}
onBeforeRouteLeave(
  () =>
    !dirty.value || window.confirm('Bạn có thay đổi chưa lưu. Rời trang và bỏ những thay đổi này?'),
)
async function initialize() {
  await run(async () => {
    catalog.value = await api.catalog()
    serviceId.value = String(
      catalog.value.services.find((s) => s.code === 'STUDENT_CONFIRMATION')?.id ??
        catalog.value.services[0]?.id ??
        '',
    )
    ownerUnitId.value =
      catalog.value.units.find((u) => u.code === 'CTSV')?.id ?? catalog.value.units[0]?.id ?? ''
    if (serviceId.value) await loadVersions()
  })
}
onMounted(() => {
  void initialize()
})
</script>

<template>
  <section class="procedures">
    <header>
      <p class="page-eyebrow">Quản trị thủ tục</p>
      <h1 class="page-title">Biểu mẫu và nơi xử lý</h1>
      <p class="page-description">
        Cấu hình theo từng dịch vụ. Giấy xác nhận sinh viên được thực hiện trực tiếp tại Phòng CTSV.
      </p>
    </header>
    <p v-if="message" class="notice notice--success" role="status">{{ message }}</p>
    <div v-if="errorMessage" class="notice notice--error" role="alert">
      <p>{{ errorMessage }}</p>
      <NuxtLink v-if="needsLogin" to="/admin/login">Đăng nhập lại</NuxtLink
      ><BaseButton v-else-if="!catalog" variant="secondary" @click="initialize">Thử lại</BaseButton>
    </div>
    <p v-if="busy && !catalog" role="status">Đang tải cấu hình…</p>
    <template v-if="catalog">
      <div v-if="!catalog.services.length" class="panel">
        <h2>Chưa có dịch vụ trong phạm vi của bạn</h2>
        <p>Quản trị viên hệ thống cần khởi tạo cấu hình và giao đơn vị sở hữu.</p>
      </div>
      <div v-else class="panel selectors">
        <div>
          <label for="procedure-service">Dịch vụ</label
          ><select
            id="procedure-service"
            v-model="serviceId"
            :disabled="busy || dirty"
            @change="changeService"
          >
            <option
              v-for="service in catalog.services"
              :key="service.id"
              :value="String(service.id)"
            >
              {{ service.name }}
            </option>
          </select>
        </div>
        <div v-if="versions.length">
          <label for="procedure-version">Phiên bản</label
          ><select
            id="procedure-version"
            :value="selected?.id"
            :disabled="busy || dirty"
            @change="changeVersion"
          >
            <option v-for="version in versions" :key="version.id" :value="version.id">
              Phiên bản {{ version.versionNumber }} — {{ statuses[version.status] }}
            </option>
          </select>
        </div>
        <div v-else>
          <label for="procedure-owner">Đơn vị sở hữu cấu hình</label
          ><select id="procedure-owner" v-model="ownerUnitId" :disabled="busy">
            <option v-for="unit in catalog.units" :key="unit.id" :value="unit.id">
              {{ unit.name }}
            </option>
          </select>
        </div>
        <BaseButton
          v-if="selected?.status !== 'DRAFT'"
          :disabled="busy || !serviceId || (!selected && !catalog.canCreate) || !ownerUnitId"
          :loading="busy"
          @click="createDraft"
          >{{ selected ? 'Tạo phiên bản mới' : 'Tạo cấu hình' }}</BaseButton
        >
        <small v-if="dirty">Lưu hoặc khôi phục bản đã lưu trước khi đổi dịch vụ/phiên bản.</small>
      </div>
      <div v-if="!selected && catalog.services.length" class="panel">
        <h2>Chưa có cấu hình</h2>
        <p>
          Chọn đơn vị sở hữu rồi tạo cấu hình. Bản nháp chưa xuất hiện trên trang dịch vụ của sinh
          viên.
        </p>
      </div>
      <div v-if="selected && form" class="editor" :class="{ 'editor--single': !showPreview }">
        <form class="panel" @submit.prevent="save">
          <div class="editor__heading">
            <h2>{{ statuses[selected.status] }}</h2>
            <button type="button" class="text-button" @click="showPreview = !showPreview">
              {{ showPreview ? 'Ẩn xem trước' : 'Xem trước' }}
            </button>
          </div>
          <p v-if="!editable" class="muted">
            Phiên bản này đã khóa. Chọn “Tạo phiên bản mới” để thay đổi cấu hình.
          </p>
          <fieldset :disabled="busy || !editable">
            <legend>1. Hình thức và người xử lý</legend>
            <label for="processing-mode">Hình thức thực hiện</label
            ><select id="processing-mode" v-model="form.processingMode">
              <option value="OFFLINE">Trực tiếp tại đơn vị</option>
              <option value="ONLINE">Trực tuyến</option>
              <option value="HYBRID">Kết hợp trực tuyến và trực tiếp</option>
            </select>
            <p v-if="form.processingMode !== 'OFFLINE'" class="muted">
              Cấu hình cho bước mở nộp hồ sơ trực tuyến sau này. Hiện chưa có chức năng nộp/xét
              duyệt online.
            </p>
            <label for="processing-unit">Đơn vị xử lý thực tế</label
            ><select id="processing-unit" v-model="form.processingUnitId" @change="changeUnit">
              <option v-for="unit in catalog.units" :key="unit.id" :value="unit.id">
                {{ unit.name }}
              </option>
            </select>
            <p v-if="issue('processingUnitId')" class="field-error">
              {{ issue('processingUnitId') }}
            </p>
            <label for="processing-person">Phân công người xử lý</label
            ><select id="processing-person" v-model="form.processorUserId">
              <option :value="null">
                {{
                  form.processingMode === 'OFFLINE'
                    ? 'Theo phân công nội bộ tại đơn vị'
                    : 'Hàng đợi cán bộ của đơn vị'
                }}
              </option>
              <option
                v-for="reviewer in reviewers"
                :key="reviewer.id + reviewer.unitId"
                :value="reviewer.id"
              >
                {{ reviewer.name }}
              </option>
            </select>
            <p v-if="issue('processorUserId')" class="field-error">
              {{ issue('processorUserId') }}
            </p>
            <small
              >Chỉ cán bộ đang hoạt động và có quyền xét duyệt trong phạm vi phù hợp xuất hiện trong
              danh sách.</small
            >
            <label for="contact-instructions">Hướng dẫn sinh viên liên hệ/thực hiện</label
            ><textarea
              id="contact-instructions"
              v-model="form.contactInstructions"
              rows="4"
              maxlength="2000"
              :aria-invalid="!!issue('contactInstructions')"
            />
            <p v-if="issue('contactInstructions')" class="field-error">
              {{ issue('contactInstructions') }}
            </p>
          </fieldset>
          <fieldset :disabled="busy || !editable">
            <legend>2. Các trường biểu mẫu</legend>
            <p class="muted">
              Các trường là cấu hình mẫu. Với thủ tục trực tiếp, sinh viên chuẩn bị thông tin theo
              hướng dẫn của phòng.
            </p>
            <div v-for="(field, index) in form.fields" :key="field.key" class="item">
              <div class="item__heading">
                <strong>Trường {{ index + 1 }}</strong
                ><button
                  type="button"
                  class="text-button"
                  :aria-label="'Xóa trường ' + (index + 1)"
                  @click="removeField(index)"
                >
                  Xóa
                </button>
              </div>
              <label :for="'field-label-' + index">Tên trường</label
              ><input
                :id="'field-label-' + index"
                v-model="field.label"
                maxlength="255"
                :aria-invalid="!!issue('fields.' + index)"
              />
              <label :for="'field-source-' + index">Nguồn dữ liệu</label
              ><select
                :id="'field-source-' + index"
                :value="field.source === 'PROFILE' ? field.profileKey : 'STUDENT_INPUT'"
                @change="setSource(index, $event)"
              >
                <option value="STUDENT_INPUT">Sinh viên khai</option>
                <option value="studentCode">Tự điền mã sinh viên</option>
                <option value="fullName">Tự điền họ tên</option>
                <option value="classCode">Tự điền lớp</option>
                <option value="facultyCode">Tự điền khoa</option>
              </select>
              <label :for="'field-type-' + index">Kiểu nhập</label
              ><select
                :id="'field-type-' + index"
                v-model="field.type"
                :disabled="field.source === 'PROFILE'"
                @change="setType(index)"
              >
                <option value="TEXT">Văn bản ngắn</option>
                <option value="TEXTAREA">Văn bản dài</option>
                <option value="NUMBER">Số</option>
                <option value="DATE">Ngày</option>
                <option value="SELECT">Danh sách lựa chọn</option>
                <option value="BOOLEAN">Ô đánh dấu</option>
              </select>
              <label
                v-if="field.type === 'TEXT' || field.type === 'TEXTAREA'"
                :for="'field-length-' + index"
                >Số ký tự tối đa</label
              ><input
                v-if="field.type === 'TEXT' || field.type === 'TEXTAREA'"
                :id="'field-length-' + index"
                v-model.number="field.maxLength"
                type="number"
                min="1"
                max="2000"
              />
              <template v-if="field.type === 'SELECT'"
                ><label :for="'field-options-' + index">Các lựa chọn — mỗi dòng một lựa chọn</label
                ><textarea
                  :id="'field-options-' + index"
                  :value="field.options.map((o) => o.label).join('\n')"
                  rows="3"
                  @input="setOptions(index, $event)"
                />
              </template>
              <label class="check"
                ><input v-model="field.required" type="checkbox" /> Bắt buộc</label
              >
              <p v-if="issue('fields.' + index)" class="field-error">
                {{ issue('fields.' + index) }}
              </p>
            </div>
            <BaseButton
              type="button"
              variant="secondary"
              :disabled="form.fields.length >= 50"
              @click="addField"
              >Thêm trường</BaseButton
            >
          </fieldset>
          <fieldset :disabled="busy || !editable">
            <legend>3. Minh chứng cần chuẩn bị</legend>
            <p v-if="!form.attachments.length" class="muted">Chưa yêu cầu minh chứng.</p>
            <div v-for="(item, index) in form.attachments" :key="item.key" class="item">
              <div class="item__heading">
                <strong>Minh chứng {{ index + 1 }}</strong
                ><button
                  type="button"
                  class="text-button"
                  :aria-label="'Xóa minh chứng ' + (index + 1)"
                  @click="removeAttachment(index)"
                >
                  Xóa
                </button>
              </div>
              <label :for="'attachment-label-' + index">Tên minh chứng</label
              ><input :id="'attachment-label-' + index" v-model="item.label" maxlength="255" />
              <label class="check"
                ><input v-model="item.required" type="checkbox" /> Bắt buộc</label
              >
              <label :for="'attachment-files-' + index">Số file tối đa</label
              ><input
                :id="'attachment-files-' + index"
                v-model.number="item.maxFiles"
                type="number"
                min="1"
                max="3"
              />
              <label :for="'attachment-type-' + index">Loại file được chấp nhận</label
              ><select :id="'attachment-type-' + index" v-model="item.mimeTypes" multiple>
                <option value="application/pdf">PDF</option>
                <option value="image/png">PNG</option>
                <option value="image/jpeg">JPEG</option>
              </select>
              <small
                >Giới hạn 5 MB/file, tổng 20 MB/hồ sơ. Phần này chỉ khai báo yêu cầu, chưa tải file
                lên.</small
              >
              <p v-if="issue('attachments.' + index)" class="field-error">
                {{ issue('attachments.' + index) }}
              </p>
            </div>
            <BaseButton
              type="button"
              variant="secondary"
              :disabled="form.attachments.length >= 5"
              @click="addAttachment"
              >Thêm minh chứng</BaseButton
            >
          </fieldset>
          <div v-if="editable" class="actions">
            <BaseButton type="submit" :loading="busy" :disabled="!dirty">Lưu bản nháp</BaseButton
            ><BaseButton
              type="button"
              variant="secondary"
              :disabled="busy || !dirty"
              @click="resetForm"
              >Khôi phục bản đã lưu</BaseButton
            ><BaseButton type="button" :disabled="busy || dirty" @click="publish"
              >Áp dụng cấu hình</BaseButton
            >
          </div>
          <small v-if="editable"
            >Lưu bản nháp trước khi áp dụng. Sau khi áp dụng, nội dung phiên bản được khóa.</small
          >
        </form>
        <ProcedurePreview v-if="showPreview" :config="form" :unit-name="unitName" />
      </div>
    </template>
  </section>
</template>
<style scoped>
.procedures {
  display: grid;
  gap: 24px;
}
.panel {
  padding: 24px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  min-width: 0;
}
.selectors {
  display: flex;
  align-items: end;
  flex-wrap: wrap;
  gap: 16px;
}
.selectors > div {
  flex: 1 1 240px;
}
.selectors small {
  flex-basis: 100%;
}
.editor {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr);
  gap: 24px;
  align-items: start;
}
.editor--single {
  grid-template-columns: 1fr;
}
.editor__heading,
.item__heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.editor h2 {
  margin-bottom: 12px;
}
fieldset {
  display: grid;
  gap: 10px;
  margin: 24px 0;
  padding: 0;
  border: 0;
  min-width: 0;
}
legend {
  margin-bottom: 16px;
  font-size: 18px;
  font-weight: 700;
}
label {
  font-size: 15px;
  font-weight: 600;
}
input:not([type='checkbox']),
textarea,
select {
  width: 100%;
  min-height: 44px;
  padding: 10px 12px;
  border: 1px solid var(--color-border-strong);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-text);
}
input:disabled,
select:disabled,
textarea:disabled {
  background: var(--color-surface-subtle);
}
input[aria-invalid='true'],
textarea[aria-invalid='true'] {
  border-color: var(--color-error);
}
select[multiple] {
  min-height: 100px;
}
.item {
  display: grid;
  gap: 10px;
  padding: 18px;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  margin-bottom: 12px;
}
.check {
  display: flex;
  gap: 8px;
  align-items: center;
  min-height: 44px;
}
.check input {
  width: 20px;
  height: 20px;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 12px;
}
.text-button {
  min-height: 44px;
  padding: 8px;
  border: 0;
  background: none;
  color: var(--color-primary);
  cursor: pointer;
  font-weight: 600;
}
.text-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.muted,
small {
  color: var(--color-muted);
  line-height: 1.6;
}
.field-error {
  color: var(--color-error);
  margin: 0;
  line-height: 1.5;
}
.notice {
  padding: 16px 20px;
  border-radius: 12px;
}
.notice p {
  margin-bottom: 8px;
}
.notice--error {
  background: var(--color-error-background);
  color: var(--color-error);
}
.notice--success {
  background: var(--color-success-background);
  color: var(--color-success);
}
@media (max-width: 1050px) {
  .editor {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 600px) {
  .panel {
    padding: 18px;
  }
  .selectors {
    align-items: stretch;
  }
  .actions {
    flex-direction: column;
  }
  .item {
    padding: 12px;
  }
}
</style>
