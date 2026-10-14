<script setup lang="ts">
import type {
  TrainingPeriod,
  TrainingPeriodInput,
  TrainingCatalog,
  TrainingError,
} from '~/types/training-point'
import { trainingStatuses, trainingDate } from '~/utils/training-point'
definePageMeta({ layout: 'admin', middleware: 'admin-auth' })
const api = useTrainingPoints(true),
  items = ref<TrainingPeriod[]>([]),
  catalog = ref<TrainingCatalog | null>(null),
  selected = ref<TrainingPeriod | null>(null),
  form = ref<TrainingPeriodInput | null>(null),
  busy = ref(false),
  error = ref<TrainingError | null>(null),
  message = ref(''),
  confirmation = ref<'open' | 'close' | null>(null),
  accepted = ref(false),
  confirmBox = ref<HTMLElement | null>(null),
  stale = ref(false),
  baseline = ref('')
let generation = 0
const dirty = computed(() => JSON.stringify(form.value) !== baseline.value),
  canEdit = computed(() => !selected.value || selected.value.status === 'DRAFT'),
  total = computed(() => form.value?.criteria.reduce((n, c) => n + Number(c.maxPoints), 0) ?? 0)
function local(value: string) {
  const d = new Date(value)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}
function set(p: TrainingPeriod | null) {
  selected.value = p
  confirmation.value = null
  accepted.value = false
  form.value = p
    ? {
        classId: p.classId,
        academicYear: p.academicYear,
        semester: p.semester,
        name: p.name,
        policyLabel: p.policyLabel,
        startsAt: local(p.startsAt),
        endsAt: local(p.endsAt),
        criteria: structuredClone(toRaw(p.criteria)),
      }
    : {
        classId: catalog.value?.classes[0]?.id ?? '',
        academicYear: '2026-2027',
        semester: '1',
        name: 'Đợt kê khai thử nghiệm',
        policyLabel: 'Tiêu chí giả định để thử nghiệm — chưa phải quy chế chính thức',
        startsAt: local(new Date(Date.now() - 300000).toISOString()),
        endsAt: local(new Date(Date.now() + 7 * 86400000).toISOString()),
        criteria: ['A', 'B', 'C', 'D', 'E'].map((code, i) => ({
          code: code as 'A' | 'B' | 'C' | 'D' | 'E',
          label: [
            'Ý thức học tập',
            'Chấp hành nội quy',
            'Hoạt động cộng đồng',
            'Trách nhiệm tập thể',
            'Đóng góp khác',
          ][i]!,
          maxPoints: 20,
          evidenceRequired: i === 0,
        })),
      }
  baseline.value = JSON.stringify(form.value)
}
function choose(p: TrainingPeriod | null) {
  if (dirty.value && !window.confirm('Bỏ các thay đổi chưa lưu?')) return
  error.value = null
  message.value = ''
  set(p)
}
async function run(action: () => Promise<void>) {
  if (busy.value) return
  busy.value = true
  const current = ++generation
  error.value = null
  message.value = ''
  try {
    await action()
  } catch (e) {
    if (current !== generation) return
    error.value = e as TrainingError
    if ([401, 403, 404].includes(error.value.status ?? 0)) {
      catalog.value = null
      items.value = []
      form.value = null
      selected.value = null
      baseline.value = JSON.stringify(null)
    }
    stale.value = ![400, 413, 422].includes(error.value.status ?? 0)
  } finally {
    if (current === generation) busy.value = false
  }
}
async function load() {
  await run(async () => {
    const c = await api.catalog(),
      list = await api.list()
    catalog.value = c
    items.value = list.items
    const p = selected.value ? (items.value.find((i) => i.id === selected.value!.id) ?? null) : null
    set(p)
    stale.value = false
  })
}
async function save() {
  if (!form.value || stale.value) return
  await run(async () => {
    const config = {
      ...form.value!,
      startsAt: new Date(form.value!.startsAt).toISOString(),
      endsAt: new Date(form.value!.endsAt).toISOString(),
    }
    const p = selected.value
      ? await api.savePeriod(selected.value, config)
      : await api.create(config)
    set(p)
    items.value = (await api.list()).items
    message.value = 'Đã lưu đợt đánh giá.'
  })
}
async function review(action: 'open' | 'close') {
  confirmation.value = action
  accepted.value = false
  await nextTick()
  confirmBox.value?.focus()
}
async function transition() {
  if (!selected.value || !confirmation.value || !accepted.value || dirty.value || stale.value)
    return
  const action = confirmation.value
  await run(async () => {
    const p = await api.transition(selected.value!, action)
    set(p)
    items.value = (await api.list()).items
    message.value =
      action === 'open'
        ? 'Đã mở đợt. Tiêu chí đã khóa.'
        : 'Đã đóng đợt. Sinh viên chỉ được xem lịch sử.'
  })
}
onBeforeRouteLeave(() => !dirty.value || window.confirm('Bạn có thay đổi chưa lưu. Rời trang?'))
onBeforeUnmount(() => {
  generation++
})
onMounted(load)
</script>
<template>
  <section class="training-workspace">
    <header>
      <p class="page-eyebrow">Quản trị điểm rèn luyện</p>
      <h1 class="page-title">Đợt đánh giá và tiêu chí</h1>
      <p class="page-description">
        Cấu hình năm nhóm A–E theo lớp. Sau khi mở đợt, tiêu chí và thời hạn được khóa.
      </p>
    </header>
    <p class="tp-notice">
      Bộ tiêu chí mặc định là dữ liệu giả định để thử nghiệm. Cần nhập quy chế được phê duyệt trước
      khi sử dụng thật.
    </p>
    <div v-if="error" class="tp-notice tp-notice--error" role="alert">
      <p>{{ error.message }}</p>
      <NuxtLink v-if="error.status === 401" to="/admin/login">Đăng nhập lại</NuxtLink
      ><BaseButton v-else variant="secondary" :disabled="busy" @click="load"
        >Tải lại trạng thái</BaseButton
      >
    </div>
    <p v-if="message" class="tp-notice" role="status">{{ message }}</p>
    <p v-if="busy && !catalog" role="status">Đang tải…</p>
    <template v-if="catalog"
      ><section class="tp-panel" aria-label="Danh sách đợt">
        <h2>Các đợt trong phạm vi của bạn</h2>
        <p v-if="!items.length" class="tp-muted">Chưa có đợt đánh giá.</p>
        <div class="tp-actions">
          <BaseButton
            v-for="p in items"
            :key="p.id"
            variant="secondary"
            :disabled="busy || stale"
            @click="choose(p)"
            >{{ p.name }} · {{ p.academicYear }} · {{ trainingStatuses[p.status] }}</BaseButton
          ><BaseButton :disabled="busy || stale || !catalog.classes.length" @click="choose(null)"
            >Tạo đợt mới</BaseButton
          >
        </div>
        <p v-if="catalog.truncated" class="tp-muted">
          Danh mục giới hạn 500 lớp. Cần thu hẹp phạm vi được giao.
        </p>
      </section>
      <form v-if="form && catalog.classes.length" class="tp-panel" @submit.prevent="save">
        <h2>{{ selected ? trainingStatuses[selected.status] : 'Tạo đợt đánh giá' }}</h2>
        <p v-if="!canEdit" class="tp-muted">
          Cấu hình đã khóa. Thời gian: {{ trainingDate(selected!.startsAt) }} –
          {{ trainingDate(selected!.endsAt) }}.
        </p>
        <fieldset :disabled="busy || !canEdit || stale">
          <div class="tp-grid">
            <div class="tp-field">
              <label for="tp-class">Lớp đánh giá</label
              ><select id="tp-class" v-model="form.classId" :disabled="!!selected" required>
                <option v-for="c in catalog.classes" :key="c.id" :value="c.id">
                  {{ c.code }} — {{ c.name }}
                </option>
              </select>
            </div>
            <div class="tp-field">
              <label for="tp-year">Năm học</label
              ><input
                id="tp-year"
                v-model="form.academicYear"
                pattern="[0-9]{4}-[0-9]{4}"
                :disabled="!!selected"
                required
              />
            </div>
            <div class="tp-field">
              <label for="tp-semester">Học kỳ</label
              ><select id="tp-semester" v-model="form.semester" :disabled="!!selected">
                <option value="1">Học kỳ 1</option>
                <option value="2">Học kỳ 2</option>
                <option value="SUMMER">Học kỳ hè</option>
              </select>
            </div>
            <div class="tp-field">
              <label for="tp-name">Tên đợt</label
              ><input id="tp-name" v-model="form.name" maxlength="200" required />
            </div>
            <div class="tp-field">
              <label for="tp-start">Bắt đầu kê khai</label
              ><input id="tp-start" v-model="form.startsAt" type="datetime-local" required />
            </div>
            <div class="tp-field">
              <label for="tp-end">Kết thúc kê khai</label
              ><input id="tp-end" v-model="form.endsAt" type="datetime-local" required />
            </div>
            <div class="tp-field tp-full">
              <label for="tp-policy">Tên quy chế / ghi chú bộ tiêu chí</label
              ><input id="tp-policy" v-model="form.policyLabel" maxlength="200" required />
            </div>
          </div>
          <fieldset v-for="c in form.criteria" :key="c.code" class="tp-group">
            <legend>Nhóm {{ c.code }}</legend>
            <div class="tp-grid">
              <div class="tp-field">
                <label :for="'tp-label-' + c.code">Tên tiêu chí {{ c.code }}</label
                ><input :id="'tp-label-' + c.code" v-model="c.label" maxlength="200" required />
              </div>
              <div class="tp-field">
                <label :for="'tp-max-' + c.code">Điểm tối đa {{ c.code }}</label
                ><input
                  :id="'tp-max-' + c.code"
                  v-model.number="c.maxPoints"
                  type="number"
                  min="1"
                  max="100"
                  step="1"
                  required
                />
              </div>
            </div>
            <label class="tp-check"
              ><input v-model="c.evidenceRequired" type="checkbox" /> Yêu cầu minh chứng khi kê khai
              điểm lớn hơn 0</label
            >
          </fieldset>
          <p :class="total === 100 ? 'tp-muted' : 'tp-error'">
            Tổng điểm tối đa: {{ total }} / 100
          </p>
        </fieldset>
        <div v-if="canEdit" class="tp-actions">
          <BaseButton type="submit" :loading="busy" :disabled="!dirty || stale || total !== 100"
            >Lưu đợt đánh giá</BaseButton
          ><BaseButton
            type="button"
            variant="secondary"
            :disabled="busy || !selected || dirty || stale"
            @click="review('open')"
            >Mở đợt</BaseButton
          >
        </div>
        <BaseButton
          v-else-if="selected?.status === 'OPEN'"
          type="button"
          variant="secondary"
          :disabled="busy || stale"
          @click="review('close')"
          >Đóng đợt</BaseButton
        >
      </form>
      <p v-else class="tp-panel">Chưa có lớp được giao trong phạm vi quản lý.</p>
      <section
        v-if="confirmation && selected"
        ref="confirmBox"
        class="tp-confirm"
        tabindex="-1"
        aria-label="Xác nhận thay đổi đợt"
      >
        <h2>{{ confirmation === 'open' ? 'Xác nhận mở đợt' : 'Xác nhận đóng đợt' }}</h2>
        <p>{{ selected.name }} · {{ selected.academicYear }}</p>
        <p>
          {{
            confirmation === 'open'
              ? 'Năm nhóm A–E và thời hạn sẽ khóa. Sinh viên chỉ kê khai trong khoảng thời gian đã cấu hình.'
              : 'Đợt sẽ đóng và không mở lại. Bản kê khai và lịch sử vẫn được lưu.'
          }}
        </p>
        <label class="tp-check"
          ><input v-model="accepted" type="checkbox" :disabled="busy" /> Tôi đã kiểm tra và đồng
          ý</label
        >
        <div class="tp-actions">
          <BaseButton :disabled="!accepted || busy || stale" @click="transition">{{
            confirmation === 'open' ? 'Xác nhận mở đợt' : 'Xác nhận đóng đợt'
          }}</BaseButton
          ><BaseButton variant="secondary" :disabled="busy" @click="confirmation = null"
            >Quay lại</BaseButton
          >
        </div>
      </section></template
    >
  </section>
</template>
<style src="~/assets/css/training.css"></style>
