<script setup lang="ts">
import type { ReviewPeriod, ReviewQueue, ReviewState } from '~/types/training-review'
import type { TrainingError } from '~/types/training-point'
import { reviewLabels } from '~/utils/training-review'
definePageMeta({ middleware: 'user-auth' })
const api = useTrainingReviews(),
  periods = ref<ReviewPeriod[]>([]),
  queue = ref<ReviewQueue | null>(null),
  periodId = ref(''),
  state = ref<ReviewState | ''>(''),
  busy = ref(false),
  error = ref<TrainingError | null>(null),
  truncated = ref(false)
let generation = 0
async function load(initial = false, cursor?: string) {
  const g = ++generation
  busy.value = true
  error.value = null
  if (!cursor) queue.value = null
  try {
    if (initial) {
      const r = await api.periods()
      if (g !== generation) return
      periods.value = r.items
      truncated.value = r.truncated
      periodId.value = periods.value[0]?.id ?? ''
    }
    if (!periodId.value) return
    const r = await api.queue(periodId.value, cursor, state.value || undefined)
    if (g !== generation) return
    queue.value = cursor && queue.value ? { ...r, items: [...queue.value.items, ...r.items] } : r
  } catch (e) {
    if (g !== generation) return
    error.value = e as TrainingError
    queue.value = null
    if ([401, 403, 404].includes(error.value.status ?? 0)) periods.value = []
  } finally {
    if (g === generation) busy.value = false
  }
}
onMounted(() => load(true))
onBeforeUnmount(() => {
  generation++
})
</script>
<template>
  <section class="training-workspace training-workspace--student">
    <header>
      <NuxtLink to="/portal">← Cổng của tôi</NuxtLink>
      <p class="page-eyebrow">Cố vấn và khoa</p>
      <h1 class="page-title">Xét duyệt điểm rèn luyện</h1>
      <p class="page-description">
        Đối chiếu từng bản đã nộp, xem minh chứng và tổng hợp theo lớp.
      </p>
    </header>
    <p class="tp-notice">
      Bộ tiêu chí đang dùng có thể là dữ liệu giả. Xác nhận bằng tài khoản được ghi vào lịch sử;
      chưa phải chữ ký số được xác minh.
    </p>
    <div v-if="error" class="tp-notice tp-notice--error" role="alert">{{ error.message }}</div>
    <p v-if="busy" role="status">Đang tải kết quả…</p>
    <section class="tp-panel">
      <div class="tp-grid">
        <label class="tp-field" for="review-period"
          >Đợt và lớp<select
            id="review-period"
            v-model="periodId"
            :disabled="busy"
            @change="load()"
          >
            <option value="">Chọn đợt</option>
            <option v-for="p in periods" :key="p.id" :value="p.id">
              {{ p.classCode }} · {{ p.name }} · {{ p.academicYear }}
            </option>
          </select></label
        ><label class="tp-field" for="review-state"
          >Trạng thái<select id="review-state" v-model="state" :disabled="busy" @change="load()">
            <option value="">Tất cả bản đã nộp</option>
            <option v-for="(label, key) in reviewLabels" :key="key" :value="key">
              {{ label }}
            </option>
          </select></label
        >
      </div>
      <div class="tp-actions">
        <button class="button button--secondary" :disabled="busy" @click="load(true)">
          Tải lại danh sách
        </button>
      </div>
      <p v-if="!busy && !error && !periods.length" class="tp-muted">
        Chưa có đợt thuộc quyền, phạm vi và phân công hiện tại của bạn.
      </p>
      <p v-if="truncated" class="tp-muted">Hiển thị 200 đợt gần nhất trong phạm vi.</p>
    </section>
    <template v-if="queue"
      ><section class="tp-panel" aria-label="Tổng hợp cấp lớp">
        <h2>Tổng hợp {{ queue.period.classCode }}</h2>
        <p>{{ queue.period.name }} · {{ queue.period.academicYear }}</p>
        <div class="tp-grid">
          <p>
            Đã nộp: <strong>{{ queue.summary.submitted }}</strong>
          </p>
          <p>
            Chờ cố vấn: <strong>{{ queue.summary.waitingAdvisor }}</strong>
          </p>
          <p>
            Chờ khoa: <strong>{{ queue.summary.waitingFaculty }}</strong>
          </p>
          <p>
            Khoa trả về: <strong>{{ queue.summary.returnedToAdvisor }}</strong>
          </p>
          <p>
            Khoa đã duyệt: <strong>{{ queue.summary.approved }}</strong>
          </p>
          <p>
            Điểm trung bình đã duyệt:
            <strong>{{ queue.summary.approvedAveragePoints ?? 'Chưa có' }}</strong>
          </p>
        </div>
        <p class="tp-muted">
          Thống kê trên các bản đã nộp của đợt. Điểm chỉ tính vào trung bình sau khi khoa duyệt;
          chưa suy xếp loại từ bộ tiêu chí giả.
        </p>
      </section>
      <section class="tp-panel">
        <h2>Bản kê khai đã nộp</h2>
        <p v-if="!queue.items.length">Chưa có bản phù hợp bộ lọc.</p>
        <ul class="tp-files">
          <li v-for="r in queue.items" :key="r.id">
            <h3>{{ r.student.fullName }} · {{ r.student.studentCode }}</h3>
            <p>
              {{ reviewLabels[r.state] }} · Tự kê khai {{ r.selfPoints }} / 100<span
                v-if="r.reviewPoints !== null"
              >
                · Xét duyệt {{ r.reviewPoints }} / 100</span
              >
            </p>
            <NuxtLink class="button button--secondary" :to="'/training-reviews/' + r.id"
              >Xem {{ r.student.studentCode }}</NuxtLink
            >
          </li>
        </ul>
        <button
          v-if="queue.nextCursor"
          class="button button--secondary"
          :disabled="busy"
          @click="load(false, queue.nextCursor ?? undefined)"
        >
          Tải thêm bản kê khai
        </button>
      </section></template
    >
  </section>
</template>
