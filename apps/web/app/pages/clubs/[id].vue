<script setup lang="ts">
import type { ClubDetail, ClubStatus } from '~/types/club'
import type { TrainingError } from '~/types/training-point'
import { clubStatusLabels, clubTransitionLabels, clubTransitions } from '~/types/club'
definePageMeta({ middleware: 'user-auth' })
const route = useRoute(),
  api = useClubs(),
  club = ref<ClubDetail | null>(null),
  busy = ref(false),
  error = ref<TrainingError | null>(null),
  message = ref(''),
  edit = reactive({ name: '', description: '' }),
  status = ref<ClubStatus | ''>(''),
  reason = ref(''),
  leaderUsername = ref(''),
  ending = ref(''),
  endReason = ref('')
let generation = 0
function set(c: ClubDetail) {
  club.value = c
  edit.name = c.name
  edit.description = c.description
  status.value = ''
  reason.value = ''
  ending.value = ''
  endReason.value = ''
}
async function run(fn: (g: number) => Promise<void>, done = '') {
  if (busy.value) return
  const g = ++generation
  busy.value = true
  error.value = null
  message.value = ''
  try {
    await fn(g)
    if (g === generation) message.value = done
  } catch (e) {
    if (g !== generation) return
    error.value = e as TrainingError
    if ([401, 403, 404].includes(error.value.status ?? 0)) club.value = null
  } finally {
    if (g === generation) busy.value = false
  }
}
const id = () => String(route.params.id).toLowerCase()
const load = () =>
  run(async (g) => {
    const c = await api.detail(id())
    if (g === generation) set(c)
  })
const save = () =>
  run(async (g) => {
    const c = await api.update(id(), { expectedRevision: club.value!.revision, ...edit })
    if (g === generation) set(c)
  }, 'Đã lưu thông tin CLB.')
function changeStatus() {
  const next = status.value
  if (!next) return
  if (next === 'DISSOLVED' && !window.confirm('Giải thể là thao tác cuối cùng. Tiếp tục?')) return
  return run(async (g) => {
    const c = await api.changeStatus(id(), {
      expectedRevision: club.value!.revision,
      status: next,
      reason: reason.value,
    })
    if (g === generation) set(c)
  }, 'Đã cập nhật trạng thái CLB.')
}
const assign = () =>
  run(async (g) => {
    const c = await api.assignLeader(id(), leaderUsername.value)
    if (g === generation) {
      set(c)
      leaderUsername.value = ''
    }
  }, 'Đã gán người phụ trách.')
const end = () =>
  run(async (g) => {
    const c = await api.endLeader(id(), ending.value, endReason.value)
    if (g === generation) set(c)
  }, 'Đã kết thúc nhiệm kỳ.')
watch(() => route.params.id, load)
onMounted(load)
onBeforeUnmount(() => {
  generation++
})
const editable = computed(() => !!club.value?.canManage && club.value.status !== 'DISSOLVED')
</script>
<template>
  <section class="training-workspace training-workspace--student">
    <header>
      <NuxtLink to="/clubs">← Danh sách CLB</NuxtLink>
      <p class="page-eyebrow">Câu lạc bộ</p>
      <h1 class="page-title">{{ club ? club.name : 'CLB' }}</h1>
    </header>
    <div v-if="error" class="tp-notice tp-notice--error" role="alert">{{ error.message }}</div>
    <p v-if="message" class="tp-notice" role="status">{{ message }}</p>
    <p v-if="busy && !club" role="status">Đang tải CLB…</p>
    <template v-if="club">
      <section class="tp-panel" aria-labelledby="club-info-title">
        <h2 id="club-info-title">Thông tin</h2>
        <p>
          Mã <strong>{{ club.code }}</strong> · {{ clubStatusLabels[club.status] }}
        </p>
        <p v-if="club.statusReason" class="tp-muted">Lý do trạng thái: {{ club.statusReason }}</p>
        <template v-if="editable">
          <label class="tp-field" for="club-edit-name"
            >Tên CLB<input id="club-edit-name" v-model="edit.name" maxlength="255" :disabled="busy"
          /></label>
          <label class="tp-field" for="club-edit-description"
            >Mô tả<textarea
              id="club-edit-description"
              v-model="edit.description"
              rows="3"
              maxlength="2000"
              :disabled="busy"
            />
          </label>
          <div class="tp-actions">
            <BaseButton :disabled="busy || !edit.name.trim()" @click="save"
              >Lưu thông tin</BaseButton
            >
          </div>
        </template>
        <p v-else>{{ club.description || 'Chưa có mô tả.' }}</p>
      </section>
      <section v-if="editable" class="tp-panel" aria-labelledby="club-status-title">
        <h2 id="club-status-title">Trạng thái</h2>
        <div class="tp-grid">
          <label class="tp-field" for="club-status"
            >Thao tác<select id="club-status" v-model="status" :disabled="busy">
              <option value="">Chọn thao tác</option>
              <option v-for="s in clubTransitions[club.status]" :key="s" :value="s">
                {{ clubTransitionLabels[s] }}
              </option>
            </select></label
          >
          <label class="tp-field" for="club-status-reason"
            >Lý do (bắt buộc)<input
              id="club-status-reason"
              v-model="reason"
              maxlength="500"
              :disabled="busy"
          /></label>
        </div>
        <p class="tp-muted">
          CLB tạm dừng hoặc đã giải thể không mở được hoạt động mới. Giải thể kết thúc mọi nhiệm kỳ
          người phụ trách và không mở lại được.
        </p>
        <div class="tp-actions">
          <BaseButton :disabled="busy || !status || !reason.trim()" @click="changeStatus">
            Cập nhật trạng thái</BaseButton
          >
        </div>
      </section>
      <section class="tp-panel" aria-labelledby="club-leaders-title">
        <h2 id="club-leaders-title">Người phụ trách</h2>
        <div v-if="editable" class="tp-grid">
          <label class="tp-field" for="club-leader"
            >Tên đăng nhập người phụ trách<input
              id="club-leader"
              v-model="leaderUsername"
              maxlength="100"
              autocomplete="off"
              :disabled="busy"
          /></label>
          <div class="tp-actions">
            <BaseButton :disabled="busy || !leaderUsername.trim()" @click="assign">
              Gán người phụ trách</BaseButton
            >
          </div>
        </div>
        <p v-if="!club.leaders.length">Chưa có người phụ trách.</p>
        <ul class="tp-files">
          <li v-for="l in club.leaders" :key="l.id">
            <h3>{{ l.fullName }} · {{ l.username }}</h3>
            <p>
              {{ l.status === 'ACTIVE' ? 'Đang phụ trách' : 'Đã kết thúc' }} · từ
              {{ new Date(l.validFrom).toLocaleDateString('vi-VN') }}
              <span v-if="l.validTo">
                đến {{ new Date(l.validTo).toLocaleDateString('vi-VN') }}</span
              >
              <span v-if="l.endReason"> · {{ l.endReason }}</span>
            </p>
            <BaseButton
              v-if="editable && l.status === 'ACTIVE' && ending !== l.id"
              variant="secondary"
              :disabled="busy"
              @click="ending = l.id"
            >
              Kết thúc nhiệm kỳ {{ l.username }}</BaseButton
            >
            <div v-if="ending === l.id" class="tp-grid">
              <label class="tp-field" :for="'end-reason-' + l.id"
                >Lý do kết thúc (bắt buộc)<input
                  :id="'end-reason-' + l.id"
                  v-model="endReason"
                  maxlength="500"
                  :disabled="busy"
              /></label>
              <div class="tp-actions">
                <BaseButton :disabled="busy || !endReason.trim()" @click="end">
                  Xác nhận kết thúc</BaseButton
                ><BaseButton variant="secondary" :disabled="busy" @click="ending = ''">
                  Hủy</BaseButton
                >
              </div>
            </div>
          </li>
        </ul>
      </section>
    </template>
  </section>
</template>
<style src="~/assets/css/training.css"></style>
