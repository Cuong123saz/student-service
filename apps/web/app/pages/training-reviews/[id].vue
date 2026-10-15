<script setup lang="ts">
import type { ReviewDetail, ReviewAction } from '~/types/training-review'
import type { TrainingAnswers, TrainingError } from '~/types/training-point'
import { reviewLabels, reviewActions } from '~/utils/training-review'
import { trainingDate } from '~/utils/training-point'
definePageMeta({
  middleware: 'user-auth',
  validate: (r) =>
    typeof r.params.id === 'string' &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(r.params.id),
})
const route = useRoute(),
  api = useTrainingReviews(),
  row = ref<ReviewDetail | null>(null),
  answers = ref<TrainingAnswers>({}),
  comment = ref(''),
  busy = ref(false),
  error = ref<TrainingError | null>(null),
  stale = ref(false),
  pending = ref<ReviewAction | ''>(''),
  accepted = ref(false),
  message = ref(''),
  baseline = ref('')
let generation = 0
const total = computed(() =>
    Object.values(answers.value).reduce(
      (n, a) => n + (typeof a.points === 'number' && Number.isFinite(a.points) ? a.points : 0),
      0,
    ),
  ),
  dirty = computed(() => !!comment.value || JSON.stringify(answers.value) !== baseline.value),
  actionLabel = computed(() =>
    pending.value === 'advisor-sign'
      ? 'Xác nhận cố vấn'
      : pending.value === 'faculty-approve'
        ? 'Duyệt của khoa'
        : 'Trả về cố vấn',
  )
function setPoints(code: string, event: Event) {
  const value = (event.target as HTMLInputElement).value
  answers.value[code]!.points = value === '' ? null : Number(value)
}
function focusIssue(path: string) {
  if (/^[A-E]$/.test(path)) document.getElementById('assessed-' + path)?.focus()
}
function set(d: ReviewDetail) {
  if (d.id !== String(route.params.id).toLowerCase()) return
  row.value = d
  answers.value = structuredClone(d.decisions.at(-1)?.answers ?? d.answers)
  baseline.value = JSON.stringify(answers.value)
  comment.value = ''
  pending.value = ''
  accepted.value = false
  stale.value = false
}
async function run(fn: (g: number) => Promise<void>) {
  if (busy.value) return
  const g = ++generation
  busy.value = true
  error.value = null
  message.value = ''
  try {
    await fn(g)
  } catch (e) {
    if (g !== generation) return
    error.value = e as TrainingError
    pending.value = ''
    accepted.value = false
    stale.value = ![400, 422].includes(error.value.status ?? 0)
    if ([401, 403, 404].includes(error.value.status ?? 0)) {
      row.value = null
      answers.value = {}
      comment.value = ''
      baseline.value = '{}'
    }
    await nextTick()
    document.querySelector<HTMLElement>('[role="alert"]')?.focus()
  } finally {
    if (g === generation) busy.value = false
  }
}
async function load() {
  await run(async (g) => {
    const d = await api.detail(String(route.params.id))
    if (g === generation) set(d)
  })
}
async function reload() {
  if (dirty.value && !window.confirm('Bỏ nội dung chưa xác nhận và tải lại kết quả?')) return
  await load()
}
async function prepare(action: ReviewAction) {
  if (busy.value || stale.value || !row.value) return
  pending.value = action
  accepted.value = false
  await nextTick()
  document.getElementById('review-confirm')?.focus()
  document
    .getElementById('review-confirm')
    ?.scrollIntoView({ block: 'center', behavior: 'instant' })
}
function cancelConfirmation() {
  pending.value = ''
  accepted.value = false
}
async function submit() {
  if (!row.value || !pending.value || !accepted.value || busy.value || stale.value) return
  const d = row.value,
    action = pending.value
  await run(async (g) => {
    const next = await api.act(d, action, comment.value, answers.value)
    if (g !== generation) return
    set(next)
    message.value =
      'Đã ghi nhận ' +
      (action === 'advisor-sign'
        ? 'xác nhận cố vấn'
        : action === 'faculty-approve'
          ? 'duyệt của khoa'
          : 'trả về cố vấn') +
      '.'
  })
}
async function download(f: ReviewDetail['files'][number]) {
  if (!row.value) return
  const id = row.value.id
  await run(async () => {
    await api.download(id, f)
  })
}
const leave = () => !dirty.value || window.confirm('Rời trang và bỏ nội dung chưa xác nhận?')
onBeforeRouteLeave(leave)
onBeforeRouteUpdate(leave)
watch(
  () => route.params.id,
  () => {
    generation++
    busy.value = false
    row.value = null
    answers.value = {}
    comment.value = ''
    baseline.value = '{}'
    load()
  },
)
onMounted(load)
onBeforeUnmount(() => {
  generation++
})
</script>
<template>
  <section class="training-workspace training-workspace--student">
    <header>
      <NuxtLink to="/training-reviews">← Danh sách xét duyệt</NuxtLink>
      <p class="page-eyebrow">Đối chiếu từng bản</p>
      <h1 class="page-title">{{ row?.student.fullName ?? 'Xét duyệt điểm rèn luyện' }}</h1>
    </header>
    <div v-if="error" class="tp-notice tp-notice--error" role="alert" tabindex="-1">
      <p>{{ error.message }}</p>
      <ul v-if="error.issues?.length">
        <li v-for="i in error.issues" :key="i.path">
          <a :href="'#assessed-' + i.path" @click.prevent="focusIssue(i.path)"
            >{{ i.path }}: {{ i.message }}</a
          >
        </li>
      </ul>
    </div>
    <p v-if="message" class="tp-notice" role="status">{{ message }}</p>
    <p v-if="busy" role="status">Đang xử lý…</p>
    <button class="button button--secondary" :disabled="busy" @click="reload">
      Tải lại kết quả
    </button>
    <template v-if="row"
      ><section class="tp-panel">
        <h2>{{ reviewLabels[row.state] }}</h2>
        <p>{{ row.student.studentCode }} · {{ row.student.classCode }} · {{ row.period.name }}</p>
        <p>{{ row.period.academicYear }} · {{ row.period.policyLabel }}</p>
        <p>
          Điểm sinh viên tự khai: <strong>{{ row.totalPoints }} / 100</strong>
        </p>
        <p>
          {{
            row.state === 'APPROVED'
              ? 'Điểm khoa đã duyệt'
              : row.canAdvisorSign
                ? 'Điểm đang đối chiếu'
                : 'Điểm cố vấn đã xác nhận'
          }}: <strong>{{ total }} / 100</strong>
        </p>
        <p class="tp-muted">
          Bản sinh viên đã nộp được giữ nguyên. Xác nhận nghiệp vụ có tài khoản, thời gian và mã đối
          chiếu; chưa phải chữ ký số đã xác minh. Bộ tiêu chí giả chưa tạo xếp loại chính thức.
        </p>
      </section>
      <section class="tp-panel">
        <h2>Điểm và minh chứng A–E</h2>
        <template v-for="c in row.period.criteria" :key="c.code"
          ><fieldset class="tp-group" :disabled="busy || !row.canAdvisorSign || stale || !!pending">
            <legend>Nhóm {{ c.code }} — {{ c.label }}</legend>
            <p>Điểm sinh viên: {{ row.answers[c.code]?.points }} / {{ c.maxPoints }}</p>
            <p class="tp-muted">
              {{ row.answers[c.code]?.note || 'Không có giải trình của sinh viên.' }}
            </p>
            <p v-if="c.evidenceRequired" class="tp-muted">
              Nhóm này cần minh chứng trong bản nộp gốc khi điểm xét duyệt lớn hơn 0.
            </p>
            <div class="tp-grid">
              <label class="tp-field" :for="'assessed-' + c.code"
                >Điểm xét duyệt {{ c.code }} / {{ c.maxPoints
                }}<input
                  :id="'assessed-' + c.code"
                  :value="answers[c.code]!.points ?? ''"
                  @input="setPoints(c.code, $event)"
                  type="number"
                  min="0"
                  :max="c.maxPoints"
                  step="1"
                  :aria-invalid="
                    error?.issues?.some((i) => i.path === c.code) || undefined
                  " /></label
              ><label class="tp-field" :for="'review-note-' + c.code"
                >Nhận xét nhóm {{ c.code
                }}<textarea
                  :id="'review-note-' + c.code"
                  v-model="answers[c.code]!.note"
                  rows="3"
                  maxlength="2000"
                />
              </label>
            </div>
            <p v-if="error?.issues?.some((i) => i.path === c.code)" class="tp-error">
              {{
                error.issues
                  .filter((i) => i.path === c.code)
                  .map((i) => i.message)
                  .join(' ')
              }}
            </p>
          </fieldset>
          <p v-if="!row.files.some((f) => f.criterion === c.code)" class="tp-muted">
            Chưa có minh chứng cho nhóm {{ c.code }}.
          </p>
          <ul class="tp-files">
            <li v-for="f in row.files.filter((f) => f.criterion === c.code)" :key="f.id">
              <strong>{{ c.code }} · {{ f.name }}</strong>
              <p class="tp-muted">Chưa kiểm tra chữ ký / dấu</p>
              <button class="button button--secondary" :disabled="busy" @click="download(f)">
                Tải {{ f.name }}
              </button>
            </li>
          </ul></template
        >
      </section>
      <section v-if="row.canAdvisorSign || row.canFacultyDecide" class="tp-panel">
        <h2>Nhận xét và xử lý</h2>
        <label class="tp-field" for="review-comment"
          >Nhận xét xử lý (bắt buộc)<textarea
            id="review-comment"
            v-model="comment"
            rows="4"
            maxlength="2000"
            :disabled="busy || stale || !!pending"
          />
        </label>
        <p class="tp-muted">
          Khi điều chỉnh điểm, giải trình ở đúng nhóm. Khoa trả về để cố vấn xác nhận lại; khoa
          không sửa trực tiếp điểm.
        </p>
        <div class="tp-actions">
          <button
            v-if="row.canAdvisorSign"
            class="button"
            :disabled="busy || stale"
            @click="prepare('advisor-sign')"
          >
            Kiểm tra xác nhận cố vấn</button
          ><template v-if="row.canFacultyDecide"
            ><button class="button" :disabled="busy || stale" @click="prepare('faculty-approve')">
              Kiểm tra duyệt của khoa</button
            ><button
              class="button button--secondary"
              :disabled="busy || stale"
              @click="prepare('faculty-return')"
            >
              Kiểm tra trả về cố vấn
            </button></template
          >
        </div>
        <div v-if="pending" id="review-confirm" class="tp-confirm" tabindex="-1">
          <h2>{{ actionLabel }}</h2>
          <p>{{ row.student.fullName }} · {{ row.student.studentCode }}</p>
          <p>Điểm xét duyệt: {{ total }} / 100 · {{ comment || 'Chưa nhập nhận xét xử lý.' }}</p>
          <p v-if="Object.values(answers).some((a) => a.points === null)" class="tp-error">
            Chưa nhập đủ điểm xét duyệt A–E. Quay lại đối chiếu để điền các ô trống.
          </p>
          <p>Thao tác ghi lịch sử cố định. Duyệt của khoa kết thúc quy trình của bản này.</p>
          <label class="tp-check"
            ><input v-model="accepted" type="checkbox" :disabled="busy" />Tôi đã đối chiếu điểm,
            minh chứng và nhận xét</label
          >
          <div class="tp-actions">
            <button
              class="button"
              :disabled="
                busy ||
                !accepted ||
                !comment.trim() ||
                Object.values(answers).some((a) => a.points === null)
              "
              @click="submit"
            >
              {{ actionLabel }}</button
            ><button class="button button--secondary" :disabled="busy" @click="cancelConfirmation">
              Quay lại đối chiếu
            </button>
          </div>
        </div>
      </section>
      <section class="tp-panel" aria-label="Lịch sử xét duyệt">
        <h2>Lịch sử xét duyệt</h2>
        <p v-if="!row.decisions.length">Chưa có xác nhận của cố vấn.</p>
        <ol class="tp-history">
          <li v-for="d in row.decisions" :key="d.id">
            <strong>{{ reviewActions[d.action] }} · {{ d.totalPoints }} / 100</strong>
            <p>{{ d.actor.fullName }} · {{ trainingDate(d.confirmedAt) }}</p>
            <p>{{ d.comment }}</p>
            <details>
              <summary>Mã đối chiếu và điểm từng nhóm</summary>
              <p v-for="c in row.period.criteria" :key="c.code">
                {{ c.code }}: {{ d.answers[c.code]?.points }} / {{ c.maxPoints }} ·
                {{ d.answers[c.code]?.note || 'Không có nhận xét' }}
              </p>
              <p>Mã xác nhận: {{ d.payloadSha256 }}</p>
              <p>Bản tự kê khai: {{ d.declarationSha256 }}</p>
              <p>Chữ ký số: chưa xác minh.</p>
            </details>
          </li>
        </ol>
        <p v-if="row.historyTruncated" class="tp-muted">Hiển thị 100 cập nhật gần nhất.</p>
      </section></template
    >
  </section>
</template>
