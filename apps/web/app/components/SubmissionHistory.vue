<script setup lang="ts">
import type { PublicProcedure } from '~/types/procedure'
import type { SubmissionRound, SubmissionEvent } from '~/types/submission'
import {
  formatSubmissionAnswer,
  formatSubmissionTime,
  submissionEventLabels,
} from '~/utils/submission'
defineProps<{
  rounds: SubmissionRound[]
  events: SubmissionEvent[]
  procedure: PublicProcedure
  downloadUrl: (roundNumber: number, fileId: string) => string
}>()
</script>
<template>
  <section
    v-if="rounds.length || events.length"
    class="submission-history"
    aria-label="Lịch sử hồ sơ"
  >
    <h2>Lịch sử hồ sơ</h2>
    <h3 v-if="events.length">Diễn biến xử lý</h3>
    <ol v-if="events.length" class="history-events">
      <li v-for="event in events" :key="event.id">
        <strong>{{ submissionEventLabels[event.action] }} · Lần gửi {{ event.roundNumber }}</strong>
        <p>
          {{ event.actorName }} ·
          <time :datetime="event.createdAt">{{ formatSubmissionTime(event.createdAt) }}</time>
        </p>
        <p v-if="event.note" class="history-note">{{ event.note }}</p>
      </li>
    </ol>
    <h3 v-if="rounds.length">Các lần gửi đã chốt</h3>
    <p class="history-help">
      Mỗi lần gửi giữ nguyên thông tin và minh chứng tại thời điểm gửi. Chữ ký trên tệp chưa được
      xác minh.
    </p>
    <details v-for="round in rounds" :key="round.roundNumber" class="history-round">
      <summary>
        Lần gửi {{ round.roundNumber }} · {{ formatSubmissionTime(round.submittedAt) }}
      </summary>
      <p v-if="round.source === 'MIGRATION'" class="history-help">
        Bản gửi được ghi nhận từ hồ sơ có trước khi bổ sung tính năng lịch sử; không có diễn biến
        thao tác trước đó.
      </p>
      <dl class="history-answers">
        <div>
          <dt>Sinh viên</dt>
          <dd>{{ round.studentSnapshot.fullName }} · {{ round.studentSnapshot.studentCode }}</dd>
        </div>
        <div>
          <dt>Lớp · Khoa</dt>
          <dd>{{ round.studentSnapshot.classCode }} · {{ round.studentSnapshot.facultyCode }}</dd>
        </div>
        <div v-for="field in procedure.fields" :key="field.key">
          <dt>{{ field.label }}</dt>
          <dd>{{ formatSubmissionAnswer(field, round.values) }}</dd>
        </div>
      </dl>
      <h4>Minh chứng của lần gửi {{ round.roundNumber }}</h4>
      <p v-if="!round.files.length" class="history-help">Không có tệp minh chứng.</p>
      <ul v-else class="history-files">
        <li v-for="file in round.files" :key="file.id">
          <a :href="downloadUrl(round.roundNumber, file.id)">{{ file.name }}</a
          ><small>{{ (file.size / 1024).toFixed(1) }} KiB · Chữ ký chưa được xác minh</small>
        </li>
      </ul>
    </details>
  </section>
</template>
<style scoped>
.submission-history {
  padding: 26px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  min-width: 0;
  overflow-wrap: anywhere;
}
.submission-history h2 {
  font-size: 21px;
  margin-top: 0;
}
.submission-history h3 {
  font-size: 18px;
  margin-top: 26px;
}
.history-events {
  padding-left: 24px;
  display: grid;
  gap: 18px;
}
.history-events li {
  padding-left: 8px;
  line-height: 1.65;
}
.history-events p {
  margin: 6px 0;
}
.history-note,
.history-answers dd {
  white-space: pre-wrap;
}
.history-help,
.history-answers dt,
.history-files small {
  color: var(--color-muted);
  font-size: 14px;
  line-height: 1.65;
}
.history-round {
  border-top: 1px solid var(--color-border);
  padding: 12px 0;
}
.history-round summary {
  min-height: 44px;
  cursor: pointer;
  font-weight: 700;
  line-height: 1.65;
  padding: 10px 0;
}
.history-answers > div {
  padding: 12px 0;
  border-bottom: 1px solid var(--color-border);
}
.history-answers dd {
  margin: 6px 0 0;
  line-height: 1.65;
}
.history-files {
  list-style: none;
  padding: 0;
  display: grid;
  gap: 12px;
}
.history-files li {
  display: grid;
}
.history-files a {
  color: var(--color-primary);
  min-height: 44px;
  display: inline-flex;
  align-items: center;
}
@media (max-width: 640px) {
  .submission-history {
    padding: 20px;
  }
}
</style>
