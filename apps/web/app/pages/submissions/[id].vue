<script setup lang="ts">
import type { StudentDraft } from '~/types/submission'
definePageMeta({ middleware: 'user-auth' })
const route = useRoute()
const { user } = useUserAuth()
const api = useSubmissions()
const draft = ref<StudentDraft | null>(null)
const loading = ref(true)
const failure = ref('')
async function load() {
  loading.value = true
  failure.value = ''
  try {
    draft.value = await api.get(String(route.params.id))
  } catch (e) {
    failure.value = (e as { message?: string }).message ?? 'Không tải được bản nháp.'
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
    <NuxtLink to="/submissions" class="draft-back">← Thủ tục của tôi</NuxtLink>
    <p v-if="!user?.roles.includes('STUDENT')" role="alert">Chức năng này dành cho sinh viên.</p>
    <p v-else-if="loading" role="status">Đang tải bản nháp…</p>
    <div v-else-if="failure" role="alert">
      <p>{{ failure }}</p>
      <BaseButton @click="load">Thử lại</BaseButton>
    </div>
    <StudentDraftEditor v-else-if="draft" :initial-draft="draft" />
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
.draft-back {
  display: inline-block;
  color: var(--color-primary);
  margin-bottom: 20px;
  text-decoration: none;
  font-weight: 700;
}
</style>
