<script setup lang="ts">
import type { ActivityDraft, ActivityOptions } from '~/types/activity'
import { activityCategoryLabels } from '~/types/activity'
import { formatCohort, parseCohortList } from '~/utils/cohort'
import { fromLocalInput, toLocalInput } from '~/utils/activity'

/** ADR 0030: shared create/edit form; the server re-validates every field. */
const props = defineProps<{ options: ActivityOptions; disabled?: boolean; idPrefix: string }>()
const draft = defineModel<ActivityDraft>({ required: true })
const starts = ref(toLocalInput(draft.value.startsAt)),
  ends = ref(toLocalInput(draft.value.endsAt)),
  cohorts = ref(draft.value.eligibility.cohortYears.map(formatCohort).join(', ')),
  unlimited = ref(draft.value.capacity === null),
  capacity = ref(draft.value.capacity ?? 50)
const cohortError = computed(() =>
  parseCohortList(cohorts.value) === null ? 'Niên khóa viết dạng K15, K16.' : '',
)
const classes = computed(() =>
  draft.value.eligibility.facultyIds.length
    ? props.options.classes.filter((c) => draft.value.eligibility.facultyIds.includes(c.facultyId))
    : props.options.classes,
)
watch([starts, ends], () => {
  draft.value.startsAt = fromLocalInput(starts.value)
  draft.value.endsAt = fromLocalInput(ends.value)
})
watch(cohorts, () => {
  const years = parseCohortList(cohorts.value)
  if (years) draft.value.eligibility.cohortYears = years
})
watch([unlimited, capacity], () => {
  draft.value.capacity = unlimited.value ? null : Number(capacity.value)
})
// Classes outside the selected faculties would make the audience empty; drop them.
watch(
  () => draft.value.eligibility.facultyIds,
  () => {
    const allowed = new Set(classes.value.map((c) => c.id))
    draft.value.eligibility.classIds = draft.value.eligibility.classIds.filter((id) =>
      allowed.has(id),
    )
  },
)
const id = (name: string) => props.idPrefix + '-' + name
</script>
<template>
  <div class="activity-form">
    <div class="tp-grid">
      <label class="tp-field" :for="id('title')"
        >Tên hoạt động<input
          :id="id('title')"
          v-model="draft.title"
          maxlength="255"
          :disabled="disabled"
      /></label>
      <label class="tp-field" :for="id('category')"
        >Nhóm hoạt động<select :id="id('category')" v-model="draft.category" :disabled="disabled">
          <option v-for="(label, key) in activityCategoryLabels" :key="key" :value="key">
            {{ label }}
          </option>
        </select></label
      >
      <label class="tp-field" :for="id('location')"
        >Địa điểm<input
          :id="id('location')"
          v-model="draft.location"
          maxlength="255"
          :disabled="disabled"
      /></label>
      <label class="tp-field" :for="id('starts')"
        >Bắt đầu (giờ Việt Nam)<input
          :id="id('starts')"
          v-model="starts"
          type="datetime-local"
          :disabled="disabled"
      /></label>
      <label class="tp-field" :for="id('ends')"
        >Kết thúc (giờ Việt Nam)<input
          :id="id('ends')"
          v-model="ends"
          type="datetime-local"
          :disabled="disabled"
      /></label>
      <div class="tp-field">
        <label class="tp-check"
          ><input v-model="unlimited" type="checkbox" :disabled="disabled" />Không giới hạn số
          người</label
        >
        <label v-if="!unlimited" :for="id('capacity')"
          >Sức chứa<input
            :id="id('capacity')"
            v-model.number="capacity"
            type="number"
            min="1"
            max="100000"
            :disabled="disabled"
        /></label>
      </div>
    </div>
    <label class="tp-field" :for="id('description')"
      >Mô tả<textarea
        :id="id('description')"
        v-model="draft.description"
        rows="3"
        maxlength="4000"
        :disabled="disabled"
      />
    </label>
    <fieldset class="tp-panel">
      <legend>Đối tượng (để trống là không giới hạn)</legend>
      <div class="tp-grid">
        <label class="tp-field" :for="id('faculties')"
          >Khoa<select
            :id="id('faculties')"
            v-model="draft.eligibility.facultyIds"
            multiple
            size="4"
            :disabled="disabled"
          >
            <option v-for="f in options.faculties" :key="f.id" :value="f.id">
              {{ f.code }} · {{ f.name }}
            </option>
          </select></label
        >
        <label class="tp-field" :for="id('classes')"
          >Lớp<select
            :id="id('classes')"
            v-model="draft.eligibility.classIds"
            multiple
            size="4"
            :disabled="disabled"
          >
            <option v-for="c in classes" :key="c.id" :value="c.id">{{ c.code }}</option>
          </select></label
        >
        <label class="tp-field" :for="id('cohorts')"
          >Niên khóa<input
            :id="id('cohorts')"
            v-model="cohorts"
            placeholder="K15, K16"
            :disabled="disabled"
        /></label>
      </div>
      <p v-if="cohortError" class="tp-error">{{ cohortError }}</p>
      <p v-if="options.trainingFacultyLimited" class="tp-muted">
        Tài khoản Phòng Đào tạo theo khoa phải chọn ít nhất một khoa được giao.
      </p>
      <p class="tp-muted">
        Điều kiện kết hợp với nhau. Sinh viên chưa có niên khóa không thuộc đối tượng của hoạt động
        giới hạn niên khóa.
      </p>
    </fieldset>
  </div>
</template>
