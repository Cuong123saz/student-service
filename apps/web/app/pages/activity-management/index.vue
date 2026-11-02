<script setup lang="ts">
import type {
  Activity,
  ActivityDraft,
  ActivityKind,
  ActivityOptions,
  MandatoryOwner,
} from '~/types/activity'
import type { TrainingError } from '~/types/training-point'
import { activityKindLabels, activityOwnerLabels, activityStatusLabels } from '~/types/activity'
import { activityOrganizer, formatActivityTime } from '~/utils/activity'
definePageMeta({ middleware: 'user-auth' })
const api = useActivities(),
  items = ref<Activity[] | null>(null),
  options = ref<ActivityOptions | null>(null),
  busy = ref(false),
  error = ref<TrainingError | null>(null),
  kind = ref<ActivityKind>('MANDATORY'),
  owner = ref<MandatoryOwner | ''>(''),
  clubId = ref(''),
  draft = ref<ActivityDraft>(blank())
function blank(): ActivityDraft {
  return {
    category: 'SCHOOL',
    title: '',
    description: '',
    location: '',
    startsAt: '',
    endsAt: '',
    capacity: 50,
    eligibility: { facultyIds: [], classIds: [], cohortYears: [] },
  }
}
const canMandatory = computed(() => !!options.value?.mandatoryOwners.length),
  canVoluntary = computed(() => !!options.value?.leaderClubs.length),
  ready = computed(
    () =>
      !!draft.value.title.trim() &&
      !!draft.value.location.trim() &&
      !!draft.value.startsAt &&
      !!draft.value.endsAt &&
      (kind.value === 'MANDATORY' || !!clubId.value),
  )
async function run(fn: () => Promise<void>) {
  if (busy.value) return
  busy.value = true
  error.value = null
  try {
    await fn()
  } catch (e) {
    error.value = e as TrainingError
    if ([401, 403].includes(error.value.status ?? 0)) items.value = null
  } finally {
    busy.value = false
  }
}
const load = () =>
  run(async () => {
    const [list, opts] = await Promise.all([api.list(), api.options()])
    items.value = list.items
    options.value = opts
    kind.value = opts.mandatoryOwners.length ? 'MANDATORY' : 'VOLUNTARY'
    owner.value = opts.mandatoryOwners[0] ?? ''
    clubId.value = opts.leaderClubs[0]?.id ?? ''
    if (!opts.mandatoryOwners.length) draft.value.category = 'CLUB_ACADEMIC'
  })
const create = () =>
  run(async () => {
    const a = await api.create({
      ...draft.value,
      kind: kind.value,
      ...(kind.value === 'MANDATORY' && owner.value ? { ownerType: owner.value } : {}),
      ...(kind.value === 'VOLUNTARY' ? { clubId: clubId.value } : {}),
    })
    await navigateTo('/activity-management/' + a.id)
  })
onMounted(load)
</script>
<template>
  <section class="training-workspace training-workspace--student">
    <header>
      <NuxtLink to="/portal">← Cổng của tôi</NuxtLink>
      <p class="page-eyebrow">CTSV, Phòng Đào tạo và CLB</p>
      <h1 class="page-title">Quản lý hoạt động ngoại khóa</h1>
      <p class="page-description">
        Hoạt động bắt buộc do CTSV hoặc Phòng Đào tạo tạo và có thể giao CLB thực hiện. CLB tự mở
        hoạt động tự nguyện, không cần duyệt trước; CTSV có thể tạm dừng khi phát hiện sai.
      </p>
    </header>
    <div v-if="error" class="tp-notice tp-notice--error" role="alert">{{ error.message }}</div>
    <p v-if="busy && !items" role="status">Đang tải hoạt động…</p>
    <section
      v-if="options && (canMandatory || canVoluntary)"
      class="tp-panel"
      aria-labelledby="activity-create-title"
    >
      <h2 id="activity-create-title">Tạo hoạt động</h2>
      <div class="tp-grid">
        <label class="tp-field" for="activity-kind"
          >Loại<select id="activity-kind" v-model="kind" :disabled="busy">
            <option v-if="canMandatory" value="MANDATORY">
              {{ activityKindLabels.MANDATORY }}
            </option>
            <option v-if="canVoluntary" value="VOLUNTARY">
              {{ activityKindLabels.VOLUNTARY }}
            </option>
          </select></label
        >
        <label
          v-if="kind === 'MANDATORY' && options.mandatoryOwners.length > 1"
          class="tp-field"
          for="activity-owner"
          >Đơn vị chủ trì<select id="activity-owner" v-model="owner" :disabled="busy">
            <option v-for="o in options.mandatoryOwners" :key="o" :value="o">
              {{ activityOwnerLabels[o] }}
            </option>
          </select></label
        >
        <label v-if="kind === 'VOLUNTARY'" class="tp-field" for="activity-club"
          >CLB<select id="activity-club" v-model="clubId" :disabled="busy">
            <option v-for="c in options.leaderClubs" :key="c.id" :value="c.id">
              {{ c.code }} · {{ c.name }}
            </option>
          </select></label
        >
      </div>
      <ActivityForm v-model="draft" :options="options" :disabled="busy" id-prefix="new-activity" />
      <div class="tp-actions">
        <BaseButton :disabled="busy || !ready" @click="create">Tạo bản nháp</BaseButton>
      </div>
    </section>
    <section v-if="items" class="tp-panel" aria-labelledby="activity-list-title">
      <h2 id="activity-list-title">Hoạt động</h2>
      <p v-if="!items.length">Chưa có hoạt động nào.</p>
      <ul class="tp-files">
        <li v-for="a in items" :key="a.id">
          <h3>{{ a.title }}</h3>
          <p>
            {{ activityStatusLabels[a.status] }} · {{ activityKindLabels[a.kind] }} ·
            {{ activityOrganizer(a) }}
          </p>
          <p>{{ formatActivityTime(a.startsAt) }} · {{ a.location }}</p>
          <NuxtLink class="button button--secondary" :to="'/activity-management/' + a.id"
            >Xem {{ a.title }}</NuxtLink
          >
        </li>
      </ul>
    </section>
  </section>
</template>
<style src="~/assets/css/training.css"></style>
