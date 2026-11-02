<script setup lang="ts">
import type { ClubList } from '~/types/club'
import type { TrainingError } from '~/types/training-point'
import { clubStatusLabels } from '~/types/club'
definePageMeta({ middleware: 'user-auth' })
const api = useClubs(),
  clubs = ref<ClubList | null>(null),
  busy = ref(false),
  error = ref<TrainingError | null>(null),
  form = reactive({ code: '', name: '', description: '' })
async function run(fn: () => Promise<void>) {
  if (busy.value) return
  busy.value = true
  error.value = null
  try {
    await fn()
  } catch (e) {
    error.value = e as TrainingError
    if ([401, 403].includes(error.value.status ?? 0)) clubs.value = null
  } finally {
    busy.value = false
  }
}
const load = () =>
  run(async () => {
    clubs.value = await api.list()
  })
const create = () =>
  run(async () => {
    const club = await api.create({ ...form })
    await navigateTo('/clubs/' + club.id)
  })
onMounted(load)
</script>
<template>
  <section class="training-workspace training-workspace--student">
    <header>
      <NuxtLink to="/portal">← Cổng của tôi</NuxtLink>
      <p class="page-eyebrow">CTSV, Phòng Đào tạo và người phụ trách</p>
      <h1 class="page-title">Câu lạc bộ</h1>
      <p class="page-description">
        CLB được CTSV tạo sau khi đã duyệt bên ngoài hệ thống. Tạm dừng hoặc giải thể CLB không làm
        mất chứng nhận đã cấp.
      </p>
    </header>
    <div v-if="error" class="tp-notice tp-notice--error" role="alert">{{ error.message }}</div>
    <p v-if="busy && !clubs" role="status">Đang tải danh sách CLB…</p>
    <section v-if="clubs?.canManage" class="tp-panel" aria-labelledby="club-create-title">
      <h2 id="club-create-title">Tạo CLB</h2>
      <div class="tp-grid">
        <label class="tp-field" for="club-code"
          >Mã CLB<input
            id="club-code"
            v-model="form.code"
            maxlength="50"
            autocomplete="off"
            :disabled="busy"
        /></label>
        <label class="tp-field" for="club-name"
          >Tên CLB<input id="club-name" v-model="form.name" maxlength="255" :disabled="busy"
        /></label>
      </div>
      <label class="tp-field" for="club-description"
        >Mô tả<textarea
          id="club-description"
          v-model="form.description"
          rows="3"
          maxlength="2000"
          :disabled="busy"
        />
      </label>
      <p class="tp-muted">Mã gồm chữ in hoa, số, “-” hoặc “_”, ví dụ DOIMAU.</p>
      <div class="tp-actions">
        <BaseButton :disabled="busy || !form.code.trim() || !form.name.trim()" @click="create">
          Tạo CLB</BaseButton
        >
      </div>
    </section>
    <section v-if="clubs" class="tp-panel" aria-labelledby="club-list-title">
      <h2 id="club-list-title">Danh sách CLB</h2>
      <p v-if="!clubs.items.length">Chưa có CLB nào.</p>
      <ul class="tp-files">
        <li v-for="c in clubs.items" :key="c.id">
          <h3>{{ c.name }} · {{ c.code }}</h3>
          <p>
            {{ clubStatusLabels[c.status] }} · {{ c.activeLeaders }} người phụ trách<span
              v-if="c.isLeader"
            >
              · Bạn đang phụ trách</span
            >
          </p>
          <NuxtLink class="button button--secondary" :to="'/clubs/' + c.id"
            >Xem {{ c.code }}</NuxtLink
          >
        </li>
      </ul>
      <p v-if="clubs.truncated" class="tp-muted">Chỉ hiển thị 500 CLB đầu.</p>
    </section>
  </section>
</template>
<style src="~/assets/css/training.css"></style>
