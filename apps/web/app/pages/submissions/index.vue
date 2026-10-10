<script setup lang="ts">
import { formatSubmissionTime, submissionStatusLabels } from '~/utils/submission'
import type { DraftSummary } from '~/types/submission'
definePageMeta({ middleware: 'user-auth' })
const api = useSubmissions()
const { user } = useUserAuth()
const drafts = ref<DraftSummary[]>([])
const loading = ref(true)
const failure = ref('')
async function load() {
  loading.value = true
  failure.value = ''
  try {
    drafts.value = await api.list()
  } catch (e) {
    failure.value = (e as { message?: string }).message ?? 'Không tải được hồ sơ.'
  } finally {
    loading.value = false
  }
}
onMounted(() => {
  if (user.value?.roles.includes('STUDENT')) void load()
  else loading.value = false
})
</script>
<template>
  <section class="submission-page">
    <p class="page-eyebrow">Cổng sinh viên</p>
    <h1 class="page-title">Thủ tục của tôi</h1>
    <p class="page-description">
      Theo dõi bản nháp, hồ sơ đã gửi và tình trạng xử lý. Hiển thị tối đa 50 hồ sơ được cập nhật
      gần nhất.
    </p>
    <p v-if="!user?.roles.includes('STUDENT')" role="alert">Chức năng này dành cho sinh viên.</p>
    <p v-else-if="loading" role="status">Đang tải hồ sơ…</p>
    <div v-else-if="failure" role="alert">
      <p>{{ failure }}</p>
      <BaseButton @click="load">Thử lại</BaseButton>
    </div>
    <div v-else-if="!drafts.length" class="draft-empty">
      <h2>Bạn chưa có hồ sơ</h2>
      <p>Chọn một dịch vụ có biểu mẫu trực tuyến để bắt đầu kê khai.</p>
      <NuxtLink to="/services">Xem dịch vụ sinh viên →</NuxtLink>
    </div>
    <ul v-else class="draft-list">
      <li v-for="draft in drafts" :key="draft.id">
        <NuxtLink :to="'/submissions/' + draft.id">
          <strong>{{ draft.serviceName }}</strong>
          <span>{{ submissionStatusLabels[draft.status] }}</span>
          <small v-if="draft.roundNumber">Lần gửi {{ draft.roundNumber }}</small>
          <small v-if="draft.lastSubmittedAt"
            >Gửi gần nhất {{ formatSubmissionTime(draft.lastSubmittedAt) }}</small
          >
          <small v-if="draft.decisionAt"
            >Quyết định nội dung {{ formatSubmissionTime(draft.decisionAt) }}</small
          >
          <small v-if="draft.submittedAt"
            >Đã gửi {{ formatSubmissionTime(draft.submittedAt) }}</small
          >
          <small v-if="draft.reviewStartedAt"
            >Bắt đầu xử lý {{ formatSubmissionTime(draft.reviewStartedAt) }}</small
          >
          <small>Cập nhật {{ new Date(draft.updatedAt).toLocaleString('vi-VN') }}</small>
          <b>{{
            draft.status === 'DRAFT'
              ? 'Tiếp tục kê khai →'
              : draft.status === 'NEEDS_SUPPLEMENT'
                ? 'Bổ sung hồ sơ →'
                : 'Xem hồ sơ đã gửi →'
          }}</b>
        </NuxtLink>
      </li>
    </ul>
  </section>
</template>
<style scoped>
.submission-page {
  width: min(var(--container-width), calc(100% - 56px));
  margin: 0 auto;
}
@media (max-width: 640px) {
  .submission-page {
    width: calc(100% - 32px);
  }
}
.draft-empty {
  padding: 28px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}
.draft-list {
  list-style: none;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
}
.draft-list a {
  display: grid;
  gap: 12px;
  padding: 24px;
  text-decoration: none;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  overflow-wrap: anywhere;
}
.draft-list a:hover {
  border-color: var(--color-primary);
}
.draft-list span,
.draft-list small {
  color: var(--color-muted);
}
.draft-list b,
.draft-empty a {
  color: var(--color-primary);
}
@media (max-width: 640px) {
  .draft-list {
    grid-template-columns: 1fr;
  }
}
</style>
