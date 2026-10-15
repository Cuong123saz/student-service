<script setup lang="ts">
import type { TrainingPeriod, TrainingError } from '~/types/training-point'
import { trainingStatuses, trainingDate } from '~/utils/training-point'
definePageMeta({ middleware: 'user-auth' })
const api = useTrainingPoints(),
  items = ref<TrainingPeriod[] | null>(null),
  busy = ref(false),
  error = ref<TrainingError | null>(null),
  truncated = ref(false)
let generation = 0
async function run(action: () => Promise<void>) {
  if (busy.value) return
  busy.value = true
  const g = ++generation
  error.value = null
  try {
    await action()
  } catch (e) {
    if (g !== generation) return
    error.value = e as TrainingError
    if ([401, 403].includes(error.value.status ?? 0)) items.value = null
  } finally {
    if (g === generation) busy.value = false
  }
}
async function load() {
  await run(async () => {
    const result = await api.list()
    items.value = result.items
    truncated.value = result.truncated
  })
}
async function start(p: TrainingPeriod) {
  await run(async () => {
    const d = await api.start(p.id)
    await navigateTo('/training-points/' + d.id)
  })
}
onBeforeUnmount(() => {
  generation++
})
onMounted(load)
</script>
<template>
  <section class="training-workspace training-workspace--student">
    <header>
      <NuxtLink to="/portal">← Cổng của tôi</NuxtLink>
      <p class="page-eyebrow">Theo học kỳ</p>
      <h1 class="page-title">Điểm rèn luyện của tôi</h1>
      <p class="page-description">
        Kê khai năm nhóm A–E, bổ sung minh chứng và xem lịch sử đã nộp.
      </p>
    </header>
    <p class="tp-notice">
      Điểm sinh viên tự kê khai được giữ riêng. Xem kết quả xét duyệt trong từng bản; bộ tiêu chí
      giả chưa tạo xếp loại chính thức.
    </p>
    <div v-if="error" class="tp-notice tp-notice--error" role="alert">
      <p>{{ error.message }}</p>
      <NuxtLink v-if="error.status === 401" to="/login">Đăng nhập lại</NuxtLink
      ><BaseButton v-else variant="secondary" :disabled="busy" @click="load">Tải lại</BaseButton>
    </div>
    <p v-if="busy" role="status">Đang tải…</p>
    <p v-if="items && !items.length" class="tp-panel">Chưa có đợt đánh giá dành cho lớp của bạn.</p>
    <div v-if="items" class="tp-grid">
      <article v-for="p in items" :key="p.id" class="tp-panel">
        <h2>{{ p.name }}</h2>
        <p>
          {{ p.academicYear }} ·
          {{ p.semester === 'SUMMER' ? 'Học kỳ hè' : 'Học kỳ ' + p.semester }} ·
          {{ trainingStatuses[p.status] }}
        </p>
        <p class="tp-muted">{{ trainingDate(p.startsAt) }} – {{ trainingDate(p.endsAt) }}</p>
        <p class="tp-muted">{{ p.policyLabel }}</p>
        <p v-if="p.declarationState">
          Bản kê khai: {{ p.declarationState === 'SUBMITTED' ? 'Đã nộp' : 'Bản nháp' }}
        </p>
        <div class="tp-actions">
          <NuxtLink v-if="p.declarationId" :to="'/training-points/' + p.declarationId">{{
            p.declarationState === 'SUBMITTED' ? 'Xem bản đã nộp' : 'Tiếp tục kê khai'
          }}</NuxtLink
          ><BaseButton
            v-else
            :disabled="
              busy ||
              p.status !== 'OPEN' ||
              Date.now() < Date.parse(p.startsAt) ||
              Date.now() >= Date.parse(p.endsAt)
            "
            @click="start(p)"
            >Bắt đầu kê khai</BaseButton
          >
        </div>
      </article>
    </div>
    <p v-if="truncated" class="tp-muted">Đang hiển thị 200 đợt gần nhất.</p>
  </section>
</template>
<style src="~/assets/css/training.css"></style>
