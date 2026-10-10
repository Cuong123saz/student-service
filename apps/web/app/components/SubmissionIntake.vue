<script setup lang="ts">
import type { ReviewSubmissionDetail, ReviewSubmissionSummary } from '~/types/submission'
import type { ProcedureApiError } from '~/types/procedure'
import {
  formatSubmissionAnswer,
  formatSubmissionTime,
  submissionStatusLabels,
} from '~/utils/submission'
const props = defineProps<{ portal: 'user' | 'admin'; id?: string }>()
const api = useReviewSubmissions(props.portal)
const basePath = props.portal === 'admin' ? '/admin/review-submissions' : '/review-submissions'
const selectedStatus = ref<ReviewSubmissionSummary['status']>('SUBMITTED')
const entries = ref<ReviewSubmissionSummary[]>([])
const detail = ref<ReviewSubmissionDetail | null>(null)
const loading = ref(true)
const claiming = ref(false)
const failure = ref<ProcedureApiError | null>(null)
const reloadRequired = ref(false)
const message = ref('')
const errorSummary = ref<HTMLElement | null>(null)
let loadSequence = 0
function fail(error: unknown) {
  failure.value = error as ProcedureApiError
  void nextTick(() => errorSummary.value?.focus())
}
async function load() {
  const sequence = ++loadSequence
  loading.value = true
  message.value = ''
  try {
    if (props.id) {
      const current = await api.get(props.id)
      if (sequence !== loadSequence) return
      detail.value = current
    } else {
      const current = await api.list(selectedStatus.value)
      if (sequence !== loadSequence) return
      entries.value = current
    }
    failure.value = null
    reloadRequired.value = false
  } catch (error) {
    if (sequence === loadSequence) {
      if (detail.value) reloadRequired.value = true
      fail(error)
    }
  } finally {
    if (sequence === loadSequence) loading.value = false
  }
}
function selectStatus(status: ReviewSubmissionSummary['status']) {
  if (props.id || status === selectedStatus.value) return
  selectedStatus.value = status
  entries.value = []
  failure.value = null
  reloadRequired.value = false
  void load()
}
async function claim() {
  if (
    !detail.value?.canClaim ||
    detail.value.status !== 'SUBMITTED' ||
    reloadRequired.value ||
    loading.value ||
    claiming.value
  )
    return
  const sequence = loadSequence
  const { id, revision } = detail.value
  claiming.value = true
  failure.value = null
  message.value = ''
  try {
    const current = await api.claim(id, revision)
    if (sequence !== loadSequence || props.id !== id) return
    detail.value = current
    message.value = 'Đã nhận hồ sơ để xử lý.'
  } catch (error) {
    if (sequence !== loadSequence || props.id !== id) return
    reloadRequired.value = true
    fail(error)
  } finally {
    claiming.value = false
  }
}
onMounted(load)
onBeforeUnmount(() => {
  loadSequence += 1
})
watch(
  () => props.id,
  () => {
    detail.value = null
    failure.value = null
    reloadRequired.value = false
    void load()
  },
)
</script>

<template>
  <section class="intake-page" :class="{ 'intake-page--user': portal === 'user' }">
    <NuxtLink v-if="id" class="intake-back" :to="basePath">← Tiếp nhận hồ sơ</NuxtLink>
    <header class="intake-heading">
      <div>
        <p class="page-eyebrow">Tiếp nhận hồ sơ</p>
        <h1 class="page-title">{{ id ? 'Chi tiết hồ sơ' : 'Hồ sơ gửi đến đơn vị' }}</h1>
        <p class="page-description">
          {{
            id
              ? 'Đối chiếu thông tin và minh chứng đã được sinh viên gửi.'
              : 'Tối đa 50 hồ sơ trong nhóm đang chọn và phạm vi được phân công, theo thời gian gửi sớm nhất.'
          }}
        </p>
      </div>
      <BaseButton
        v-if="!loading && !reloadRequired"
        type="button"
        variant="secondary"
        :loading="claiming"
        @click="load"
        >Tải lại</BaseButton
      >
    </header>
    <div v-if="!id" class="intake-filters" role="group" aria-label="Trạng thái hồ sơ">
      <BaseButton
        type="button"
        :variant="selectedStatus === 'SUBMITTED' ? 'primary' : 'secondary'"
        :aria-pressed="selectedStatus === 'SUBMITTED'"
        :disabled="loading"
        @click="selectStatus('SUBMITTED')"
        >Chờ tiếp nhận</BaseButton
      >
      <BaseButton
        type="button"
        :variant="selectedStatus === 'IN_REVIEW' ? 'primary' : 'secondary'"
        :aria-pressed="selectedStatus === 'IN_REVIEW'"
        :disabled="loading"
        @click="selectStatus('IN_REVIEW')"
        >Đang xử lý</BaseButton
      >
    </div>
    <div v-if="failure" ref="errorSummary" class="intake-error" role="alert" tabindex="-1">
      <strong>{{ failure.message }}</strong>
      <p v-if="detail">
        Thông tin bên dưới là lần tải thành công trước. Tải lại để kiểm tra trạng thái và quyền tiếp
        nhận hiện tại.
      </p>
      <p v-if="reloadRequired">Cần kiểm tra lại trạng thái trước khi thử nhận xử lý lần nữa.</p>
      <p v-if="failure.requestId">Mã hỗ trợ: {{ failure.requestId }}</p>
      <BaseButton type="button" variant="secondary" :loading="loading" @click="load">{{
        reloadRequired ? 'Tải lại trạng thái hồ sơ' : 'Thử lại'
      }}</BaseButton>
      <NuxtLink v-if="failure.status === 401" :to="portal === 'admin' ? '/admin/login' : '/login'"
        >Đăng nhập lại</NuxtLink
      >
    </div>
    <p v-if="loading" class="intake-state" role="status">Đang tải hồ sơ…</p>
    <p v-if="message" class="intake-success" role="status">{{ message }}</p>
    <template v-if="id && detail">
      <article class="intake-panel">
        <header class="intake-heading">
          <h2>{{ detail.serviceName }}</h2>
          <span class="intake-badge" role="status">{{
            submissionStatusLabels[detail.status]
          }}</span>
        </header>
        <dl class="intake-meta">
          <div>
            <dt>Đơn vị xử lý</dt>
            <dd>{{ detail.processingUnitName }}</dd>
          </div>
          <div>
            <dt>Thời gian gửi</dt>
            <dd>
              <time :datetime="detail.submittedAt">{{
                formatSubmissionTime(detail.submittedAt)
              }}</time>
            </dd>
          </div>
          <div>
            <dt>Cán bộ nhận xử lý</dt>
            <dd>{{ detail.reviewerName ?? 'Chưa có người nhận' }}</dd>
          </div>
          <div v-if="detail.reviewStartedAt">
            <dt>Bắt đầu xử lý</dt>
            <dd>
              <time :datetime="detail.reviewStartedAt">{{
                formatSubmissionTime(detail.reviewStartedAt)
              }}</time>
            </dd>
          </div>
        </dl>
        <BaseButton
          v-if="detail.canClaim && detail.status === 'SUBMITTED'"
          type="button"
          :loading="claiming"
          :disabled="loading || reloadRequired"
          @click="claim"
          >Nhận xử lý</BaseButton
        >
        <p v-else-if="detail.status === 'SUBMITTED'" class="intake-help">
          Bạn hiện không thể nhận xử lý hồ sơ này.
        </p>
      </article>
      <div class="intake-columns">
        <article class="intake-panel">
          <h2>Thông tin sinh viên khi gửi</h2>
          <dl class="intake-meta">
            <div>
              <dt>Họ và tên</dt>
              <dd>{{ detail.studentSnapshot.fullName }}</dd>
            </div>
            <div>
              <dt>Mã sinh viên</dt>
              <dd>{{ detail.studentSnapshot.studentCode }}</dd>
            </div>
            <div>
              <dt>Lớp</dt>
              <dd>{{ detail.studentSnapshot.classCode }}</dd>
            </div>
            <div>
              <dt>Khoa</dt>
              <dd>{{ detail.studentSnapshot.facultyCode }}</dd>
            </div>
          </dl>
          <h2>Thông tin kê khai</h2>
          <p class="intake-help">
            Biểu mẫu v{{ detail.procedure.versionNumber }} · Thông tin được giữ nguyên từ khi gửi.
          </p>
          <dl class="intake-answers">
            <div v-for="field in detail.procedure.fields" :key="field.key">
              <dt>{{ field.label }}</dt>
              <dd>{{ formatSubmissionAnswer(field, detail.values) }}</dd>
            </div>
          </dl>
        </article>
        <aside class="intake-panel">
          <h2>Minh chứng đã gửi</h2>
          <p class="intake-warning">
            Chữ ký chưa được xác minh. Hình dấu đỏ hoặc chữ ký trên tệp không phải kết quả xác minh
            chữ ký số.
          </p>
          <p v-if="!detail.files.length" class="intake-help">Hồ sơ không có tệp minh chứng.</p>
          <ul v-else class="intake-files">
            <li v-for="file in detail.files" :key="file.id">
              <strong>{{
                detail.procedure.attachments.find(
                  (attachment) => attachment.key === file.attachmentKey,
                )?.label ?? 'Minh chứng'
              }}</strong>
              <a :href="api.downloadUrl(detail.id, file.id)">{{ file.name }}</a>
              <small>{{ (file.size / 1024).toFixed(1) }} KiB · Chữ ký chưa được xác minh</small>
            </li>
          </ul>
          <h3>Hướng dẫn của đơn vị</h3>
          <p class="intake-instructions">{{ detail.procedure.contactInstructions }}</p>
        </aside>
      </div>
    </template>
    <template v-else-if="!id && !loading && !failure">
      <div v-if="!entries.length" class="intake-panel intake-empty">
        <h2>
          {{
            selectedStatus === 'SUBMITTED'
              ? 'Chưa có hồ sơ chờ tiếp nhận'
              : 'Chưa có hồ sơ đang xử lý'
          }}
        </h2>
        <p>Nhóm đang chọn chưa có hồ sơ trong phạm vi được phân công.</p>
      </div>
      <ul v-else class="intake-list">
        <li v-for="entry in entries" :key="entry.id">
          <NuxtLink :to="basePath + '/' + entry.id">
            <span class="intake-badge">{{ submissionStatusLabels[entry.status] }}</span>
            <h2>{{ entry.serviceName }}</h2>
            <p>
              <strong>{{ entry.student.fullName }}</strong> · {{ entry.student.studentCode }}
            </p>
            <dl class="intake-meta">
              <div>
                <dt>Đã gửi</dt>
                <dd>
                  <time :datetime="entry.submittedAt">{{
                    formatSubmissionTime(entry.submittedAt)
                  }}</time>
                </dd>
              </div>
              <div>
                <dt>Đơn vị xử lý</dt>
                <dd>{{ entry.processingUnitName }}</dd>
              </div>
              <div>
                <dt>Cán bộ nhận xử lý</dt>
                <dd>{{ entry.reviewerName ?? 'Chưa có người nhận' }}</dd>
              </div>
            </dl>
            <b>Xem hồ sơ →</b>
          </NuxtLink>
        </li>
      </ul>
    </template>
  </section>
</template>

<style scoped>
.intake-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.intake-page {
  display: grid;
  gap: 24px;
  overflow-wrap: anywhere;
}
.intake-page--user {
  width: min(var(--container-width), calc(100% - 56px));
  margin: 0 auto;
}
.intake-back {
  color: var(--color-primary);
  font-weight: 700;
  min-height: 44px;
  display: inline-flex;
  align-items: center;
}
.intake-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
}
.intake-heading h2 {
  margin: 0;
}
.intake-heading > div {
  min-width: 0;
}
.intake-heading .page-description {
  margin-bottom: 0;
}
.intake-panel,
.intake-list a {
  padding: 26px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  min-width: 0;
}
.intake-panel h2 {
  font-size: 21px;
}
.intake-panel h3 {
  font-size: 17px;
  margin-top: 24px;
}
.intake-columns {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
  gap: 24px;
  align-items: start;
}
.intake-meta {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
  margin: 24px 0;
}
.intake-meta dt,
.intake-answers dt,
.intake-help {
  color: var(--color-muted);
  font-size: 14px;
  line-height: 1.65;
}
.intake-meta dd,
.intake-answers dd {
  margin: 6px 0 0;
  white-space: pre-wrap;
  line-height: 1.65;
}
.intake-answers > div {
  padding: 14px 0;
  border-bottom: 1px solid var(--color-border);
}
.intake-instructions {
  white-space: pre-wrap;
  line-height: 1.65;
}
.intake-badge {
  display: inline-flex;
  align-self: flex-start;
  padding: 8px 12px;
  border-radius: 999px;
  color: var(--color-primary);
  background: var(--color-primary-soft);
  font-size: 13px;
  font-weight: 700;
}
.intake-error,
.intake-warning,
.intake-success {
  padding: 16px;
  border-radius: var(--radius-sm);
  line-height: 1.65;
}
.intake-error {
  color: var(--color-error);
  background: var(--color-error-background);
}
.intake-error a {
  display: inline-flex;
  margin: 12px;
  color: inherit;
}
.intake-warning {
  color: var(--color-warning);
  background: var(--color-warning-background);
}
.intake-success {
  color: var(--color-success);
  background: var(--color-success-background);
}
.intake-state,
.intake-empty {
  padding: 32px;
}
.intake-list,
.intake-files {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 20px;
}
.intake-list {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.intake-list a {
  display: block;
  color: var(--color-text);
  text-decoration: none;
  height: 100%;
}
.intake-list a:hover {
  border-color: var(--color-primary);
}
.intake-list h2 {
  font-size: 20px;
  margin: 18px 0 12px;
}
.intake-list b,
.intake-files a {
  color: var(--color-primary);
}
.intake-files li {
  display: grid;
  gap: 10px;
  padding: 16px;
  border-radius: var(--radius-sm);
  background: var(--color-surface-subtle);
}
.intake-files a {
  min-height: 44px;
  display: inline-flex;
  align-items: center;
}
.intake-files small {
  color: var(--color-warning);
}
@media (max-width: 850px) {
  .intake-columns,
  .intake-list {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 640px) {
  .intake-page--user {
    width: calc(100% - 32px);
  }
  .intake-heading {
    flex-direction: column;
  }
  .intake-panel,
  .intake-list a {
    padding: 20px;
  }
  .intake-meta {
    grid-template-columns: 1fr;
    gap: 16px;
  }
}
</style>
