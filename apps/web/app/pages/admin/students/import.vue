<script setup lang="ts">
import type {
  StudentImportCellKind,
  StudentImportColumn,
  StudentImportDuplicateReason,
  StudentImportDuplicateStrategy,
  StudentImportErrorCell,
  StudentImportRowIssue,
} from '~/types/student-import'

definePageMeta({
  layout: 'admin',
  middleware: 'admin-auth',
})
const importFieldLabels:
  Record<StudentImportColumn, string> = {
    studentCode: 'Mã sinh viên',
    fullName: 'Họ và tên',
    email: 'Email',
    classCode: 'Mã lớp',
  }

// Mirror giới hạn phía client của composable (MAX_IMPORT_FILE_BYTES nội bộ
// trong useStudentImport chưa được export). Đây chỉ là kiểm tra sớm để
// cải thiện UX — backend/composable vẫn là nơi thực thi giới hạn chính thức.
const MAX_CLIENT_FILE_BYTES = 5 * 1024 * 1024
const SUPPORTED_EXTENSIONS = /\.(csv|xlsx)$/i

const {
  preview,
  result,
  isPreviewing,
  isConfirming,
  errorMessage,
  errorRequestId,
  previewImport,
  confirmImport,
  reset,
} = useStudentImport()

const selectedFile = ref<File | null>(null)
const duplicateStrategy =
  ref<StudentImportDuplicateStrategy>('FAIL')
const clientError = ref('')

const displayedError = computed(
  () => clientError.value || errorMessage.value,
)

const canConfirm = computed(
  () => Boolean(
    preview.value
    && preview.value.errorRecords.length === 0
    && !isPreviewing.value
    && !isConfirming.value,
  ),
)

const previewExpiresAt = computed(() => {
  if (!preview.value) {
    return ''
  }

  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(preview.value.expiresAt))
})

function getIssueMessage(
  issue: StudentImportRowIssue,
): string {
  const fieldLabel =
    importFieldLabels[issue.field]

  switch (issue.code) {
    case 'REQUIRED':
      return `Thiếu ${fieldLabel.toLowerCase()}.`

    case 'INVALID_TYPE':
      return `${fieldLabel} phải là dữ liệu văn bản.`

    case 'INVALID_FORMAT':
      return `${fieldLabel} không đúng định dạng.`

    case 'INVALID_LENGTH':
      return `${fieldLabel} có độ dài không hợp lệ.`

    case 'CLASS_NOT_FOUND_OR_OUTSIDE_SCOPE':
      return 'Mã lớp không tồn tại, đã ngừng hoạt động hoặc nằm ngoài phạm vi được phân quyền.'

    default:
      return 'Dữ liệu tại trường này không hợp lệ.'
  }
}

const cellKindLabels:
  Record<StudentImportCellKind, string> = {
    EMPTY: 'Để trống',
    TEXT: '',
    NUMBER: 'Giá trị dạng số',
    BOOLEAN: 'Giá trị đúng hoặc sai',
    DATE: 'Giá trị ngày tháng',
  }

function formatErrorCell(
  cell: StudentImportErrorCell,
): string {
  if (cell.kind === 'TEXT') {
    return cell.text?.trim() || 'Để trống'
  }

  return cellKindLabels[cell.kind]
}

function formatDuplicateReason(
  duplicate: StudentImportDuplicateReason,
): string {
  const field = duplicate.field === 'studentCode'
    ? 'mã sinh viên'
    : 'email'

  if (duplicate.source === 'FILE') {
    return duplicate.matchedSourceRow
      ? `Trùng ${field} với dòng ${duplicate.matchedSourceRow} trong file.`
      : `Trùng ${field} trong file.`
  }

  return `Trùng ${field} với dữ liệu đang có trong hệ thống.`
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }

  return `${(
    bytes
    / (1024 * 1024)
  ).toFixed(2)} MB`
}

function handleFileSelected(event: Event) {
  const input =
    event.currentTarget as HTMLInputElement
  const file = input.files?.item(0) ?? null

  clientError.value = ''

  if (!reset()) {
    input.value = ''
    return
  }

  duplicateStrategy.value = 'FAIL'

  if (file && !SUPPORTED_EXTENSIONS.test(file.name)) {
    clientError.value =
      'Chỉ hỗ trợ file .csv hoặc .xlsx.'
    selectedFile.value = null
    input.value = ''
    return
  }

  if (file && file.size > MAX_CLIENT_FILE_BYTES) {
    clientError.value =
      'File vượt quá 5 MB. Vui lòng chọn file khác.'
    selectedFile.value = null
    input.value = ''
    return
  }

  selectedFile.value = file
}

async function handlePreview() {
  if (!selectedFile.value) {
    return
  }

  const succeeded =
    await previewImport(selectedFile.value)

  if (succeeded) {
    duplicateStrategy.value = 'FAIL'
  }
}

async function handleConfirm() {
  if (!canConfirm.value) {
    return
  }

  await confirmImport(duplicateStrategy.value)
}

function startAnotherImport() {
  if (!reset()) {
    return
  }

  selectedFile.value = null
  clientError.value = ''
  duplicateStrategy.value = 'FAIL'
}
</script>

<template>
  <section class="student-import">
    <header>
      <p class="page-eyebrow">
        Quản lý sinh viên
      </p>

      <h1 class="page-title">
        Import danh sách sinh viên
      </h1>

      <p class="page-description">
        Tải file Excel hoặc CSV, kiểm tra dữ liệu
        trước khi xác nhận ghi vào hệ thống.
      </p>
    </header>

    <div class="student-import__actions">
      <NuxtLink to="/admin/students">
        ← Quay lại danh sách sinh viên
      </NuxtLink>
    </div>

    <form
      v-if="!result"
      class="surface-card student-import__upload"
      @submit.prevent="handlePreview"
    >
      <div>
        <p class="page-eyebrow">
          Bước 1
        </p>

        <h2>Chọn file dữ liệu</h2>

        <p id="student-import-help">
          Hỗ trợ file CSV hoặc XLSX, tối đa 5 MB
          và không quá 1.000 dòng dữ liệu. Mã sinh viên chỉ gồm chữ số;
          nếu có số 0 ở đầu, hãy đặt cột này ở định dạng Text trong Excel.
          Khoa được xác định và đồng bộ tự động theo mã lớp hành chính.
        </p>
      </div>

      <label
        class="student-import__file-picker"
        for="student-import-file"
      >
        <strong>Chọn file từ máy tính</strong>

        <span>
          Nhấn vào đây để chọn file CSV hoặc Excel
        </span>
      </label>

      <input
        id="student-import-file"
        class="student-import__file-input"
        type="file"
        accept=".csv,.xlsx"
        aria-describedby="student-import-help"
        :disabled="isPreviewing || isConfirming"
        @change="handleFileSelected"
      >

      <article
        v-if="selectedFile"
        class="student-import__selected-file"
        aria-live="polite"
      >
        <div>
          <strong>{{ selectedFile.name }}</strong>

          <span>
            {{ formatFileSize(selectedFile.size) }}
          </span>
        </div>

        <span class="student-import__file-ready">
          Đã chọn
        </span>
      </article>

      <BaseAlert
        v-if="displayedError && !preview"
        variant="error"
        title="Không thể tiếp tục import"
      >
        <p>{{ displayedError }}</p>

        <small v-if="errorRequestId">
          Mã tra cứu: {{ errorRequestId }}
        </small>
      </BaseAlert>

      <div class="student-import__submit">
        <BaseButton
          type="submit"
          :loading="isPreviewing"
          :disabled="!selectedFile || isPreviewing || isConfirming"
        >
          {{
            isPreviewing
              ? 'Đang kiểm tra dữ liệu...'
              : 'Kiểm tra và xem trước'
          }}
        </BaseButton>
      </div>
    </form>

    <section
      v-if="preview"
      class="surface-card student-import__preview-summary"
      aria-live="polite"
    >
      <p class="page-eyebrow">
        Bước 2
      </p>

      <h2>Đã kiểm tra file</h2>

      <dl>
        <div>
          <dt>Tổng số dòng</dt>
          <dd>{{ preview.summary.total }}</dd>
        </div>

        <div>
          <dt>Hợp lệ</dt>
          <dd>{{ preview.summary.valid }}</dd>
        </div>

        <div>
          <dt>Có lỗi</dt>
          <dd>{{ preview.summary.errors }}</dd>
        </div>

        <div>
          <dt>Nghi trùng</dt>
          <dd>{{ preview.summary.duplicates }}</dd>
        </div>
      </dl>

      <p class="student-import__expiry">
        File <strong>{{ preview.file.name }}</strong>
        đã được đọc. Bản xem trước có hiệu lực đến
        <strong>{{ previewExpiresAt }}</strong>.
      </p>

      <section
        v-if="preview.errorRecords.length > 0"
        class="student-import__errors"
        aria-labelledby="import-errors-title"
      >
        <BaseAlert
          variant="warning"
          title="File còn dữ liệu cần sửa"
        >
          Bạn chưa thể xác nhận import. Hãy sửa những
          dòng dưới đây rồi tải lại file.
        </BaseAlert>

        <div class="student-import__section-heading">
          <h3 id="import-errors-title">
            Chi tiết {{ preview.errorRecords.length }} dòng lỗi
          </h3>

          <p>
            Giá trị không phải văn bản được hiển thị theo
            loại dữ liệu để tránh tự chuyển đổi sai nội dung.
          </p>
        </div>

        <div class="student-import__table-wrap">
          <table class="student-import__data-table">
            <thead>
              <tr>
                <th>Dòng</th>
                <th>Mã sinh viên</th>
                <th>Họ và tên</th>
                <th>Email</th>
                <th>Mã lớp</th>
                <th>Lỗi cần sửa</th>
              </tr>
            </thead>

            <tbody>
              <tr
                v-for="record in preview.errorRecords"
                :key="record.sourceRow"
              >
                <td>Dòng {{ record.sourceRow }}</td>
                <td>{{ formatErrorCell(record.values.studentCode) }}</td>
                <td>{{ formatErrorCell(record.values.fullName) }}</td>
                <td>{{ formatErrorCell(record.values.email) }}</td>
                <td>{{ formatErrorCell(record.values.classCode) }}</td>
                <td>
                  <ul class="student-import__issue-list">
                    <li
                      v-for="(issue, issueIndex) in record.issues"
                      :key="`${issue.field}-${issue.code}-${issueIndex}`"
                    >
                      <strong>{{ importFieldLabels[issue.field] }}</strong>
                      <span>{{ getIssueMessage(issue) }}</span>
                    </li>
                  </ul>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section
        v-if="preview.duplicateRecords.length > 0"
        class="student-import__duplicates"
        aria-labelledby="import-duplicates-title"
      >
        <div class="student-import__section-heading">
          <h3 id="import-duplicates-title">
            {{ preview.duplicateRecords.length }} dòng có dữ liệu trùng
          </h3>

          <p>
            Kiểm tra từng dòng trước khi chọn cách xử lý ở bước xác nhận.
          </p>
        </div>

        <div class="student-import__table-wrap">
          <table class="student-import__data-table">
            <thead>
              <tr>
                <th>Dòng</th>
                <th>Mã sinh viên</th>
                <th>Họ và tên</th>
                <th>Email</th>
                <th>Mã lớp</th>
                <th>Phát hiện trùng</th>
              </tr>
            </thead>

            <tbody>
              <tr
                v-for="item in preview.duplicateRecords"
                :key="item.record.sourceRow"
              >
                <td>Dòng {{ item.record.sourceRow }}</td>
                <td>{{ item.record.studentCode }}</td>
                <td>{{ item.record.fullName }}</td>
                <td>{{ item.record.email }}</td>
                <td>{{ item.record.classCode }}</td>
                <td>
                  <ul class="student-import__issue-list">
                    <li
                      v-for="(duplicate, duplicateIndex) in item.duplicates"
                      :key="`${duplicate.field}-${duplicate.source}-${duplicateIndex}`"
                    >
                      <span>{{ formatDuplicateReason(duplicate) }}</span>
                    </li>
                  </ul>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <form
        v-if="preview.errorRecords.length === 0"
        class="student-import__confirm"
        @submit.prevent="handleConfirm"
      >
        <div>
          <p class="page-eyebrow">Bước 3</p>
          <h3>Xác nhận ghi dữ liệu</h3>
          <p>
            Chọn cách xử lý khi gặp bản ghi trùng rồi xác nhận import.
          </p>
        </div>

        <fieldset class="student-import__strategy-list">
          <legend>Cách xử lý dữ liệu trùng</legend>

          <label>
            <input
              v-model="duplicateStrategy"
              type="radio"
              value="FAIL"
              :disabled="isConfirming"
            >
            <span>
              <strong>Dừng khi có dữ liệu trùng</strong>
              <small>An toàn nhất. Không ghi dữ liệu nếu phát hiện trùng.</small>
            </span>
          </label>

          <label>
            <input
              v-model="duplicateStrategy"
              type="radio"
              value="SKIP"
              :disabled="isConfirming"
            >
            <span>
              <strong>Bỏ qua dòng trùng</strong>
              <small>Chỉ import những dòng không bị trùng.</small>
            </span>
          </label>

          <label>
            <input
              v-model="duplicateStrategy"
              type="radio"
              value="OVERWRITE"
              :disabled="isConfirming"
            >
            <span>
              <strong>Ghi đè dữ liệu hiện có</strong>
              <small>Chỉ dùng khi đã kiểm tra kỹ các bản ghi trùng.</small>
            </span>
          </label>
        </fieldset>

        <BaseAlert
          v-if="displayedError"
          variant="error"
          title="Không thể hoàn tất import"
        >
          <p>{{ displayedError }}</p>
          <small v-if="errorRequestId">
            Mã tra cứu: {{ errorRequestId }}
          </small>
        </BaseAlert>

        <div class="student-import__confirm-actions">
          <BaseButton
            type="button"
            variant="secondary"
            :disabled="isConfirming"
            @click="startAnotherImport"
          >
            Chọn file khác
          </BaseButton>

          <BaseButton
            type="submit"
            :loading="isConfirming"
            :disabled="!canConfirm"
          >
            {{ isConfirming ? 'Đang ghi dữ liệu...' : 'Xác nhận import' }}
          </BaseButton>
        </div>
      </form>
    </section>

    <section
      v-if="result"
      class="surface-card student-import__result"
      aria-live="polite"
    >
      <BaseAlert
        variant="success"
        title="Import sinh viên thành công"
      >
        Dữ liệu đã được ghi trong một transaction và bản xem trước đã được đóng.
      </BaseAlert>

      <dl>
        <div>
          <dt>Đã tạo mới</dt>
          <dd>{{ result.imported }}</dd>
        </div>
        <div>
          <dt>Đã cập nhật</dt>
          <dd>{{ result.updated }}</dd>
        </div>
        <div>
          <dt>Đã bỏ qua</dt>
          <dd>{{ result.skipped }}</dd>
        </div>
      </dl>

      <div class="student-import__confirm-actions">
        <BaseButton
          type="button"
          variant="secondary"
          @click="startAnotherImport"
        >
          Import file khác
        </BaseButton>

        <NuxtLink
          class="student-import__primary-link"
          to="/admin/students"
        >
          Xem danh sách sinh viên
        </NuxtLink>
      </div>
    </section>
  </section>
</template>

<style scoped>
.student-import {
  display: grid;
  gap: 24px;
}

.student-import__actions a {
  color: var(--color-primary);
  font-weight: 700;
  text-decoration: none;
}

.student-import__actions a:hover {
  text-decoration: underline;
}

.student-import__upload {
  display: grid;
  gap: 20px;
  padding: 28px;
  border-radius: 18px;
}

.student-import__upload h2 {
  margin: 0 0 8px;
}

.student-import__upload p {
  margin: 0;
  color: var(--color-subtle);
  line-height: 1.6;
}

.student-import__file-picker {
  display: grid;
  min-height: 150px;
  place-content: center;
  gap: 8px;
  padding: 24px;
  border: 2px dashed #b8cbe0;
  border-radius: 16px;
  color: var(--color-primary-dark);
  background: #f8fbff;
  text-align: center;
  cursor: pointer;
  transition:
    border-color 150ms ease,
    background-color 150ms ease;
}

.student-import__file-picker:hover {
  border-color: var(--color-primary);
  background: #f0f7ff;
}

.student-import__file-picker span {
  color: var(--color-subtle);
  font-size: 14px;
  font-weight: 400;
}

.student-import__file-input {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}

.student-import__selected-file {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 18px;
  border: 1px solid #cfe2f5;
  border-radius: 14px;
  background: #f5faff;
}

.student-import__selected-file div {
  display: grid;
  gap: 4px;
}

.student-import__selected-file span {
  color: var(--color-subtle);
  font-size: 13px;
}

.student-import__file-ready {
  padding: 6px 10px;
  border-radius: 999px;
  color: #17623a !important;
  background: #e7f7ed;
  font-weight: 700;
  white-space: nowrap;
}

.student-import__submit {
  display: flex;
  justify-content: flex-end;
}

.student-import__preview-summary {
  display: grid;
  gap: 18px;
  padding: 28px;
  border-radius: 18px;
}

.student-import__preview-summary h2 {
  margin: 0;
}

.student-import__preview-summary dl {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
  margin: 0;
}

.student-import__preview-summary dl > div {
  display: grid;
  gap: 6px;
  padding: 16px;
  border: 1px solid var(--color-border);
  border-radius: 14px;
  background: var(--color-surface-subtle);
}

.student-import__preview-summary dt {
  color: var(--color-subtle);
  font-size: 13px;
}

.student-import__preview-summary dd {
  margin: 0;
  color: var(--color-primary-dark);
  font-size: 26px;
  font-weight: 800;
}

.student-import__expiry {
  margin: 0;
  color: var(--color-muted);
  font-size: 13px;
  line-height: 1.55;
}

.student-import__errors {
  display: grid;
  gap: 18px;
  padding-top: 8px;
}

.student-import__duplicates {
  display: grid;
  gap: 18px;
  padding-top: 8px;
}

.student-import__section-heading h3 {
  margin: 4px 0 0;
  font-size: 20px;
}

.student-import__section-heading p {
  margin: 6px 0 0;
  color: var(--color-muted);
  line-height: 1.55;
}

.student-import__table-wrap {
  overflow-x: auto;
  border: 1px solid var(--color-border);
  border-radius: 14px;
}

.student-import__table-wrap table {
  width: 100%;
  min-width: 980px;
  border-collapse: collapse;
}

.student-import__table-wrap th,
.student-import__table-wrap td {
  padding: 15px 17px;
  border-bottom: 1px solid var(--color-border);
  text-align: left;
  vertical-align: top;
}

.student-import__table-wrap th {
  color: var(--color-subtle);
  background: var(--color-surface-subtle);
  font-size: 12px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.student-import__table-wrap tbody tr:last-child td {
  border-bottom: 0;
}

.student-import__table-wrap td:first-child {
  width: 100px;
  white-space: nowrap;
}

.student-import__data-table td:nth-child(2),
.student-import__data-table td:nth-child(5) {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 12px;
}

.student-import__issue-list {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.student-import__issue-list li {
  display: grid;
  gap: 3px;
}

.student-import__issue-list strong {
  color: var(--color-error);
  font-size: 13px;
}

.student-import__issue-list span {
  color: var(--color-muted);
  line-height: 1.5;
}

.student-import__confirm {
  display: grid;
  gap: 18px;
  padding-top: 8px;
}

.student-import__confirm h3 {
  margin: 3px 0 6px;
  font-size: 20px;
}

.student-import__confirm > div > p:last-child {
  margin: 0;
  color: var(--color-muted);
}

.student-import__strategy-list {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin: 0;
  padding: 0;
  border: 0;
}

.student-import__strategy-list legend {
  margin-bottom: 10px;
  color: var(--color-text);
  font-size: 14px;
  font-weight: 800;
}

.student-import__strategy-list label {
  display: flex;
  align-items: flex-start;
  gap: 11px;
  padding: 16px;
  border: 1px solid var(--color-border);
  border-radius: 14px;
  background: #fbfdff;
  cursor: pointer;
}

.student-import__strategy-list label:has(input:checked) {
  border-color: var(--color-primary);
  background: var(--color-primary-soft);
  box-shadow: 0 0 0 3px rgb(21 94 239 / 8%);
}

.student-import__strategy-list input {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  margin: 2px 0 0;
  accent-color: var(--color-primary);
}

.student-import__strategy-list span {
  display: grid;
  gap: 5px;
}

.student-import__strategy-list strong {
  color: var(--color-text);
  font-size: 14px;
}

.student-import__strategy-list small {
  color: var(--color-muted);
  line-height: 1.45;
}

.student-import__confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.student-import__result {
  display: grid;
  gap: 20px;
  padding: 28px;
  border-radius: 18px;
}

.student-import__result dl {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin: 0;
}

.student-import__result dl > div {
  padding: 16px;
  border: 1px solid var(--color-border);
  border-radius: 14px;
  background: var(--color-surface-subtle);
}

.student-import__result dt {
  color: var(--color-muted);
  font-size: 13px;
}

.student-import__result dd {
  margin: 5px 0 0;
  color: var(--color-primary-dark);
  font-size: 28px;
  font-weight: 800;
}

.student-import__primary-link {
  display: inline-flex;
  min-height: 44px;
  align-items: center;
  justify-content: center;
  padding: 10px 18px;
  border-radius: 12px;
  color: #fff;
  background: linear-gradient(135deg, var(--color-primary), #205c94);
  font-weight: 700;
  text-decoration: none;
}

@media (max-width: 800px) {
  .student-import__preview-summary dl,
  .student-import__result dl {
    grid-template-columns: repeat(2, 1fr);
  }

  .student-import__strategy-list {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 560px) {
  .student-import__preview-summary dl,
  .student-import__result dl {
    grid-template-columns: 1fr;
  }

  .student-import__upload,
  .student-import__preview-summary,
  .student-import__result {
    padding: 20px;
  }

  .student-import__confirm-actions {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
