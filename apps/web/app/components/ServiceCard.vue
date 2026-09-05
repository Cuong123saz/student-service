<script setup lang="ts">
import type { Service } from '~/types/service'

defineProps<{ service: Service }>()
</script>

<template>
  <NuxtLink class="service-card" :to="`/services/${service.id}`">
    <article>
      <header class="service-card__header">
        <span class="service-card__code">{{ service.code }}</span>
        <span
          class="service-card__status"
          :class="{ 'service-card__status--inactive': service.status === 'INACTIVE' }"
        >
          {{ service.status === 'ACTIVE' ? 'Đang hoạt động' : 'Tạm ngừng' }}
        </span>
      </header>
      <div class="service-card__content">
        <h2>{{ service.name }}</h2>
        <p>{{ service.description }}</p>
      </div>
      <footer class="service-card__footer">
        <span>{{ service.processingDays }} ngày xử lý</span>
        <strong>Xem chi tiết <span aria-hidden="true">→</span></strong>
      </footer>
    </article>
  </NuxtLink>
</template>

<style scoped>
.service-card { display: block; height: 100%; border-radius: 16px; color: inherit; text-decoration: none; }
.service-card article {
  position: relative;
  display: flex;
  min-height: 280px;
  height: 100%;
  flex-direction: column;
  padding: 24px;
  overflow: hidden;
  border: 1px solid rgb(220 228 239 / 85%);
  border-radius: 18px;
  background: rgb(255 255 255 / 94%);
  box-shadow: 0 10px 30px rgb(15 33 60 / 6%);
  transition: border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease;
}
.service-card article::before {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  height: 3px;
  background: linear-gradient(90deg, var(--color-primary), var(--color-accent));
  content: "";
  opacity: .75;
}
.service-card:hover article { border-color: #a8c6ff; box-shadow: 0 18px 42px rgb(15 33 60 / 12%); transform: translateY(-4px); }
.service-card__header,
.service-card__footer { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.service-card__code { color: var(--color-muted); font-size: 12px; font-weight: 800; letter-spacing: 0.06em; overflow-wrap: anywhere; }
.service-card__status { flex: none; padding: 5px 9px; border-radius: 999px; color: var(--color-success); background: var(--color-success-background); font-size: 12px; font-weight: 700; }
.service-card__status--inactive { color: var(--color-warning); background: var(--color-warning-background); }
.service-card__content { margin-top: 28px; }
.service-card__content h2 { margin-bottom: 10px; font-size: 20px; line-height: 1.35; letter-spacing: -.018em; }
.service-card__content p { margin-bottom: 0; color: var(--color-muted); line-height: 1.65; }
.service-card__footer { align-items: center; margin-top: auto; padding-top: 24px; border-top: 1px solid var(--color-border); color: var(--color-muted); font-size: 14px; }
.service-card__footer strong { display: inline-flex; align-items: center; gap: 7px; color: var(--color-primary); }
.service-card__footer strong span {
  display: grid;
  width: 26px;
  height: 26px;
  place-items: center;
  border-radius: 8px;
  background: var(--color-primary-soft);
  transition: transform 160ms ease;
}
.service-card:hover .service-card__footer strong span { transform: translateX(3px); }
@media (max-width: 420px) {
  .service-card article { min-height: auto; padding: 20px; }
  .service-card__footer { align-items: flex-start; flex-direction: column; }
}
</style>
