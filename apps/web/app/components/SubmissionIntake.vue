<script setup lang="ts">
import type {
  ReviewSubmissionDetail,
  ReviewSubmissionSummary,
  ResolutionAction,
  ReviewQueueQuery,
} from '~/types/submission'
import type { SessionUser } from '~/types/auth'
import type { ProcedureApiError } from '~/types/procedure'
import {
  formatSubmissionAnswer,
  formatSubmissionTime,
  submissionStatusLabels,
  resolutionActionLabels,
} from '~/utils/submission'
const props = defineProps<{ portal: 'user' | 'admin'; id?: string }>()
const api = useReviewSubmissions(props.portal)
const basePath = props.portal === 'admin' ? '/admin/review-submissions' : '/review-submissions'
const selectedStatus = ref<ReviewSubmissionSummary['status']>('SUBMITTED')
const entries = ref<ReviewSubmissionSummary[]>([])
const sessionUser = useState<SessionUser | null>(props.portal + '-session-user', () => null)
const searchText = ref('')
const assignment = ref<NonNullable<ReviewQueueQuery['assignment']>>('ALL')
const queueApplied = ref<ReviewQueueQuery>({ status: 'SUBMITTED', assignment: 'ALL', q: '' })
const queueCursor = ref<string | null>(null)
const queueRetryMore = ref(false)
const queueMoreLoading = ref(false)
let mounted = false
const detail = ref<ReviewSubmissionDetail | null>(null)
const loading = ref(true)
const claiming = ref(false)
const failure = ref<ProcedureApiError | null>(null)
const reloadRequired = ref(false)
const message = ref('')
const resolving = ref(false)
const handingOver = ref(false)
const resolutionAction = ref<ResolutionAction | ''>('')
const resolutionNote = ref('')
const resolutionReviewed = ref(false)
const resolutionConfirmed = ref(false)
const resolutionSummary = ref<HTMLElement | null>(null)
const queueGroups: { status: ReviewSubmissionSummary['status']; label: string }[] = [
  { status: 'SUBMITTED', label: 'Chờ tiếp nhận' },
  { status: 'IN_REVIEW', label: 'Đang xử lý' },
  { status: 'NEEDS_SUPPLEMENT', label: 'Chờ bổ sung' },
  { status: 'APPROVED', label: 'Đã duyệt nội dung' },
  { status: 'REJECTED', label: 'Không chấp thuận' },
]
const queueEmptyLabels = {
  SUBMITTED: 'Chưa có hồ sơ chờ tiếp nhận',
  IN_REVIEW: 'Chưa có hồ sơ đang xử lý',
  NEEDS_SUPPLEMENT: 'Chưa có hồ sơ chờ bổ sung',
  APPROVED: 'Chưa có hồ sơ đã duyệt nội dung',
  REJECTED: 'Chưa có hồ sơ không chấp thuận',
}
const resolutionNoteIssue = computed(
  () => failure.value?.issues?.find((issue) => issue.path === 'note')?.message,
)
const latestResolution = computed(() =>
  [...(detail.value?.events ?? [])]
    .reverse()
    .find((event) => ['SUPPLEMENT_REQUESTED', 'APPROVED', 'REJECTED'].includes(event.action)),
)
const normalizedNote = computed(() => resolutionNote.value.trim())
const validNote = computed(
  () => normalizedNote.value.length > 0 && normalizedNote.value.length <= 2000,
)
const resolutionAvailable = computed(
  () =>
    detail.value?.status === 'IN_REVIEW' &&
    Boolean(resolutionAction.value) &&
    detail.value.allowedActions.includes(resolutionAction.value as ResolutionAction),
)
const canResolve = computed(
  () =>
    resolutionAvailable.value &&
    validNote.value &&
    resolutionReviewed.value &&
    resolutionConfirmed.value &&
    !resolving.value &&
    !handingOver.value &&
    !claiming.value &&
    !loading.value &&
    !reloadRequired.value,
)
function resetResolutionConfirmation() {
  resolutionReviewed.value = false
  resolutionConfirmed.value = false
}
watch([resolutionAction, resolutionNote], resetResolutionConfirmation, { flush: 'sync' })
function reviewResolution() {
  if (
    !resolutionAvailable.value ||
    !validNote.value ||
    loading.value ||
    reloadRequired.value ||
    resolving.value ||
    handingOver.value
  )
    return
  resolutionReviewed.value = true
  resolutionConfirmed.value = false
  void nextTick(() => resolutionSummary.value?.focus())
}
async function resolveSubmission() {
  if (!canResolve.value || !detail.value || !resolutionAction.value) return
  const sequence = loadSequence
  const { id, revision } = detail.value
  const action = resolutionAction.value
  const note = normalizedNote.value
  resolving.value = true
  failure.value = null
  message.value = ''
  resolutionConfirmed.value = false
  try {
    const current = await api.resolve(id, revision, action, note)
    if (sequence !== loadSequence || props.id !== id) return
    detail.value = current
    message.value =
      action === 'REQUEST_SUPPLEMENT'
        ? 'Đã gửi yêu cầu bổ sung trong hồ sơ.'
        : action === 'APPROVE'
          ? 'Đã ghi quyết định duyệt nội dung.'
          : 'Đã ghi quyết định không chấp thuận.'
    resolutionAction.value = ''
    resolutionNote.value = ''
    resetResolutionConfirmation()
  } catch (error) {
    if (sequence !== loadSequence || props.id !== id) return
    const context = error as ProcedureApiError
    if (!context.status || context.status === 409 || context.status >= 500)
      reloadRequired.value = true
    resetResolutionConfirmation()
    fail(error)
  } finally {
    if (sequence === loadSequence) resolving.value = false
  }
}
function handoverUpdated(current: ReviewSubmissionDetail) {
  detail.value = current
  message.value = 'Đã bàn giao hồ sơ cho cán bộ mới.'
  resetResolutionConfirmation()
}
function handoverFailed(error: ProcedureApiError) {
  if (!error.status || error.status === 409 || error.status >= 500) reloadRequired.value = true
  resetResolutionConfirmation()
  fail(error)
}
const errorSummary = ref<HTMLElement | null>(null)
let loadSequence = 0
function fail(error: unknown) {
  failure.value = error as ProcedureApiError
  void nextTick(() => errorSummary.value?.focus())
}
async function load(more = false) {
  if (claiming.value || resolving.value || handingOver.value) return
  resetResolutionConfirmation()
  const sequence = ++loadSequence
  const identity = sessionUser.value?.id ?? null
  queueRetryMore.value = more
  queueMoreLoading.value = more
  if (!props.id && !more) {
    entries.value = []
    queueCursor.value = null
  }
  loading.value = true
  message.value = ''
  try {
    if (props.id) {
      const current = await api.get(props.id)
      if (sequence !== loadSequence) return
      detail.value = current
      if (resolutionAction.value && !current.allowedActions.includes(resolutionAction.value))
        resolutionAction.value = ''
    } else {
      const current = await api.list({
        ...queueApplied.value,
        ...(more && queueCursor.value ? { cursor: queueCursor.value } : {}),
      })
      if (sequence !== loadSequence || identity !== (sessionUser.value?.id ?? null)) return
      entries.value = more
        ? [
            ...entries.value,
            ...current.items.filter((row) => !entries.value.some((old) => old.id === row.id)),
          ]
        : current.items
      queueCursor.value = current.nextCursor
    }
    failure.value = null
    reloadRequired.value = false
  } catch (error) {
    if (sequence === loadSequence) {
      if (detail.value) reloadRequired.value = true
      const status = (error as ProcedureApiError).status
      if (!props.id && (status === 401 || status === 403)) {
        entries.value = []
        queueCursor.value = null
        queueRetryMore.value = false
      }
      fail(error)
    }
  } finally {
    if (sequence === loadSequence) {
      loading.value = false
      queueMoreLoading.value = false
    }
  }
}
function applyFilters() {
  if (props.id) return
  queueApplied.value = {
    status: selectedStatus.value,
    assignment: assignment.value,
    q: searchText.value.trim(),
  }
  failure.value = null
  reloadRequired.value = false
  void load()
}
function clearFilters() {
  searchText.value = ''
  assignment.value = 'ALL'
  applyFilters()
}
function retryLoad() {
  void load(props.id ? false : queueRetryMore.value)
}
function selectStatus(status: ReviewSubmissionSummary['status']) {
  if (props.id || status === selectedStatus.value) return
  selectedStatus.value = status
  applyFilters()
}
async function claim() {
  if (
    !detail.value?.canClaim ||
    detail.value.status !== 'SUBMITTED' ||
    reloadRequired.value ||
    loading.value ||
    claiming.value ||
    resolving.value ||
    handingOver.value
  )
    return
  const sequence = loadSequence
  const { id, revision } = detail.value
  claiming.value = true
  failure.value = null
  message.value = ''
  try {
    const current = await api.claim(id, revision)
    if (sequence !== loadSequence || props.id !== id) return
    detail.value = current
    message.value = 'Đã nhận hồ sơ để xử lý.'
  } catch (error) {
    if (sequence !== loadSequence || props.id !== id) return
    reloadRequired.value = true
    fail(error)
  } finally {
    if (sequence === loadSequence) claiming.value = false
  }
}
onMounted(() => {
  mounted = true
  void load()
})
watch(
  () => sessionUser.value?.id ?? null,
  () => {
    loadSequence++
    entries.value = []
    queueCursor.value = null
    detail.value = null
    failure.value = null
    message.value = ''
    loading.value = false
    claiming.value = false
    resolving.value = false
    handingOver.value = false
    resolutionAction.value = ''
    resolutionNote.value = ''
    resetResolutionConfirmation()
    queueRetryMore.value = false
    queueMoreLoading.value = false
    searchText.value = ''
    assignment.value = 'ALL'
    selectedStatus.value = 'SUBMITTED'
    queueApplied.value = { status: 'SUBMITTED', assignment: 'ALL', q: '' }
    reloadRequired.value = false
    if (mounted && sessionUser.value) void load()
  },
  { flush: 'sync' },
)
onBeforeUnmount(() => {
  mounted = false
  loadSequence += 1
})
watch(
  () => props.id,
  () => {
    detail.value = null
    failure.value = null
    reloadRequired.value = false
    resolutionAction.value = ''
    resolutionNote.value = ''
    resetResolutionConfirmation()
    loadSequence += 1
    claiming.value = false
    resolving.value = false
    handingOver.value = false
    void load()
  },
)
</script>

<template>
  <section class="intake-page" :class="{ 'intake-page--user': portal === 'user' }">
    <NuxtLink v-if="id" class="intake-back" :to="basePath">← Tiếp nhận hồ sơ</NuxtLink>
    <header class="intake-heading">
      <div>
        <p class="page-eyebrow">Tiếp nhận hồ sơ</p>
        <h1 class="page-title">{{ id ? 'Chi tiết hồ sơ' : 'Hồ sơ gửi đến đơn vị' }}</h1>
        <p class="page-description">
          {{
            id
              ? 'Đối chiếu thông tin và minh chứng đã được sinh viên gửi.'
              : 'Mỗi lần tải tối đa 20 hồ sơ trong phạm vi được phân công, theo thời gian gửi đầu tiên sớm nhất.'
          }}
        </p>
      </div>
      <BaseButton
        v-if="!loading && !reloadRequired"
        type="button"
        variant="secondary"
        :loading="claiming || resolving"
        @click="load()"
        >Tải lại</BaseButton
      >
    </header>
    <div v-if="!id" class="intake-filters" role="group" aria-label="Trạng thái hồ sơ">
      <BaseButton
        v-for="group in queueGroups"
        :key="group.status"
        type="button"
        :variant="selectedStatus === group.status ? 'primary' : 'secondary'"
        :aria-pressed="selectedStatus === group.status"
        @click="selectStatus(group.status)"
        >{{ group.label }}</BaseButton
      >
    </div>
    <form
      v-if="!id"
      class="queue-search"
      aria-label="Bộ lọc hàng đợi"
      @submit.prevent="applyFilters"
    >
      <div>
        <label for="queue-search">Tìm hồ sơ</label
        ><input
          id="queue-search"
          v-model="searchText"
          type="search"
          maxlength="100"
          placeholder="Tên, mã sinh viên hoặc thủ tục"
          aria-describedby="queue-search-help"
        /><small id="queue-search-help"
          >Tìm trong thông tin khi gửi; có phân biệt dấu tiếng Việt.</small
        >
      </div>
      <div>
        <label for="queue-assignment">Phân công</label
        ><select id="queue-assignment" v-model="assignment">
          <option value="ALL">Tất cả trong phạm vi</option>
          <option value="MINE">Tôi đang xử lý</option>
          <option value="UNASSIGNED">Chưa có người nhận</option>
        </select>
      </div>
      <BaseButton type="submit">Áp dụng bộ lọc</BaseButton>
      <BaseButton type="button" variant="secondary" @click="clearFilters">Xóa bộ lọc</BaseButton>
    </form>
    <div v-if="failure" ref="errorSummary" class="intake-error" role="alert" tabindex="-1">
      <strong>{{ failure.message }}</strong>
      <p v-if="detail">
        Thông tin bên dưới là lần tải thành công trước. Tải lại để kiểm tra trạng thái và quyền tiếp
        nhận và xử lý hiện tại.
      </p>
      <p v-if="reloadRequired">
        Cần kiểm tra lại trạng thái trước khi thực hiện thao tác tiếp theo. Lý do đang nhập được giữ
        lại; chưa thể xác định thao tác trước đã được ghi hay chưa.
      </p>
      <p v-if="failure.requestId">Mã hỗ trợ: {{ failure.requestId }}</p>
      <BaseButton type="button" variant="secondary" :loading="loading" @click="retryLoad">{{
        reloadRequired ? 'Tải lại trạng thái hồ sơ' : 'Thử lại'
      }}</BaseButton>
      <NuxtLink v-if="failure.status === 401" :to="portal === 'admin' ? '/admin/login' : '/login'"
        >Đăng nhập lại</NuxtLink
      >
    </div>
    <p v-if="loading" class="intake-state" role="status">Đang tải hồ sơ…</p>
    <p v-if="message" class="intake-success" role="status">{{ message }}</p>
    <template v-if="id && detail">
      <article class="intake-panel">
        <header class="intake-heading">
          <h2>{{ detail.serviceName }}</h2>
          <span class="intake-badge" role="status">{{
            submissionStatusLabels[detail.status]
          }}</span>
        </header>
        <dl class="intake-meta">
          <div>
            <dt>Đơn vị xử lý</dt>
            <dd>{{ detail.processingUnitName }}</dd>
          </div>
          <div>
            <dt>Thời gian gửi</dt>
            <dd>
              <time :datetime="detail.submittedAt">{{
                formatSubmissionTime(detail.submittedAt)
              }}</time>
            </dd>
          </div>
          <div>
            <dt>Cán bộ nhận xử lý</dt>
            <dd>{{ detail.reviewerName ?? 'Chưa có người nhận' }}</dd>
          </div>
          <div v-if="detail.reviewStartedAt">
            <dt>Bắt đầu xử lý</dt>
            <dd>
              <time :datetime="detail.reviewStartedAt">{{
                formatSubmissionTime(detail.reviewStartedAt)
              }}</time>
            </dd>
          </div>
          <div>
            <dt>Lần gửi gần nhất</dt>
            <dd>{{ detail.roundNumber }} · {{ formatSubmissionTime(detail.lastSubmittedAt) }}</dd>
          </div>
          <div v-if="detail.decisionAt">
            <dt>Quyết định nội dung</dt>
            <dd>{{ formatSubmissionTime(detail.decisionAt) }}</dd>
          </div>
        </dl>
        <BaseButton
          v-if="detail.canClaim && detail.status === 'SUBMITTED'"
          type="button"
          :loading="claiming"
          :disabled="loading || reloadRequired"
          @click="claim"
          >Nhận xử lý</BaseButton
        >
        <p v-else-if="detail.status === 'SUBMITTED'" class="intake-help">
          Bạn hiện không thể nhận xử lý hồ sơ này.
        </p>
      </article>
      <article
        v-if="detail.status === 'IN_REVIEW' && detail.allowedActions.length"
        class="intake-panel intake-resolution"
      >
        <h2>Quyết định xử lý</h2>
        <p class="intake-help">
          Chọn hành động, ghi lý do cụ thể rồi xem lại và xác nhận. Quyết định này ghi nhận việc xử
          lý nội dung; chưa cấp văn bản hoặc xác minh chữ ký số.
        </p>
        <fieldset
          :disabled="loading || claiming || resolving || handingOver || reloadRequired"
          class="resolution-fields"
        >
          <label for="resolution-action">Hành động *</label>
          <select id="resolution-action" v-model="resolutionAction">
            <option value="">Chọn hành động</option>
            <option v-for="action in detail.allowedActions" :key="action" :value="action">
              {{ resolutionActionLabels[action] }}
            </option>
          </select>
          <label for="resolution-note">Lý do / nội dung yêu cầu *</label>
          <textarea
            id="resolution-note"
            v-model="resolutionNote"
            rows="5"
            maxlength="2000"
            :aria-invalid="Boolean(resolutionNoteIssue) || (Boolean(resolutionNote) && !validNote)"
            :aria-describedby="
              resolutionNoteIssue
                ? 'resolution-note-help resolution-note-error'
                : 'resolution-note-help'
            "
          />
          <small id="resolution-note-help" class="intake-help"
            >Nhập 1–2000 ký tự sau khi bỏ khoảng trắng đầu và cuối. {{ normalizedNote.length }}/2000
            ký tự.</small
          >
          <p v-if="resolutionNoteIssue" id="resolution-note-error" class="resolution-error">
            {{ resolutionNoteIssue }}
          </p>
          <BaseButton
            type="button"
            variant="secondary"
            :disabled="!resolutionAvailable || !validNote"
            @click="reviewResolution"
            >Xem lại quyết định</BaseButton
          >
          <div
            v-if="resolutionReviewed"
            ref="resolutionSummary"
            tabindex="-1"
            class="resolution-summary"
            aria-label="Xem lại quyết định"
          >
            <h3>{{ resolutionActionLabels[resolutionAction as ResolutionAction] }}</h3>
            <p class="resolution-note">{{ normalizedNote }}</p>
            <label class="resolution-confirm" for="resolution-confirm"
              ><input id="resolution-confirm" v-model="resolutionConfirmed" type="checkbox" /><span
                >Tôi đã đối chiếu hồ sơ và xác nhận hành động cùng lý do trên.</span
              ></label
            >
            <BaseButton
              type="button"
              :loading="resolving"
              :disabled="!canResolve"
              @click="resolveSubmission"
              >Ghi quyết định</BaseButton
            >
          </div>
        </fieldset>
      </article>
      <p v-else-if="detail.status === 'IN_REVIEW'" class="intake-help">
        Bạn không có hành động quyết định đối với hồ sơ này. Chỉ cán bộ đã nhận và còn đủ quyền mới
        được quyết định.
      </p>
      <SubmissionReassignment
        :key="detail.id"
        :detail="detail"
        :portal="portal"
        :blocked="loading || reloadRequired || claiming || resolving"
        @pending="handingOver = $event"
        @updated="handoverUpdated"
        @failed="handoverFailed"
      />
      <p v-if="detail.status === 'NEEDS_SUPPLEMENT'" class="intake-warning">
        Đang chờ sinh viên bổ sung. Thông tin bên dưới là lần gửi {{ detail.roundNumber }} đã chốt;
        phần sinh viên đang sửa chưa được chuyển đến cán bộ.
      </p>
      <p v-if="detail.status === 'APPROVED' || detail.status === 'REJECTED'" class="intake-warning">
        Đây là quyết định nội dung trong ứng dụng. Chưa xác nhận đã cấp văn bản, ký số hoặc xác minh
        chữ ký.
      </p>
      <details v-if="resolutionNote && !detail.allowedActions.length" class="intake-panel">
        <summary>Lý do đã nhập trước khi kiểm tra trạng thái</summary>
        <p class="resolution-note">{{ resolutionNote }}</p>
        <p class="intake-help">
          Đối chiếu với diễn biến xử lý bên dưới. Nội dung đang giữ tại trang này không tự gửi lại.
        </p>
      </details>
      <p
        v-if="
          ['NEEDS_SUPPLEMENT', 'APPROVED', 'REJECTED'].includes(detail.status) &&
          latestResolution?.note
        "
        class="intake-panel resolution-note"
      >
        <strong>Lý do xử lý:</strong> {{ latestResolution.note }}
      </p>
      <div class="intake-columns">
        <article class="intake-panel">
          <h2>Thông tin sinh viên khi gửi</h2>
          <dl class="intake-meta">
            <div>
              <dt>Họ và tên</dt>
              <dd>{{ detail.studentSnapshot.fullName }}</dd>
            </div>
            <div>
              <dt>Mã sinh viên</dt>
              <dd>{{ detail.studentSnapshot.studentCode }}</dd>
            </div>
            <div>
              <dt>Lớp</dt>
              <dd>{{ detail.studentSnapshot.classCode }}</dd>
            </div>
            <div>
              <dt>Khoa</dt>
              <dd>{{ detail.studentSnapshot.facultyCode }}</dd>
            </div>
          </dl>
          <h2>Thông tin kê khai</h2>
          <p class="intake-help">
            Biểu mẫu v{{ detail.procedure.versionNumber }} · Nội dung của lần gửi
            {{ detail.roundNumber }} gần nhất.
          </p>
          <dl class="intake-answers">
            <div v-for="field in detail.procedure.fields" :key="field.key">
              <dt>{{ field.label }}</dt>
              <dd>{{ formatSubmissionAnswer(field, detail.values) }}</dd>
            </div>
          </dl>
        </article>
        <aside class="intake-panel">
          <h2>Minh chứng đã gửi</h2>
          <p class="intake-warning">
            Chữ ký chưa được xác minh. Hình dấu đỏ hoặc chữ ký trên tệp không phải kết quả xác minh
            chữ ký số.
          </p>
          <p v-if="!detail.files.length" class="intake-help">Hồ sơ không có tệp minh chứng.</p>
          <ul v-else class="intake-files">
            <li v-for="file in detail.files" :key="file.id">
              <strong>{{
                detail.procedure.attachments.find(
                  (attachment) => attachment.key === file.attachmentKey,
                )?.label ?? 'Minh chứng'
              }}</strong>
              <a :href="api.downloadUrl(detail.id, file.id)">{{ file.name }}</a>
              <small>{{ (file.size / 1024).toFixed(1) }} KiB · Chữ ký chưa được xác minh</small>
            </li>
          </ul>
          <h3>Hướng dẫn của đơn vị</h3>
          <p class="intake-instructions">{{ detail.procedure.contactInstructions }}</p>
        </aside>
      </div>
      <SubmissionDocumentDownloads
        :submission-id="detail.id"
        :round-number="detail.roundNumber"
        :review-portal="portal"
      />
      <SubmissionHistory
        :submission-id="detail.id"
        :review-portal="portal"
        :rounds="detail.rounds"
        :events="detail.events"
        :procedure="detail.procedure"
        :download-url="
          (roundNumber, fileId) => api.roundDownloadUrl(detail.id, roundNumber, fileId)
        "
      />
    </template>
    <template v-else-if="!id">
      <p v-if="entries.length" class="intake-help" role="status" aria-atomic="true">
        Đang hiển thị {{ entries.length }} hồ sơ theo bộ lọc đã áp dụng.
        {{ queueCursor ? 'Còn hồ sơ để tải thêm.' : 'Đã tải hết kết quả hiện có.' }}
      </p>
      <div v-if="!entries.length && !loading && !failure" class="intake-panel intake-empty">
        <h2>
          {{
            queueApplied.q || queueApplied.assignment !== 'ALL'
              ? 'Không tìm thấy hồ sơ phù hợp'
              : queueEmptyLabels[selectedStatus]
          }}
        </h2>
        <p>
          Không có hồ sơ khớp bộ lọc trong phạm vi được phân công. Thử đổi trạng thái hoặc xóa bộ
          lọc.
        </p>
      </div>
      <ul v-if="entries.length" class="intake-list" :aria-busy="loading">
        <li v-for="entry in entries" :key="entry.id">
          <NuxtLink :to="basePath + '/' + entry.id">
            <span class="intake-badge">{{ submissionStatusLabels[entry.status] }}</span>
            <h2>{{ entry.serviceName }}</h2>
            <p>
              <strong>{{ entry.student.fullName }}</strong> · {{ entry.student.studentCode }}
            </p>
            <dl class="intake-meta">
              <div>
                <dt>Đã gửi</dt>
                <dd>
                  <time :datetime="entry.submittedAt">{{
                    formatSubmissionTime(entry.submittedAt)
                  }}</time>
                </dd>
              </div>
              <div>
                <dt>Đơn vị xử lý</dt>
                <dd>{{ entry.processingUnitName }}</dd>
              </div>
              <div>
                <dt>Cán bộ nhận xử lý</dt>
                <dd>{{ entry.reviewerName ?? 'Chưa có người nhận' }}</dd>
              </div>
            </dl>
            <b>Xem hồ sơ →</b>
          </NuxtLink>
        </li>
      </ul>
      <BaseButton
        v-if="queueCursor && !failure"
        type="button"
        variant="secondary"
        :disabled="loading"
        @click="load(true)"
        >{{ queueMoreLoading ? 'Đang tải thêm…' : 'Tải thêm 20 hồ sơ' }}</BaseButton
      >
    </template>
  </section>
</template>

<style scoped>
.queue-search {
  display: flex;
  gap: 16px;
  align-items: flex-end;
  flex-wrap: wrap;
}
.queue-search > div {
  display: grid;
  gap: 8px;
  min-width: 0;
  flex: 1 1 230px;
}
.queue-search label {
  font-weight: 700;
}
.queue-search input,
.queue-search select {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: 12px;
  min-height: 44px;
  font: inherit;
  color: var(--color-text);
  background: var(--color-surface);
}
.queue-search small {
  color: var(--color-muted);
  line-height: 1.5;
}
.queue-search :focus-visible {
  outline: 3px solid var(--color-primary);
  outline-offset: 3px;
}

.resolution-error {
  color: var(--color-error);
}
.resolution-fields {
  border: 0;
  padding: 0;
  margin: 20px 0 0;
  display: grid;
  gap: 12px;
  min-width: 0;
}
.resolution-fields > label {
  font-weight: 700;
}
.resolution-fields select,
.resolution-fields textarea {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: 12px;
  min-height: 44px;
  font: inherit;
  color: var(--color-text);
  background: var(--color-surface);
}
.resolution-fields > button {
  justify-self: start;
}
.resolution-summary {
  background: var(--color-surface-subtle);
  padding: 20px;
  border-radius: var(--radius-sm);
}
.resolution-summary h3 {
  margin-top: 0;
}
.resolution-note {
  white-space: pre-wrap;
  line-height: 1.65;
}
.resolution-confirm {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  line-height: 1.65;
  min-height: 44px;
  margin: 16px 0;
}
.resolution-confirm input {
  width: 20px;
  height: 20px;
  flex: none;
  margin-top: 4px;
  accent-color: var(--color-primary);
}

.intake-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.intake-page {
  display: grid;
  gap: 24px;
  overflow-wrap: anywhere;
}
.intake-page--user {
  width: min(var(--container-width), calc(100% - 56px));
  margin: 0 auto;
}
.intake-back {
  color: var(--color-primary);
  font-weight: 700;
  min-height: 44px;
  display: inline-flex;
  align-items: center;
}
.intake-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
}
.intake-heading h2 {
  margin: 0;
}
.intake-heading > div {
  min-width: 0;
}
.intake-heading .page-description {
  margin-bottom: 0;
}
.intake-panel,
.intake-list a {
  padding: 26px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  min-width: 0;
}
.intake-panel h2 {
  font-size: 21px;
}
.intake-panel h3 {
  font-size: 17px;
  margin-top: 24px;
}
.intake-columns {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
  gap: 24px;
  align-items: start;
}
.intake-meta {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
  margin: 24px 0;
}
.intake-meta dt,
.intake-answers dt,
.intake-help {
  color: var(--color-muted);
  font-size: 14px;
  line-height: 1.65;
}
.intake-meta dd,
.intake-answers dd {
  margin: 6px 0 0;
  white-space: pre-wrap;
  line-height: 1.65;
}
.intake-answers > div {
  padding: 14px 0;
  border-bottom: 1px solid var(--color-border);
}
.intake-instructions {
  white-space: pre-wrap;
  line-height: 1.65;
}
.intake-badge {
  display: inline-flex;
  align-self: flex-start;
  padding: 8px 12px;
  border-radius: 999px;
  color: var(--color-primary);
  background: var(--color-primary-soft);
  font-size: 13px;
  font-weight: 700;
}
.intake-error,
.intake-warning,
.intake-success {
  padding: 16px;
  border-radius: var(--radius-sm);
  line-height: 1.65;
}
.intake-error {
  color: var(--color-error);
  background: var(--color-error-background);
}
.intake-error a {
  display: inline-flex;
  margin: 12px;
  color: inherit;
}
.intake-warning {
  color: var(--color-warning);
  background: var(--color-warning-background);
}
.intake-success {
  color: var(--color-success);
  background: var(--color-success-background);
}
.intake-state,
.intake-empty {
  padding: 32px;
}
.intake-list,
.intake-files {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 20px;
}
.intake-list {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.intake-list a {
  display: block;
  color: var(--color-text);
  text-decoration: none;
  height: 100%;
}
.intake-list a:hover {
  border-color: var(--color-primary);
}
.intake-list h2 {
  font-size: 20px;
  margin: 18px 0 12px;
}
.intake-list b,
.intake-files a {
  color: var(--color-primary);
}
.intake-files li {
  display: grid;
  gap: 10px;
  padding: 16px;
  border-radius: var(--radius-sm);
  background: var(--color-surface-subtle);
}
.intake-files a {
  min-height: 44px;
  display: inline-flex;
  align-items: center;
}
.intake-files small {
  color: var(--color-warning);
}
@media (max-width: 850px) {
  .intake-columns,
  .intake-list {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 640px) {
  .intake-page--user {
    width: calc(100% - 32px);
  }
  .intake-heading {
    flex-direction: column;
  }
  .intake-panel,
  .intake-list a {
    padding: 20px;
  }
  .intake-meta {
    grid-template-columns: 1fr;
    gap: 16px;
  }
}
</style>
