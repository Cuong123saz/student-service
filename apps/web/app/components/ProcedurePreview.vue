<script setup lang="ts">
import type { ProcedureConfig } from '~/types/procedure'
const props = defineProps<{ config: ProcedureConfig; unitName: string }>()
const samples: Record<string, string> = {
  studentCode: '20260001',
  fullName: 'Sinh viên mẫu',
  classCode: 'Lớp mẫu',
  facultyCode: 'Khoa mẫu',
}
const modeLabel = computed(() =>
  props.config.processingMode === 'OFFLINE'
    ? 'Trực tiếp tại đơn vị'
    : props.config.processingMode === 'HYBRID'
      ? 'Kết hợp trực tuyến và trực tiếp'
      : 'Trực tuyến',
)
</script>
<template>
  <section class="preview" aria-label="Xem trước biểu mẫu">
    <h2>Xem trước</h2>
    <p class="preview__note">Dữ liệu minh họa. Đây là bản xem trước, không gửi hồ sơ.</p>
    <dl>
      <div>
        <dt>Hình thức</dt>
        <dd>{{ modeLabel }}</dd>
      </div>
      <div>
        <dt>Đơn vị xử lý</dt>
        <dd>{{ unitName || 'Chưa chọn đơn vị' }}</dd>
      </div>
    </dl>
    <p class="preview__instructions">{{ config.contactInstructions }}</p>
    <div v-for="field in config.fields" :key="field.key" class="preview__field">
      <label :for="'preview-' + field.key"
        >{{ field.label || 'Trường chưa có tên' }}<span v-if="field.required"> *</span></label
      >
      <input
        v-if="field.source === 'PROFILE'"
        :id="'preview-' + field.key"
        :value="samples[field.profileKey ?? '']"
        readonly
      />
      <textarea
        v-else-if="field.type === 'TEXTAREA'"
        :id="'preview-' + field.key"
        rows="3"
        :maxlength="field.maxLength"
      />
      <select v-else-if="field.type === 'SELECT'" :id="'preview-' + field.key">
        <option value="">Chọn…</option>
        <option v-for="option in field.options" :key="option.value" :value="option.value">
          {{ option.label }}
        </option>
      </select>
      <input v-else-if="field.type === 'BOOLEAN'" :id="'preview-' + field.key" type="checkbox" />
      <input
        v-else
        :id="'preview-' + field.key"
        :type="field.type === 'NUMBER' ? 'number' : field.type === 'DATE' ? 'date' : 'text'"
        :maxlength="field.maxLength"
      />
      <small v-if="field.source === 'PROFILE'"
        >Tự điền từ hồ sơ sinh viên khi thực hiện trực tuyến.</small
      >
    </div>
    <div v-if="config.attachments.length">
      <h3>Minh chứng cần chuẩn bị</h3>
      <ul>
        <li v-for="item in config.attachments" :key="item.key">
          {{ item.label }} — {{ item.required ? 'Bắt buộc' : 'Tùy chọn' }}, tối đa
          {{ item.maxFiles }} file, {{ Math.round(item.maxBytes / 1024 / 1024) }} MB/file.
        </li>
      </ul>
    </div>
    <p v-if="config.processingMode === 'OFFLINE'" class="preview__note">
      Sinh viên làm việc trực tiếp tại đơn vị theo hướng dẫn phía trên.
    </p>
    <p v-else class="preview__note">
      Phần nộp hồ sơ trực tuyến chưa được mở. Cấu hình này chuẩn bị cho bước triển khai tiếp theo.
    </p>
  </section>
</template>
<style scoped>
.preview {
  padding: 24px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface-subtle);
}
.preview h2 {
  font-size: 20px;
}
.preview__note,
.preview small {
  color: var(--color-muted);
  line-height: 1.6;
}
.preview dl div {
  margin-bottom: 12px;
}
.preview dt {
  color: var(--color-muted);
  font-size: 14px;
}
.preview dd {
  margin: 4px 0;
  font-weight: 600;
}
.preview__instructions {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.6;
}
.preview__field {
  display: grid;
  gap: 8px;
  margin: 18px 0;
}
.preview label {
  font-weight: 600;
}
.preview input:not([type='checkbox']),
.preview textarea,
.preview select {
  width: 100%;
  min-height: 44px;
  padding: 10px;
  border: 1px solid var(--color-border-strong);
  border-radius: 8px;
  background: var(--color-surface);
}
.preview input[readonly] {
  background: var(--color-primary-soft);
}
.preview input[type='checkbox'] {
  width: 20px;
  height: 20px;
}
.preview li {
  line-height: 1.6;
}
</style>
