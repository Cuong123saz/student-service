<script setup lang="ts">
import type {
  AuditActorType,
  AuditLogItem,
  AuditState,
} from '~/types/audit-log'
import {
  formatAuditValue,
  sanitizeAuditState,
} from '~/utils/audit-log'

definePageMeta({
  layout: 'admin',
  middleware: 'admin-auth',
})

// API chưa có endpoint trả action catalog. Khi backend thêm action,
// danh sách tĩnh này cũng phải được cập nhật.
const auditActionOptions = [
  'ACADEMIC_CLASS_CREATE',
  'ACADEMIC_CLASS_UPDATE',
  'ADMIN_LOGIN',
  'ADMIN_LOGOUT',
  'FACULTY_CREATE',
  'FACULTY_UPDATE',
  'INVITATION_EMAIL_FAILED',
  'INVITATION_EMAIL_SENT',
  'INVITATION_RESEND',
  'ORGANIZATIONAL_UNIT_CREATE',
  'ORGANIZATIONAL_UNIT_UPDATE',
  'ROLE_ASSIGNMENT',
  'ROLE_ASSIGNMENT_UPDATE',
  'ROLE_PERMISSION_UPDATE',
  'STUDENT_EXPORT',
  'STUDENT_IMPORT_COMMIT',
  'USER_INVITATION_CREATE',
] as const

const actionLabels: Record<string, string> = {
  ACADEMIC_CLASS_CREATE: 'Tạo lớp học',
  ACADEMIC_CLASS_UPDATE: 'Cập nhật lớp học',
  ADMIN_LOGIN: 'Đăng nhập quản trị',
  ADMIN_LOGOUT: 'Đăng xuất quản trị',
  FACULTY_CREATE: 'Tạo khoa',
  FACULTY_UPDATE: 'Cập nhật khoa',
  INVITATION_EMAIL_FAILED: 'Gửi email mời thất bại',
  INVITATION_EMAIL_SENT: 'Đã gửi email mời',
  INVITATION_RESEND: 'Gửi lại lời mời',
  ORGANIZATIONAL_UNIT_CREATE: 'Tạo đơn vị',
  ORGANIZATIONAL_UNIT_UPDATE: 'Cập nhật đơn vị',
  ROLE_ASSIGNMENT: 'Gán vai trò',
  ROLE_ASSIGNMENT_UPDATE: 'Cập nhật vai trò',
  ROLE_PERMISSION_UPDATE: 'Cập nhật quyền vai trò',
  STUDENT_EXPORT: 'Xuất sinh viên',
  STUDENT_IMPORT_COMMIT: 'Nhập sinh viên',
  USER_INVITATION_CREATE: 'Tạo lời mời người dùng',
}

const actorTypeLabels: Record<AuditActorType, string> = {
  USER: 'Người dùng',
  ANONYMOUS: 'Ẩn danh',
  SYSTEM: 'Hệ thống',
}

const {
  auditLogs,
  isLoading,
  hasLoaded,
  errorMessage,
  nextCursorBefore,
  pageNumber,
  load,
  nextPage,
  previousPage,
} = useAuditLogs()

const actionInput = ref('')

function getActionLabel(action: string) {
  return actionLabels[action] ?? action
}

function getActorLabel(log: AuditLogItem) {
  if (log.actorUsername) {
    return log.actorUsername
  }

  return actorTypeLabels[log.actorType]
}

function getResourceLabel(log: AuditLogItem) {
  return log.resourceId
    ? `${log.resourceType} · ${log.resourceId}`
    : log.resourceType
}

function formatOccurredAt(value: string) {
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(new Date(value))
}

function stateEntries(state: AuditState | null) {
  return Object.entries(sanitizeAuditState(state) ?? {})
}

async function applyFilter() {
  await load(actionInput.value)
}

async function clearFilter() {
  actionInput.value = ''
  await load()
}

onMounted(async () => {
  await load()
})
</script>

<template>
  <section class="audit-page">
    <header class="audit-page__header">
      <div>
        <p class="audit-page__eyebrow">Giám sát hệ thống</p>
        <h1>Audit log</h1>
        <p>Theo dõi các thao tác quan trọng trong hệ thống.</p>
      </div>
      <button
        type="button"
        class="button button--secondary"
        :disabled="isLoading"
        @click="load(actionInput)"
      >
        {{ isLoading ? 'Đang tải...' : 'Làm mới' }}
      </button>
    </header>

    <aside class="scope-note">
      <strong>Phạm vi hiện tại:</strong>
      người có quyền <code>audit.read</code> xem log toàn hệ thống.
      API hiện hỗ trợ lọc theo hành động và phân trang theo thời gian;
      chưa hỗ trợ lọc người thực hiện, đối tượng hoặc khoảng ngày.
    </aside>

    <form class="filters" @submit.prevent="applyFilter">
      <label>
        Hành động
        <select v-model="actionInput">
          <option value="">Tất cả hành động</option>
          <option
            v-for="action in auditActionOptions"
            :key="action"
            :value="action"
          >
            {{ getActionLabel(action) }}
          </option>
        </select>
      </label>
      <div class="filters__actions">
        <button type="submit" class="button" :disabled="isLoading">
          Áp dụng
        </button>
        <button
          type="button"
          class="button button--secondary"
          :disabled="isLoading || !actionInput"
          @click="clearFilter"
        >
          Xóa lọc
        </button>
      </div>
    </form>

    <div v-if="isLoading && !hasLoaded" class="status-card">
      Đang tải audit log...
    </div>

    <div v-else-if="errorMessage" class="status-card status-card--error">
      <p>{{ errorMessage }}</p>
      <NuxtLink v-if="errorMessage.includes('đăng nhập')" to="/admin/login">
        Đi tới trang đăng nhập
      </NuxtLink>
      <button v-else type="button" class="button" @click="load(actionInput)">
        Thử lại
      </button>
    </div>

    <div v-else-if="hasLoaded && auditLogs.length === 0" class="status-card">
      Không có sự kiện phù hợp với bộ lọc hiện tại.
    </div>

    <template v-else-if="auditLogs.length > 0">
      <div class="audit-table-wrap" :aria-busy="isLoading">
        <table class="audit-table">
          <thead>
            <tr>
              <th>Thời gian</th>
              <th>Người thực hiện</th>
              <th>Hành động</th>
              <th>Đối tượng</th>
              <th>Kết quả</th>
              <th>Chi tiết</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="log in auditLogs" :key="log.id">
              <td>
                <time :datetime="log.occurredAt">
                  {{ formatOccurredAt(log.occurredAt) }}
                </time>
              </td>
              <td>
                <strong>{{ getActorLabel(log) }}</strong>
                <small>{{ actorTypeLabels[log.actorType] }}</small>
              </td>
              <td>{{ getActionLabel(log.action) }}</td>
              <td>{{ getResourceLabel(log) }}</td>
              <td>
                <span
                  class="outcome"
                  :class="`outcome--${log.outcome.toLowerCase()}`"
                >
                  {{ log.outcome === 'SUCCESS' ? 'Thành công' : 'Thất bại' }}
                </span>
              </td>
              <td>
                <details class="audit-detail">
                  <summary>Xem</summary>
                  <dl>
                    <template v-if="log.requestId">
                      <dt>Request ID</dt>
                      <dd>{{ log.requestId }}</dd>
                    </template>
                    <template v-if="log.ipAddress">
                      <dt>IP</dt>
                      <dd>{{ log.ipAddress }}</dd>
                    </template>
                    <template v-if="log.userAgent">
                      <dt>User agent</dt>
                      <dd>{{ log.userAgent }}</dd>
                    </template>
                  </dl>

                  <section>
                    <h2>Metadata</h2>
                    <dl v-if="stateEntries(log.metadata).length > 0">
                      <template
                        v-for="entry in stateEntries(log.metadata)"
                        :key="entry[0]"
                      >
                        <dt>{{ entry[0] }}</dt>
                        <dd>{{ formatAuditValue(entry[1]) }}</dd>
                      </template>
                    </dl>
                    <p v-else>Không có metadata.</p>
                  </section>

                  <section v-if="log.before !== null">
                    <h2>Trước thay đổi</h2>
                    <dl v-if="stateEntries(log.before).length > 0">
                      <template
                        v-for="entry in stateEntries(log.before)"
                        :key="entry[0]"
                      >
                        <dt>{{ entry[0] }}</dt>
                        <dd>{{ formatAuditValue(entry[1]) }}</dd>
                      </template>
                    </dl>
                    <p v-else>Snapshot trước thay đổi rỗng.</p>
                  </section>

                  <section v-if="log.after !== null">
                    <h2>Sau thay đổi</h2>
                    <dl v-if="stateEntries(log.after).length > 0">
                      <template
                        v-for="entry in stateEntries(log.after)"
                        :key="entry[0]"
                      >
                        <dt>{{ entry[0] }}</dt>
                        <dd>{{ formatAuditValue(entry[1]) }}</dd>
                      </template>
                    </dl>
                    <p v-else>Snapshot sau thay đổi rỗng.</p>
                  </section>
                </details>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <nav class="pagination" aria-label="Phân trang audit log">
        <button
          type="button"
          class="button button--secondary"
          :disabled="isLoading || pageNumber === 1"
          @click="previousPage"
        >
          Trang trước
        </button>
        <span>Trang {{ pageNumber }}</span>
        <button
          type="button"
          class="button button--secondary"
          :disabled="isLoading || !nextCursorBefore"
          @click="nextPage"
        >
          Trang sau
        </button>
      </nav>
    </template>
  </section>
</template>

<style scoped>
.audit-page {
  display: grid;
  gap: 1.25rem;
}

.audit-page__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.audit-page__header h1 {
  margin: 0.2rem 0 0.35rem;
}

.audit-page__header p {
  margin: 0;
  color: #586174;
}

.audit-page__eyebrow {
  color: #225bc5 !important;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.scope-note,
.status-card,
.filters,
.audit-table-wrap {
  border: 1px solid #dfe4ec;
  border-radius: 0.75rem;
  background: #fff;
}

.scope-note {
  padding: 0.9rem 1rem;
  border-color: #bfd4ff;
  background: #f3f7ff;
  color: #294b85;
  line-height: 1.55;
}

.filters {
  display: flex;
  align-items: flex-end;
  gap: 1rem;
  padding: 1rem;
}

.filters label {
  display: grid;
  flex: 1;
  gap: 0.4rem;
  font-weight: 600;
}

.filters select {
  min-height: 2.6rem;
  padding: 0 0.7rem;
  border: 1px solid #bdc5d1;
  border-radius: 0.5rem;
  background: #fff;
}

.filters__actions,
.pagination {
  display: flex;
  align-items: center;
  gap: 0.65rem;
}

.button {
  min-height: 2.6rem;
  padding: 0 1rem;
  border: 1px solid #225bc5;
  border-radius: 0.5rem;
  background: #225bc5;
  color: #fff;
  cursor: pointer;
  font-weight: 700;
}

.button--secondary {
  background: #fff;
  color: #225bc5;
}

.button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.status-card {
  padding: 2rem;
  text-align: center;
}

.status-card--error {
  border-color: #f1b8b4;
  background: #fff8f7;
  color: #9d281f;
}

.audit-table-wrap {
  overflow-x: auto;
}

.audit-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}

.audit-table th,
.audit-table td {
  padding: 0.85rem 0.9rem;
  border-bottom: 1px solid #e7eaf0;
  text-align: left;
  vertical-align: top;
}

.audit-table th {
  background: #f6f8fb;
  color: #4a5365;
  white-space: nowrap;
}

.audit-table td small {
  display: block;
  margin-top: 0.2rem;
  color: #737c8d;
}

.outcome {
  display: inline-flex;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  font-size: 0.8rem;
  font-weight: 700;
  white-space: nowrap;
}

.outcome--success {
  background: #e7f7ed;
  color: #19713b;
}

.outcome--failure {
  background: #fdebea;
  color: #a32c25;
}

.audit-detail {
  min-width: 7rem;
}

.audit-detail summary {
  color: #225bc5;
  cursor: pointer;
  font-weight: 700;
}

.audit-detail section {
  margin-top: 0.8rem;
}

.audit-detail h2 {
  margin: 0 0 0.4rem;
  font-size: 0.9rem;
}

.audit-detail dl {
  display: grid;
  grid-template-columns: minmax(6rem, auto) minmax(10rem, 1fr);
  gap: 0.25rem 0.6rem;
  margin: 0.65rem 0 0;
}

.audit-detail dt {
  color: #667085;
}

.audit-detail dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.pagination {
  justify-content: flex-end;
}

@media (max-width: 720px) {
  .audit-page__header,
  .filters {
    align-items: stretch;
    flex-direction: column;
  }

  .filters__actions .button {
    flex: 1;
  }

  .pagination {
    justify-content: space-between;
  }
}
</style>
