<script setup lang="ts">
import type { Service } from '~/types/service'

defineProps<{
  service: Service
}>()
</script>

<template>
  <article class="service-card">
    <header class="service-card__header">
      <span class="service-card__code">
        {{ service.code }}
      </span>

      <span
        class="service-card__status"
        :class="{
          'service-card__status--inactive':
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

    <div class="service-card__content">
      <h2>{{ service.name }}</h2>

      <p>{{ service.description }}</p>
    </div>

    <footer class="service-card__footer">
      <span>
        {{ service.processingDays }} ngày xử lý
      </span>

      <NuxtLink
        class="service-card__link"
        :to="`/services/${service.id}`"
      >
        Xem chi tiết
        <span aria-hidden="true">→</span>
      </NuxtLink>
    </footer>
  </article>
</template>
<style scoped>
.service-card {
  display: flex;
  flex-direction: column;
  min-height: 280px;
  padding: 24px;
  border: 1px solid var(--color-border);
  border-radius: 16px;
  background: var(--color-surface);
  box-shadow: 0 8px 24px rgb(15 23 42 / 6%);
  transition:
    border-color 160ms ease,
    box-shadow 160ms ease,
    transform 160ms ease;
}

.service-card:hover {
  border-color: #bfdbfe;
  box-shadow: 0 12px 32px rgb(15 23 42 / 10%);
  transform: translateY(-2px);
}

.service-card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.service-card__code {
  color: var(--color-muted);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  overflow-wrap: anywhere;
}

.service-card__status {
  flex: none;
  padding: 5px 9px;
  border-radius: 999px;
  background: var(--color-success-background);
  color: var(--color-success);
  font-size: 12px;
  font-weight: 700;
}

.service-card__status--inactive {
  background: var(--color-warning-background);
  color: var(--color-warning);
}

.service-card__content {
  margin-top: 28px;
}

.service-card__content h2 {
  margin-bottom: 10px;
  color: var(--color-text);
  font-size: 20px;
  line-height: 1.35;
}

.service-card__content p {
  margin-bottom: 0;
  color: var(--color-muted);
  line-height: 1.65;
}

.service-card__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: auto;
  padding-top: 24px;
  border-top: 1px solid var(--color-border);
  color: var(--color-muted);
  font-size: 14px;
}

.service-card__link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--color-primary);
  font-weight: 700;
  text-decoration: none;
}

.service-card__link:hover {
  color: var(--color-primary-dark);
  text-decoration: underline;
}

@media (max-width: 420px) {
  .service-card {
    min-height: auto;
    padding: 20px;
  }

  .service-card__footer {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>