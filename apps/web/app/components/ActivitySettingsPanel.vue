<script setup lang="ts">
import type { SuggestionSettings, TrainingGroupCode } from '~/types/activity'
import type { TrainingCriterion, TrainingError } from '~/types/training-point'
import { fromLocalInput, toLocalInput } from '~/utils/activity'

/** ADR 0033: per-period suggestion settings; changes never touch submitted declarations. */
const props = defineProps<{ periodId: string }>()
const api = useActivitySuggestions(),
  settings = ref<SuggestionSettings | null>(null),
  criteria = ref<TrainingCriterion[]>([]),
  revision = ref(0),
  isDefault = ref(true),
  from = ref(''),
  to = ref(''),
  busy = ref(false),
  error = ref<TrainingError | null>(null),
  message = ref('')
function set(r: {
  settings: SuggestionSettings
  revision: number
  isDefault: boolean
  criteria: TrainingCriterion[]
}) {
  settings.value = structuredClone(r.settings)
  criteria.value = r.criteria
  revision.value = r.revision
  isDefault.value = r.isDefault
  from.value = toLocalInput(r.settings.window.from)
  to.value = toLocalInput(r.settings.window.to)
}
async function run(fn: () => Promise<void>, done = '') {
  if (busy.value) return
  busy.value = true
  error.value = null
  message.value = ''
  try {
    await fn()
    message.value = done
  } catch (e) {
    error.value = e as TrainingError
  } finally {
    busy.value = false
  }
}
const load = () => run(async () => set(await api.settings(props.periodId)))
const save = () =>
  run(async () => {
    const s = settings.value!
    s.window = { from: fromLocalInput(from.value), to: fromLocalInput(to.value) }
    set(await api.saveSettings(props.periodId, revision.value, s))
  }, 'Đã lưu thiết lập gợi ý. Bản kê khai đã nộp không thay đổi.')
const max = (g: TrainingGroupCode) => criteria.value.find((c) => c.code === g)?.maxPoints ?? 0
watch(() => props.periodId, load)
onMounted(load)
</script>
<template>
  <section class="tp-panel" aria-labelledby="activity-settings-title">
    <h2 id="activity-settings-title">Gợi ý điểm từ hoạt động ngoại khóa</h2>
    <div v-if="error" class="tp-notice tp-notice--error" role="alert">{{ error.message }}</div>
    <p v-if="message" class="tp-notice" role="status">{{ message }}</p>
    <form v-if="settings" @submit.prevent="save">
      <p class="tp-muted">
        {{ isDefault ? 'Đang dùng thiết lập mặc định.' : 'Đã chỉnh cho đợt này.' }} Gợi ý chỉ để
        sinh viên tham khảo khi kê khai; cố vấn và khoa vẫn xét duyệt.
      </p>
      <div class="tp-grid">
        <label class="tp-field" for="as-from"
          >Tính từ (giờ Việt Nam)<input
            id="as-from"
            v-model="from"
            type="datetime-local"
            :disabled="busy"
        /></label>
        <label class="tp-field" for="as-to"
          >Đến trước<input id="as-to" v-model="to" type="datetime-local" :disabled="busy"
        /></label>
      </div>
      <fieldset class="tp-group" :disabled="busy">
        <legend>
          Hoạt động do Học viện tổ chức (nhóm {{ settings.school.group }}, tối đa
          {{ max(settings.school.group) }})
        </legend>
        <div class="tp-grid">
          <label class="tp-field" for="as-full"
            >Đầy đủ<input
              id="as-full"
              v-model.number="settings.school.full"
              type="number"
              min="0"
              :max="max(settings.school.group)"
          /></label>
          <label class="tp-field" for="as-active"
            >Tích cực<input
              id="as-active"
              v-model.number="settings.school.active"
              type="number"
              min="0"
              :max="max(settings.school.group)"
          /></label>
          <label class="tp-field" for="as-min"
            >Số hoạt động tự chọn tối thiểu<input
              id="as-min"
              v-model.number="settings.school.minVoluntary"
              type="number"
              min="0"
              max="20"
          /></label>
        </div>
        <label class="tp-check"
          ><input v-model="settings.school.fullWithoutMandatory" type="checkbox" />Kỳ không có hoạt
          động bắt buộc vẫn tính mức “đầy đủ”</label
        >
      </fieldset>
      <fieldset class="tp-group" :disabled="busy">
        <legend>
          CLB, học thuật (nhóm {{ settings.club.group }}, tối đa {{ max(settings.club.group) }})
        </legend>
        <div class="tp-grid">
          <label class="tp-field" for="as-club"
            >Tham gia<input
              id="as-club"
              v-model.number="settings.club.participant"
              type="number"
              min="0"
              :max="max(settings.club.group)"
          /></label>
          <label class="tp-field" for="as-organizer"
            >Ban tổ chức<input
              id="as-organizer"
              v-model.number="settings.club.organizer"
              type="number"
              min="0"
              :max="max(settings.club.group)"
          /></label>
        </div>
      </fieldset>
      <fieldset class="tp-group" :disabled="busy">
        <legend>
          Tình nguyện, hiến máu (nhóm {{ settings.volunteer.group }}, tối đa
          {{ max(settings.volunteer.group) }})
        </legend>
        <label class="tp-field" for="as-volunteer"
          >Tham gia<input
            id="as-volunteer"
            v-model.number="settings.volunteer.participant"
            type="number"
            min="0"
            :max="max(settings.volunteer.group)"
        /></label>
      </fieldset>
      <div class="tp-actions">
        <BaseButton type="submit" :disabled="busy">Lưu thiết lập gợi ý</BaseButton>
      </div>
    </form>
  </section>
</template>
