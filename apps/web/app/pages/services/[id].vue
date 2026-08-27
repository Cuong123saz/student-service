<script setup lang="ts">
import type { Service } from '~/types/service'

const route = useRoute()
const config = useRuntimeConfig()
const serviceId = route.params.id

const {
  data: service,
  status,
  error,
} = await useFetch<Service>(
  `${config.public.apiBase}/services/${serviceId}`,
)
</script>
<template>
  <main class="service-detail">
    <NuxtLink
      class="service-detail__back"
      to="/"
    >
      <span aria-hidden="true">←</span>
      Quay lại danh sách dịch vụ
    </NuxtLink>

    <div
      v-if="status === 'pending'"
      class="service-detail__state"
      aria-live="polite"
    >
      <strong>Đang tải thông tin dịch vụ</strong>
      <p>Vui lòng chờ trong giây lát.</p>
    </div>

    <div
      v-else-if="error"
      class="service-detail__state service-detail__state--error"
      role="alert"
    >
      <strong>Không tìm thấy dịch vụ</strong>
      <p>
        Dịch vụ có thể không tồn tại hoặc đã ngừng cung cấp.
      </p>
    </div>

    <article
      v-else-if="service"
      class="service-detail__card"
    >
      <header class="service-detail__header">
        <div>
          <p class="service-detail__code">
            {{ service.code }}
          </p>

          <h1>{{ service.name }}</h1>

          <p class="service-detail__description">
            {{ service.description }}
          </p>
        </div>

        <span
          class="service-detail__status"
          :class="{
            'service-detail__status--inactive':
              service.status === 'INACTIVE',
          }"
        >
          {{
            service.status === 'ACTIVE'
              ? 'Đang hoạt động'
              : 'Tạm ngừng'
          }}
        </span>
      </header>

      <dl class="service-detail__information">
        <div>
          <dt>Mã dịch vụ</dt>
          <dd>{{ service.code }}</dd>
        </div>

        <div>
          <dt>Thời gian xử lý</dt>
          <dd>{{ service.processingDays }} ngày làm việc</dd>
        </div>

        <div>
          <dt>Trạng thái</dt>
          <dd>
            {{
              service.status === 'ACTIVE'
                ? 'Đang tiếp nhận yêu cầu'
                : 'Tạm ngừng tiếp nhận'
            }}
          </dd>
        </div>
      </dl>
    </article>
  </main>
</template>
<style scoped>
.service-detail {
  max-width: 880px;
  margin: 0 auto;
}

.service-detail__back {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 28px;
  color: var(--color-primary);
  font-size: 14px;
  font-weight: 700;
  text-decoration: none;
}

.service-detail__back:hover {
  color: var(--color-primary-dark);
  text-decoration: underline;
}

.service-detail__card {
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: 20px;
  background: var(--color-surface);
  box-shadow: 0 12px 36px rgb(15 23 42 / 8%);
}

.service-detail__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 32px;
  padding: 40px;
  border-bottom: 1px solid var(--color-border);
}

.service-detail__code {
  margin-bottom: 14px;
  color: var(--color-primary);
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.08em;
  overflow-wrap: anywhere;
  text-transform: uppercase;
}

.service-detail__header h1 {
  margin-bottom: 16px;
  color: var(--color-text);
  font-size: clamp(30px, 5vw, 44px);
  line-height: 1.16;
  letter-spacing: -0.035em;
}

.service-detail__description {
  max-width: 640px;
  margin-bottom: 0;
  color: var(--color-muted);
  font-size: 17px;
  line-height: 1.7;
}

.service-detail__status {
  flex: none;
  padding: 7px 11px;
  border-radius: 999px;
  background: var(--color-success-background);
  color: var(--color-success);
  font-size: 12px;
  font-weight: 800;
}

.service-detail__status--inactive {
  background: var(--color-warning-background);
  color: var(--color-warning);
}

.service-detail__information {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin: 0;
  padding: 32px 40px;
}

.service-detail__information div {
  padding: 0 24px;
  border-right: 1px solid var(--color-border);
}

.service-detail__information div:first-child {
  padding-left: 0;
}

.service-detail__information div:last-child {
  padding-right: 0;
  border-right: 0;
}

.service-detail__information dt {
  margin-bottom: 8px;
  color: var(--color-muted);
  font-size: 13px;
}

.service-detail__information dd {
  margin: 0;
  color: var(--color-text);
  font-weight: 700;
  line-height: 1.5;
}

.service-detail__state {
  padding: 48px 32px;
  border: 1px dashed var(--color-border);
  border-radius: 20px;
  background: var(--color-surface);
  text-align: center;
}

.service-detail__state strong {
  display: block;
  margin-bottom: 8px;
  color: var(--color-text);
  font-size: 18px;
}

.service-detail__state p {
  margin-bottom: 0;
  color: var(--color-muted);
  line-height: 1.6;
}

.service-detail__state--error {
  border-color: var(--color-warning);
  background: var(--color-warning-background);
}

.service-detail__state--error strong {
  color: var(--color-warning);
}

@media (max-width: 720px) {
  .service-detail__header {
    align-items: flex-start;
    flex-direction: column-reverse;
    padding: 28px 24px;
  }

  .service-detail__information {
    grid-template-columns: 1fr;
    padding: 8px 24px;
  }

  .service-detail__information div,
  .service-detail__information div:first-child,
  .service-detail__information div:last-child {
    padding: 20px 0;
    border-right: 0;
    border-bottom: 1px solid var(--color-border);
  }

  .service-detail__information div:last-child {
    border-bottom: 0;
  }
}
</style>