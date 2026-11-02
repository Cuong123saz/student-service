<script setup lang="ts">
import type { StudentActivity } from '~/types/activity'
import type { TrainingError } from '~/types/training-point'
import { activityCategoryLabels, activityKindLabels } from '~/types/activity'
import { activityOrganizer, formatActivityTime } from '~/utils/activity'
definePageMeta({ middleware: 'user-auth' })
const api = useActivities(),
  items = ref<StudentActivity[] | null>(null),
  truncated = ref(false),
  busy = ref(false),
  error = ref<TrainingError | null>(null)
async function load() {
  busy.value = true
  error.value = null
  try {
    const r = await api.available()
    items.value = r.items
    truncated.value = r.truncated
  } catch (e) {
    error.value = e as TrainingError
    items.value = null
  } finally {
    busy.value = false
  }
}
onMounted(load)
</script>
<template>
  <section class="training-workspace training-workspace--student">
    <header>
      <NuxtLink to="/portal">← Cổng của tôi</NuxtLink>
      <p class="page-eyebrow">Sinh viên</p>
      <h1 class="page-title">Hoạt động ngoại khóa</h1>
      <p class="page-description">
        Chỉ hiển thị hoạt động đã công bố, chưa kết thúc và bạn thuộc đối tượng. Đăng ký sẽ mở ở
        bước tiếp theo của hệ thống.
      </p>
    </header>
    <div v-if="error" class="tp-notice tp-notice--error" role="alert">{{ error.message }}</div>
    <p v-if="busy" role="status">Đang tải hoạt động…</p>
    <section v-if="items" class="tp-panel" aria-labelledby="available-title">
      <h2 id="available-title">Hoạt động dành cho bạn</h2>
      <p v-if="!items.length">Hiện chưa có hoạt động phù hợp.</p>
      <ul class="tp-files">
        <li v-for="a in items" :key="a.id">
          <h3>{{ a.title }}</h3>
          <p>
            {{ activityKindLabels[a.kind] }} · {{ activityCategoryLabels[a.category] }} ·
            {{ activityOrganizer(a) }}
          </p>
          <p>
            {{ formatActivityTime(a.startsAt) }} – {{ formatActivityTime(a.endsAt) }} ·
            {{ a.location }} ·
            {{ a.capacity === null ? 'Không giới hạn' : 'Tối đa ' + a.capacity + ' người' }}
          </p>
          <p v-if="a.description" class="tp-muted">{{ a.description }}</p>
        </li>
      </ul>
      <p v-if="truncated" class="tp-muted">Chỉ hiển thị 200 hoạt động gần nhất.</p>
    </section>
  </section>
</template>
<style src="~/assets/css/training.css"></style>
