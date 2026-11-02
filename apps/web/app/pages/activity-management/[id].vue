<script setup lang="ts">
import type { ActivityDetail, ActivityDraft, ActivityOptions } from '~/types/activity'
import type { TrainingError } from '~/types/training-point'
import type { ActivityTransition } from '~/composables/useActivities'
import {
  activityCategoryLabels,
  activityEventLabels,
  activityKindLabels,
  activityStatusLabels,
} from '~/types/activity'
import { activityOrganizer, formatActivityTime } from '~/utils/activity'
import { formatCohort } from '~/utils/cohort'
definePageMeta({ middleware: 'user-auth' })
const route = useRoute(),
  api = useActivities(),
  activity = ref<ActivityDetail | null>(null),
  options = ref<ActivityOptions | null>(null),
  draft = ref<ActivityDraft | null>(null),
  busy = ref(false),
  error = ref<TrainingError | null>(null),
  message = ref(''),
  reason = ref(''),
  delegateTo = ref(''),
  delegateReason = ref(''),
  formKey = ref(0)
let generation = 0
function set(a: ActivityDetail) {
  activity.value = a
  draft.value = {
    category: a.category,
    title: a.title,
    description: a.description,
    location: a.location,
    startsAt: a.startsAt,
    endsAt: a.endsAt,
    capacity: a.capacity,
    eligibility: structuredClone(toRaw(a.eligibility)),
  }
  formKey.value++
  reason.value = ''
  delegateTo.value = a.delegatedClub?.id ?? ''
  delegateReason.value = ''
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
    if ([401, 403, 404].includes(error.value.status ?? 0)) activity.value = null
  } finally {
    if (g === generation) busy.value = false
  }
}
const id = () => String(route.params.id).toLowerCase()
const load = () =>
  run(async (g) => {
    const [a, o] = await Promise.all([api.detail(id()), api.options()])
    if (g !== generation) return
    options.value = o
    set(a)
  })
const save = () =>
  run(async (g) => {
    const a = await api.update(id(), {
      ...draft.value!,
      expectedRevision: activity.value!.revision,
    })
    if (g === generation) set(a)
  }, 'Đã lưu thay đổi; lịch sử ghi giá trị trước và sau.')
const labels: Record<ActivityTransition, string> = {
  publish: 'Đã công bố hoạt động.',
  cancel: 'Đã hủy hoạt động.',
  suspend: 'Đã tạm dừng hoạt động.',
  resume: 'Đã mở lại hoạt động.',
}
function act(action: ActivityTransition) {
  if (action === 'cancel' && !window.confirm('Hủy là thao tác cuối cùng. Tiếp tục?')) return
  return run(async (g) => {
    const a = await api.transition(id(), action, activity.value!.revision, reason.value)
    if (g === generation) set(a)
  }, labels[action])
}
const delegate = () =>
  run(
    async (g) => {
      const a = await api.delegate(
        id(),
        activity.value!.revision,
        delegateTo.value || null,
        delegateReason.value,
      )
      if (g === generation) set(a)
    },
    delegateTo.value ? 'Đã giao CLB thực hiện.' : 'Đã rút giao CLB.',
  )
const needsReason = computed(
  () =>
    activity.value &&
    (activity.value.canCancel || activity.value.canSuspend || activity.value.canResume),
)
const audience = computed(() => {
  const a = activity.value
  if (!a || !options.value) return ''
  const e = a.eligibility,
    names = (ids: string[], list: { id: string; code: string }[]) =>
      ids.map((i) => list.find((x) => x.id === i)?.code ?? 'đơn vị không còn hoạt động').join(', ')
  const parts = [
    e.facultyIds.length ? 'Khoa: ' + names(e.facultyIds, options.value.faculties) : '',
    e.classIds.length ? 'Lớp: ' + names(e.classIds, options.value.classes) : '',
    e.cohortYears.length ? 'Niên khóa: ' + e.cohortYears.map(formatCohort).join(', ') : '',
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : 'Mọi sinh viên'
})
watch(() => route.params.id, load)
onMounted(load)
onBeforeUnmount(() => {
  generation++
})
</script>
<template>
  <section class="training-workspace training-workspace--student">
    <header>
      <NuxtLink to="/activity-management">← Danh sách hoạt động</NuxtLink>
      <p class="page-eyebrow">Hoạt động ngoại khóa</p>
      <h1 class="page-title">{{ activity ? activity.title : 'Hoạt động' }}</h1>
    </header>
    <div v-if="error" class="tp-notice tp-notice--error" role="alert">{{ error.message }}</div>
    <p v-if="message" class="tp-notice" role="status">{{ message }}</p>
    <p v-if="busy && !activity" role="status">Đang tải hoạt động…</p>
    <template v-if="activity && options && draft">
      <section class="tp-panel" aria-labelledby="activity-info-title">
        <h2 id="activity-info-title">Thông tin</h2>
        <p>
          <strong>{{ activityStatusLabels[activity.status] }}</strong> ·
          {{ activityKindLabels[activity.kind] }} ·
          {{ activityCategoryLabels[activity.category] }}
        </p>
        <p>{{ activityOrganizer(activity) }}</p>
        <p>
          {{ formatActivityTime(activity.startsAt) }} – {{ formatActivityTime(activity.endsAt) }} ·
          {{ activity.location }} ·
          {{ activity.capacity === null ? 'Không giới hạn' : 'Tối đa ' + activity.capacity }}
        </p>
        <p>Đối tượng: {{ audience }}</p>
        <p v-if="activity.statusReason" class="tp-muted">Lý do: {{ activity.statusReason }}</p>
      </section>
      <section v-if="activity.canEdit" class="tp-panel" aria-labelledby="activity-edit-title">
        <h2 id="activity-edit-title">Sửa hoạt động</h2>
        <ActivityForm
          :key="formKey"
          v-model="draft"
          :options="options"
          :disabled="busy"
          id-prefix="edit-activity"
        />
        <div class="tp-actions">
          <BaseButton :disabled="busy" @click="save">Lưu thay đổi</BaseButton>
          <BaseButton v-if="activity.canPublish" :disabled="busy" @click="act('publish')"
            >Công bố</BaseButton
          >
        </div>
      </section>
      <section v-if="needsReason" class="tp-panel" aria-labelledby="activity-status-title">
        <h2 id="activity-status-title">Trạng thái</h2>
        <label class="tp-field" for="activity-reason"
          >Lý do (bắt buộc)<input
            id="activity-reason"
            v-model="reason"
            maxlength="500"
            :disabled="busy"
        /></label>
        <div class="tp-actions">
          <BaseButton
            v-if="activity.canSuspend"
            :disabled="busy || !reason.trim()"
            @click="act('suspend')"
            >Tạm dừng</BaseButton
          ><BaseButton
            v-if="activity.canResume"
            :disabled="busy || !reason.trim()"
            @click="act('resume')"
            >Mở lại</BaseButton
          ><BaseButton
            v-if="activity.canCancel"
            variant="secondary"
            :disabled="busy || !reason.trim()"
            @click="act('cancel')"
            >Hủy hoạt động</BaseButton
          >
        </div>
      </section>
      <section
        v-if="activity.canDelegate"
        class="tp-panel"
        aria-labelledby="activity-delegate-title"
      >
        <h2 id="activity-delegate-title">Giao CLB thực hiện</h2>
        <div class="tp-grid">
          <label class="tp-field" for="activity-delegate"
            >CLB<select id="activity-delegate" v-model="delegateTo" :disabled="busy">
              <option value="">Không giao</option>
              <option v-for="c in options.delegationClubs" :key="c.id" :value="c.id">
                {{ c.code }} · {{ c.name }}
              </option>
            </select></label
          >
          <label class="tp-field" for="activity-delegate-reason"
            >Ghi chú<input
              id="activity-delegate-reason"
              v-model="delegateReason"
              maxlength="500"
              :disabled="busy"
          /></label>
        </div>
        <p class="tp-muted">
          CLB được giao không sửa thời gian, đối tượng hay sức chứa. Bạn rút lại được bất cứ lúc
          nào.
        </p>
        <div class="tp-actions">
          <BaseButton
            :disabled="busy || delegateTo === (activity.delegatedClub?.id ?? '')"
            @click="delegate"
            >Cập nhật giao CLB</BaseButton
          >
        </div>
      </section>
      <ActivityRosterPanel v-if="activity.status !== 'DRAFT'" :activity-id="activity.id" />
      <section class="tp-panel" aria-labelledby="activity-history-title">
        <h2 id="activity-history-title">Lịch sử</h2>
        <ul class="tp-files">
          <li v-for="e in activity.events" :key="e.id">
            <p>
              <strong>{{ activityEventLabels[e.action] ?? e.action }}</strong> · {{ e.actor }} ·
              {{ formatActivityTime(e.createdAt) }}
            </p>
            <p v-if="e.reason" class="tp-muted">{{ e.reason }}</p>
            <p v-if="e.action === 'UPDATED' && e.after" class="tp-muted">
              Đã đổi: {{ Object.keys(e.after).join(', ') }}
            </p>
          </li>
        </ul>
      </section>
    </template>
  </section>
</template>
<style src="~/assets/css/training.css"></style>
