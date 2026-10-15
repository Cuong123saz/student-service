<script setup lang="ts">
import type {
  TrainingDeclaration,
  TrainingAnswers,
  TrainingError,
  TrainingGroup,
} from '~/types/training-point'
import { trainingDate, trainingActions, trainingIssues } from '~/utils/training-point'
definePageMeta({
  middleware: 'user-auth',
  validate: (route) =>
    typeof route.params.id === 'string' &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(route.params.id),
})
const route = useRoute(),
  api = useTrainingPoints(),
  row = ref<TrainingDeclaration | null>(null),
  answers = ref<TrainingAnswers>({}),
  baseline = ref(''),
  busy = ref(false),
  error = ref<TrainingError | null>(null),
  message = ref(''),
  stale = ref(false),
  reviewing = ref(false),
  accepted = ref(false),
  confirmBox = ref<HTMLElement | null>(null)
let generation = 0
const dirty = computed(() => JSON.stringify(answers.value) !== baseline.value),
  total = computed(() => Object.values(answers.value).reduce((n, a) => n + (a.points ?? 0), 0)),
  editable = computed(() => row.value?.editable && !stale.value)
function set(d: TrainingDeclaration) {
  if (d.id !== String(route.params.id).toLowerCase()) return
  row.value = d
  answers.value = Object.fromEntries(
    d.period.criteria.map((c) => [
      c.code,
      d.answers[c.code] ? { ...d.answers[c.code] } : { points: null, note: '' },
    ]),
  )
  baseline.value = JSON.stringify(answers.value)
  reviewing.value = false
  accepted.value = false
}
function clearPrivateData(e: TrainingError) {
  generation++
  row.value = null
  answers.value = {}
  baseline.value = '{}'
  busy.value = false
  error.value = e
  message.value = ''
  stale.value = true
  reviewing.value = false
  accepted.value = false
}
function issue(code: string) {
  return error.value?.issues
    .filter((i) => i.path === code)
    .map((i) => i.message)
    .join(' ')
}
async function run(action: () => Promise<void>) {
  if (busy.value) return
  busy.value = true
  const g = ++generation
  error.value = null
  message.value = ''
  try {
    await action()
  } catch (e) {
    if (g !== generation) return
    error.value = e as TrainingError
    reviewing.value = false
    if ([401, 403, 404].includes(error.value.status ?? 0)) {
      row.value = null
      answers.value = {}
      baseline.value = JSON.stringify({})
    }
    stale.value = ![400, 413, 422].includes(error.value.status ?? 0)
    await nextTick()
    document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  } finally {
    if (g === generation) busy.value = false
  }
}
async function load() {
  const id = String(route.params.id),
    expectedGeneration = generation + 1
  await run(async () => {
    const d = await api.detail(id)
    if (generation !== expectedGeneration) return
    set(d)
    stale.value = false
  })
}
async function reload() {
  if (dirty.value && !window.confirm('Bỏ nội dung chưa lưu và tải lại bản trên máy chủ?')) return
  await load()
}
async function save() {
  if (!row.value || !editable.value) return
  await run(async () => {
    set(await api.save(row.value!, answers.value))
    message.value = 'Đã lưu bản nháp.'
  })
}
async function upload(code: TrainingGroup, event: Event) {
  const input = event.target as HTMLInputElement,
    file = input.files?.[0]
  if (!file || !row.value || dirty.value || !editable.value) return
  await run(async () => {
    set(await api.upload(row.value!, code, file))
    message.value = 'Đã lưu minh chứng.'
  })
  input.value = ''
}
async function remove(id: string) {
  if (!row.value || dirty.value || !editable.value) return
  await run(async () => {
    set(await api.remove(row.value!, id))
    message.value = 'Đã gỡ minh chứng khỏi bản nháp.'
  })
}
async function download(file: { id: string; name: string }) {
  if (!row.value) return
  await run(() => api.download(row.value!, file))
}
async function review() {
  if (!row.value || dirty.value || !editable.value) return
  const issues = trainingIssues(answers.value, row.value.period.criteria, row.value.files)
  if (issues.length) {
    error.value = { message: 'Hoàn thiện các nhóm được đánh dấu trước khi nộp.', issues }
    await nextTick()
    document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
    return
  }
  error.value = null
  reviewing.value = true
  accepted.value = false
  await nextTick()
  confirmBox.value?.focus()
}
async function cancelReview() {
  reviewing.value = false
  await nextTick()
  document.getElementById('tp-review-button')?.focus()
}
async function submit() {
  if (!row.value || !accepted.value || dirty.value || !editable.value) return
  await run(async () => {
    set(await api.submit(row.value!, crypto.randomUUID()))
    message.value = 'Đã nộp bản kê khai. Nội dung đã khóa.'
  })
}
function points(code: string, event: Event) {
  const value = (event.target as HTMLInputElement).value
  answers.value[code]!.points = value === '' ? null : Number(value)
  reviewing.value = false
  error.value = null
}
onBeforeRouteLeave(() => !dirty.value || window.confirm('Bạn có bản kê khai chưa lưu. Rời trang?'))
watch(
  () => route.params.id,
  () => {
    generation++
    busy.value = false
    row.value = null
    answers.value = {}
    baseline.value = JSON.stringify({})
    void load()
  },
)
onBeforeUnmount(() => {
  generation++
})
onMounted(load)
</script>
<template>
  <section class="training-workspace training-workspace--student">
    <header>
      <NuxtLink to="/training-points">← Các đợt đánh giá</NuxtLink>
      <p class="page-eyebrow">Kê khai A–E</p>
      <h1 class="page-title">{{ row?.period.name ?? 'Bản kê khai rèn luyện' }}</h1>
      <p class="page-description">
        {{
          row?.state === 'DRAFT' ? 'Điểm tự kê khai, chưa xét duyệt.' : 'Điểm sinh viên tự kê khai.'
        }}
      </p>
    </header>
    <div v-if="error" class="tp-notice tp-notice--error" role="alert">
      <p>{{ error.message }}</p>
      <NuxtLink v-if="error.status === 401" to="/login">Đăng nhập lại</NuxtLink
      ><BaseButton v-else variant="secondary" :disabled="busy" @click="reload"
        >Tải lại trạng thái</BaseButton
      >
    </div>
    <p v-if="message" class="tp-notice" role="status">{{ message }}</p>
    <p v-if="busy && !row" role="status">Đang tải bản kê khai…</p>
    <template v-if="row"
      ><section class="tp-panel" aria-label="Thông tin bản kê khai">
        <h2>{{ row.state === 'SUBMITTED' ? 'Đã nộp — nội dung đã khóa' : 'Bản nháp' }}</h2>
        <p>
          {{ row.student.fullName }} · {{ row.student.studentCode }} · {{ row.student.classCode }}
        </p>
        <p>
          {{ row.period.academicYear }} ·
          {{ row.period.semester === 'SUMMER' ? 'Học kỳ hè' : 'Học kỳ ' + row.period.semester }}
        </p>
        <p class="tp-muted">{{ row.period.policyLabel }}</p>
        <p class="tp-muted">
          Thời hạn: {{ trainingDate(row.period.startsAt) }} – {{ trainingDate(row.period.endsAt) }}
        </p>
        <p class="tp-score">{{ total }} / 100</p>
        <p>Điểm sinh viên tự kê khai, được giữ riêng với kết quả xét duyệt.</p>
        <p v-if="row.submittedAt">Đã nộp lúc {{ trainingDate(row.submittedAt) }}</p>
        <p v-if="!row.editable && row.state === 'DRAFT'" class="tp-notice">
          Bản nháp hiện chỉ được xem: đợt chưa đến hạn, đã đóng/hết hạn hoặc lớp đã thay đổi.
        </p>
      </section>
      <TrainingReviewResult
        v-if="row.state === 'SUBMITTED'"
        :declaration-id="row.id"
        @unavailable="clearPrivateData"
      />
      <form class="tp-panel" @submit.prevent="save">
        <h2>Nội dung kê khai</h2>
        <p class="tp-muted">
          Có thể để trống điểm khi lưu nháp. Khi nộp, cần đủ A–E; điểm lớn hơn 0 phải có giải trình.
          Lưu thay đổi trước khi thêm hoặc gỡ tệp.
        </p>
        <template v-for="c in row.period.criteria" :key="c.code">
          <fieldset class="tp-group" :disabled="busy || !editable || reviewing">
            <legend>Nhóm {{ c.code }} — {{ c.label }}</legend>
            <div class="tp-grid">
              <div class="tp-field">
                <label :for="'tp-points-' + c.code"
                  >Điểm tự kê khai {{ c.code }} / {{ c.maxPoints }}</label
                ><input
                  :id="'tp-points-' + c.code"
                  :value="answers[c.code]?.points ?? ''"
                  type="number"
                  min="0"
                  :max="c.maxPoints"
                  step="1"
                  :aria-invalid="!!issue(c.code)"
                  :aria-describedby="issue(c.code) ? 'tp-issue-' + c.code : undefined"
                  @input="points(c.code, $event)"
                />
              </div>
              <div class="tp-field">
                <label :for="'tp-note-' + c.code">Giải trình {{ c.code }}</label
                ><textarea
                  :id="'tp-note-' + c.code"
                  v-model="answers[c.code]!.note"
                  maxlength="2000"
                  rows="3"
                  :aria-invalid="!!issue(c.code)"
                  @input="reviewing = false"
                />
              </div>
            </div>
            <p v-if="issue(c.code)" :id="'tp-issue-' + c.code" class="tp-error">
              {{ issue(c.code) }}
            </p>
            <p class="tp-muted">
              {{
                c.evidenceRequired
                  ? 'Cần minh chứng nếu kê khai điểm lớn hơn 0.'
                  : 'Minh chứng không bắt buộc.'
              }}
              PDF, PNG hoặc JPEG; tối đa 5 MiB/tệp, 3 tệp/nhóm, 10 tệp và 20 MiB/bản kê khai.
            </p>
            <div v-if="editable" class="tp-field">
              <label :for="'tp-file-' + c.code">Thêm minh chứng {{ c.code }}</label
              ><input
                :id="'tp-file-' + c.code"
                type="file"
                accept="application/pdf,image/png,image/jpeg"
                :disabled="dirty"
                @change="upload(c.code, $event)"
              /><small v-if="dirty" class="tp-muted">Lưu bản nháp để thêm minh chứng.</small>
            </div>
          </fieldset>
          <ul
            v-if="row.files.some((f) => f.criterion === c.code)"
            class="tp-files"
            :aria-label="'Minh chứng nhóm ' + c.code"
          >
            <li v-for="file in row.files.filter((f) => f.criterion === c.code)" :key="file.id">
              <strong>{{ c.code }} · {{ file.name }}</strong>
              <p class="tp-muted">
                {{ Math.ceil(file.size / 1024) }} KiB · Chưa kiểm tra chữ ký / dấu
              </p>
              <div class="tp-actions">
                <BaseButton
                  type="button"
                  variant="secondary"
                  :disabled="busy"
                  @click="download(file)"
                  >Tải {{ file.name }}</BaseButton
                ><BaseButton
                  v-if="editable"
                  type="button"
                  variant="secondary"
                  :disabled="busy || dirty || reviewing"
                  :aria-label="'Gỡ ' + file.name"
                  @click="remove(file.id)"
                  >Gỡ tệp</BaseButton
                >
              </div>
            </li>
          </ul>
        </template>
        <div v-if="editable && !reviewing" class="tp-actions">
          <BaseButton type="submit" :disabled="!dirty" :loading="busy">Lưu bản nháp</BaseButton
          ><BaseButton type="button" :disabled="busy || dirty" id="tp-review-button" @click="review"
            >Kiểm tra và nộp</BaseButton
          >
        </div>
        <p v-if="dirty" class="tp-muted" role="status">Có thay đổi chưa lưu.</p>
      </form>
      <section
        v-if="reviewing"
        ref="confirmBox"
        class="tp-confirm"
        tabindex="-1"
        aria-label="Xác nhận nộp kê khai"
      >
        <h2>Kiểm tra trước khi nộp</h2>
        <p>{{ row.student.fullName }} · {{ row.student.studentCode }}</p>
        <p v-for="c in row.period.criteria" :key="c.code">
          {{ c.code }}: {{ answers[c.code]?.points }} / {{ c.maxPoints }} điểm ·
          {{ row.files.filter((f) => f.criterion === c.code).length }} minh chứng
        </p>
        <p>
          Tổng tự kê khai: {{ total }} / 100. Sau khi nộp, không thể sửa nội dung hoặc gỡ minh
          chứng.
        </p>
        <label class="tp-check"
          ><input v-model="accepted" type="checkbox" :disabled="busy" /> Tôi đã kiểm tra nội dung và
          minh chứng</label
        >
        <div class="tp-actions">
          <BaseButton :disabled="busy || !accepted" @click="submit">Xác nhận nộp</BaseButton
          ><BaseButton variant="secondary" :disabled="busy" @click="cancelReview"
            >Quay lại chỉnh sửa</BaseButton
          >
        </div>
      </section>
      <section class="tp-panel" aria-label="Lịch sử kê khai">
        <h2>Lịch sử kê khai</h2>
        <ol class="tp-history">
          <li v-for="h in row.history" :key="h.id">
            <strong>{{ trainingActions[h.action] ?? h.action }}</strong>
            <p class="tp-muted">{{ trainingDate(h.createdAt) }} · Lần cập nhật {{ h.revision }}</p>
          </li>
        </ol>
        <p v-if="row.historyTruncated" class="tp-muted">Hiển thị 100 cập nhật gần nhất.</p>
      </section></template
    >
  </section>
</template>
<style src="~/assets/css/training.css"></style>
