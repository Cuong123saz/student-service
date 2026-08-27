<script setup lang="ts">
import type { Service } from '~/types/service'
const config = useRuntimeConfig()
const {
  data: services,
  status,
  error,
} =await useFetch<Service[]>(
  `${config.public.apiBase}/services`,
)
</script>
<template>
  <main class="service-catalog">
    <header class="service-catalog__intro">
      <p class="service-catalog__eyebrow">
        Dịch vụ trực tuyến
      </p>

      <h1>Dịch vụ sinh viên</h1>

      <p class="service-catalog__description">
        Tra cứu thông tin, thời gian xử lý và thực hiện
        các thủ tục sinh viên tại một nơi.
      </p>
    </header>

    <div
      v-if="status === 'pending'"
      class="service-catalog__state"
      aria-live="polite"
    >
      <strong>Đang tải danh sách dịch vụ</strong>
      <p>Vui lòng chờ trong giây lát.</p>
    </div>

    <div
      v-else-if="error"
      class="service-catalog__state service-catalog__state--error"
      role="alert"
    >
      <strong>Không thể tải danh sách dịch vụ</strong>
      <p>
        Vui lòng kiểm tra kết nối tới API và thử tải lại trang.
      </p>
    </div>

    <section v-else-if="services?.length">
      <div class="service-catalog__meta">
        <p>
          Hiện có
          <strong>{{ services.length }}</strong>
          dịch vụ dành cho sinh viên
        </p>
      </div>

      <div class="service-catalog__grid">
        <ServiceCard
          v-for="service in services"
          :key="service.id"
          :service="service"
        />
      </div>
    </section>

    <div
      v-else
      class="service-catalog__state"
    >
      <strong>Chưa có dịch vụ nào</strong>
      <p>
        Danh sách dịch vụ sẽ được cập nhật tại đây.
      </p>
    </div>
  </main>
</template>\<style scoped>
.service-catalog__intro {
  max-width: 720px;
  margin-bottom: 40px;
}

.service-catalog__eyebrow {
  margin-bottom: 12px;
  color: var(--color-primary);
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.service-catalog__intro h1 {
  margin-bottom: 16px;
  color: var(--color-text);
  font-size: clamp(34px, 5vw, 48px);
  line-height: 1.12;
  letter-spacing: -0.035em;
}

.service-catalog__description {
  margin-bottom: 0;
  color: var(--color-muted);
  font-size: 18px;
  line-height: 1.7;
}

.service-catalog__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}

.service-catalog__meta p {
  margin-bottom: 0;
  color: var(--color-muted);
  font-size: 14px;
}

.service-catalog__meta strong {
  color: var(--color-text);
}

.service-catalog__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 24px;
}

.service-catalog__state {
  padding: 40px;
  border: 1px dashed var(--color-border);
  border-radius: 16px;
  background: var(--color-surface);
  text-align: center;
}

.service-catalog__state strong {
  display: block;
  margin-bottom: 8px;
  color: var(--color-text);
  font-size: 18px;
}

.service-catalog__state p {
  margin-bottom: 0;
  color: var(--color-muted);
  line-height: 1.6;
}

.service-catalog__state--error {
  border-color: var(--color-warning);
  background: var(--color-warning-background);
}

.service-catalog__state--error strong {
  color: var(--color-warning);
}

@media (max-width: 760px) {
  .service-catalog__grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .service-catalog__intro {
    margin-bottom: 32px;
  }

  .service-catalog__description {
    font-size: 16px;
  }

  .service-catalog__state {
    padding: 28px 20px;
  }
}
</style>