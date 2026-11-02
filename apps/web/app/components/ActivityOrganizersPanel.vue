<script setup lang="ts">
import type { Organizer } from '~/types/activity'
import type { TrainingError } from '~/types/training-point'
import { formatActivityTime } from '~/utils/activity'

/** ADR 0033: organising committee (+2 suggestion for club/academic activities). */
const props = defineProps<{ activityId: string }>()
const api = useActivitySuggestions(),
  items = ref<Organizer[]>([]),
  canEdit = ref(false),
  code = ref(''),
  busy = ref(false),
  error = ref<TrainingError | null>(null)
async function run(fn: () => Promise<{ canEdit: boolean; items: Organizer[] }>) {
  if (busy.value) return
  busy.value = true
  error.value = null
  try {
    const r = await fn()
    items.value = r.items
    canEdit.value = r.canEdit
  } catch (e) {
    error.value = e as TrainingError
  } finally {
    busy.value = false
  }
}
const add = () =>
  run(async () => {
    const r = await api.addOrganizer(props.activityId, code.value)
    code.value = ''
    return r
  })
onMounted(() => run(() => api.organizers(props.activityId)))
</script>
<template>
  <section class="tp-panel" aria-labelledby="organizers-title">
    <h2 id="organizers-title">Ban tổ chức</h2>
    <div v-if="error" class="tp-notice tp-notice--error" role="alert">{{ error.message }}</div>
    <p class="tp-muted">
      Thành viên ban tổ chức của hoạt động CLB/học thuật được gợi ý thêm điểm. Không ai tự thêm
      mình.
    </p>
    <div v-if="canEdit" class="tp-grid">
      <label class="tp-field" for="organizer-code"
        >Mã sinh viên<input id="organizer-code" v-model="code" maxlength="50" :disabled="busy"
      /></label>
      <div class="tp-actions">
        <BaseButton :disabled="busy || !code.trim()" @click="add">Thêm vào ban tổ chức</BaseButton>
      </div>
    </div>
    <p v-if="!items.length">Chưa có thành viên.</p>
    <ul class="tp-files">
      <li v-for="o in items" :key="o.id">
        <p>
          <strong>{{ o.fullName }}</strong> · {{ o.studentCode }} · thêm bởi {{ o.addedBy }},
          {{ formatActivityTime(o.addedAt) }}
        </p>
        <BaseButton
          v-if="canEdit"
          variant="secondary"
          :disabled="busy"
          @click="run(() => api.removeOrganizer(activityId, o.id))"
          >Gỡ {{ o.studentCode }}</BaseButton
        >
      </li>
    </ul>
  </section>
</template>
