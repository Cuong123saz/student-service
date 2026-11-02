<script setup lang="ts">
import type { MonitorAuditItem, ReviewRoster } from '~/types/training-review'
import type { TrainingError } from '~/types/training-point'
import { formatCohort } from '~/utils/cohort'
import { formatDateOfBirth } from '~/utils/date-of-birth'

/** ADR 0028: class roster for advisor/faculty/monitor, monitor appointment and audit. */
const props = defineProps<{ periodId: string }>()
const emit = defineEmits<{
  'lost-access': [error: TrainingError]
  loaded: [roster: ReviewRoster]
}>()
const api = useTrainingReviews(),
  roster = ref<ReviewRoster | null>(null),
  busy = ref(false),
  error = ref<TrainingError | null>(null),
  message = ref(''),
  candidate = ref(''),
  audit = ref<MonitorAuditItem[] | null>(null)
const declarationLabels = { NONE: 'Chưa kê khai', DRAFT: 'Đang soạn', SUBMITTED: 'Đã nộp' }
const auditLabels: Record<string, string> = {
  'training.monitor.roster_viewed': 'Xem danh sách lớp',
  'training.monitor.declaration_viewed': 'Xem phiếu',
  'training.monitor.evidence_downloaded': 'Tải minh chứng',
  'training.monitor.appointed': 'Bổ nhiệm lớp trưởng',
  'training.monitor.ended': 'Kết thúc nhiệm kỳ',
  'training.review.monitor_confirmed': 'Lớp trưởng xác nhận phiếu',
  'training.review.monitor_bypassed': 'Cố vấn bỏ qua bước lớp trưởng',
  'training.export.class-sheet.prepared': 'Tải bảng điểm lớp',
  'training.export.form.prepared': 'In phiếu',
}
let generation = 0
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
    if ([401, 403].includes(error.value.status ?? 0)) {
      roster.value = null
      audit.value = null
      emit('lost-access', error.value)
    }
  } finally {
    if (g === generation) busy.value = false
  }
}
const load = () =>
  run(async (g) => {
    const r = await api.roster(props.periodId)
    if (g !== generation) return
    roster.value = r
    emit('loaded', r)
  })
const appoint = (studentUserId: string | null) =>
  run(async (g) => {
    const r = await api.appointMonitor(props.periodId, studentUserId)
    if (g !== generation) return
    roster.value = r
    candidate.value = ''
    message.value = studentUserId ? 'Đã bổ nhiệm lớp trưởng.' : 'Đã kết thúc nhiệm kỳ lớp trưởng.'
  })
const loadAudit = () =>
  run(async (g) => {
    const r = await api.monitorAudit(props.periodId)
    if (g === generation) audit.value = r.items
  })
const print = (declarationId: string, format: 'form-docx' | 'form-pdf') =>
  run(async (g) => {
    const r = await api.exportPeriod(props.periodId, format, declarationId)
    if (g === generation) message.value = 'Đã tải ' + r.name + '.'
  })
watch(
  () => props.periodId,
  () => {
    generation++
    busy.value = false
    roster.value = null
    audit.value = null
    void load()
  },
)
onMounted(load)
onBeforeUnmount(() => {
  generation++
})
</script>
<template>
  <section class="tp-panel" aria-labelledby="training-roster-title">
    <h2 id="training-roster-title">Danh sách lớp</h2>
    <p v-if="busy && !roster" role="status">Đang tải danh sách lớp…</p>
    <div v-if="error" class="tp-notice tp-notice--error" role="alert">{{ error.message }}</div>
    <p v-if="message" class="tp-notice" role="status">{{ message }}</p>
    <template v-if="roster">
      <p>
        Lớp trưởng:
        <strong>{{ roster.monitor ? roster.monitor.fullName : 'Chưa bổ nhiệm' }}</strong>
      </p>
      <p class="tp-muted">
        Thông tin liên lạc và ngày sinh chỉ dùng cho công việc của lớp. Mọi lần lớp trưởng xem danh
        sách, mở phiếu, tải minh chứng hoặc in đều được ghi nhật ký cho cố vấn.
      </p>
      <div v-if="roster.canAppointMonitor" class="tp-grid">
        <label class="tp-field" for="monitor-candidate"
          >Bổ nhiệm lớp trưởng<select id="monitor-candidate" v-model="candidate" :disabled="busy">
            <option value="">Chọn sinh viên</option>
            <option v-for="s in roster.students" :key="s.userId" :value="s.userId">
              {{ s.studentCode }} · {{ s.fullName }}
            </option>
          </select></label
        >
        <div class="tp-actions">
          <BaseButton :disabled="busy || !candidate" @click="appoint(candidate)">
            Bổ nhiệm</BaseButton
          ><BaseButton
            v-if="roster.monitor"
            variant="secondary"
            :disabled="busy"
            @click="appoint(null)"
          >
            Kết thúc nhiệm kỳ</BaseButton
          ><BaseButton variant="secondary" :disabled="busy" @click="loadAudit">
            Xem nhật ký lớp trưởng</BaseButton
          >
        </div>
      </div>
      <div class="roster-wrap">
        <table class="roster-table">
          <thead>
            <tr>
              <th>Mã SV</th>
              <th>Họ và tên</th>
              <th>Niên khóa</th>
              <th>Ngày sinh</th>
              <th>Email</th>
              <th>Phiếu</th>
              <th>In phiếu đã duyệt</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in roster.students" :key="s.userId">
              <td>{{ s.studentCode }}</td>
              <td>{{ s.fullName }}<span v-if="s.isMonitor"> (lớp trưởng)</span></td>
              <td>{{ formatCohort(s.cohortYear) }}</td>
              <td>{{ formatDateOfBirth(s.dateOfBirth) }}</td>
              <td>{{ s.email || 'Chưa có' }}</td>
              <td>{{ declarationLabels[s.declarationState] }}</td>
              <td>
                <template v-if="s.declarationId && s.declarationState === 'SUBMITTED'"
                  ><BaseButton
                    variant="secondary"
                    :disabled="busy"
                    @click="print(s.declarationId, 'form-docx')"
                    >Word</BaseButton
                  ><BaseButton
                    variant="secondary"
                    :disabled="busy"
                    @click="print(s.declarationId, 'form-pdf')"
                    >PDF</BaseButton
                  ></template
                >
                <span v-else>—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="roster.truncated" class="tp-muted">Chỉ hiển thị 1.000 sinh viên đầu.</p>
      <section v-if="audit" aria-label="Nhật ký lớp trưởng">
        <h3>Nhật ký lớp trưởng</h3>
        <p v-if="!audit.length">Chưa có thao tác nào.</p>
        <div v-else class="roster-wrap">
          <table class="roster-table">
            <thead>
              <tr>
                <th>Thời điểm</th>
                <th>Tài khoản</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in audit" :key="item.id">
                <td>{{ new Date(item.occurredAt).toLocaleString('vi-VN') }}</td>
                <td>{{ item.actor }}</td>
                <td>{{ auditLabels[item.action] ?? item.action }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </section>
</template>
<style scoped>
.roster-wrap {
  overflow-x: auto;
  max-width: 100%;
}
.roster-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.95rem;
}
.roster-table th,
.roster-table td {
  border-bottom: 1px solid var(--color-border, #d0d5dd);
  padding: 8px;
  text-align: left;
  vertical-align: middle;
  white-space: nowrap;
}
.roster-table td :deep(.base-button) {
  margin-right: 6px;
}
</style>
