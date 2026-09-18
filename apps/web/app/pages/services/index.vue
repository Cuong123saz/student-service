<script setup lang="ts">
import type { Service } from '~/types/service'

type FilterStatus = 'ALL' | Service['status']

const config = useRuntimeConfig()
const filter = ref<FilterStatus>('ALL')
const {
  data: services,
  status,
  error,
  refresh,
} = await useFetch<Service[]>(`${config.public.apiBase}/services`, { default: () => [] })

const filteredServices = computed(() =>
  filter.value === 'ALL'
    ? services.value
    : services.value.filter((service) => service.status === filter.value),
)
const activeCount = computed(
  () => services.value.filter((service) => service.status === 'ACTIVE').length,
)
const averageProcessingDays = computed(() => {
  if (!services.value.length) return 0
  const total = services.value.reduce((sum, service) => sum + service.processingDays, 0)
  return Math.round(total / services.value.length)
})

const filters: { value: FilterStatus; label: string }[] = [
  { value: 'ALL', label: 'Tất cả' },
  { value: 'ACTIVE', label: 'Đang hoạt động' },
  { value: 'INACTIVE', label: 'Tạm ngừng' },
]
</script>

<template>
  <section class="catalog">
    <header class="catalog__intro">
      <div>
        <p class="page-eyebrow">Dịch vụ trực tuyến</p>
        <h1 class="page-title">Dịch vụ sinh viên</h1>
        <p class="page-description">
          Tra cứu thông tin và thời gian xử lý của các thủ tục sinh viên.
        </p>
      </div>
      <img
        class="catalog__intro-mark"
        src="/images/naem-logo.jpg"
        alt="Logo Học viện Quản lý Giáo dục"
        width="84"
        height="84"
      />
    </header>

    <div v-if="status === 'success' && services.length" class="catalog__summary">
      <div>
        <span>Tổng số dịch vụ</span><strong>{{ services.length }}</strong>
      </div>
      <div>
        <span>Đang hoạt động</span><strong class="success">{{ activeCount }}</strong>
      </div>
      <div>
        <span>Thời gian xử lý trung bình</span><strong>{{ averageProcessingDays }} ngày</strong>
      </div>
    </div>

    <div
      v-if="status === 'success' && services.length"
      class="catalog__filters"
      aria-label="Lọc dịch vụ"
    >
      <button
        v-for="item in filters"
        :key="item.value"
        type="button"
        :aria-pressed="filter === item.value"
        :class="{ active: filter === item.value }"
        @click="filter = item.value"
      >
        {{ item.label }}
      </button>
    </div>

    <div v-if="status === 'pending'" class="catalog__state" role="status">
      <span class="catalog__loader" aria-hidden="true" />
      <strong>Đang tải danh sách dịch vụ</strong>
      <p>Vui lòng chờ trong giây lát.</p>
    </div>

    <div v-else-if="error" class="catalog__state catalog__state--error" role="alert">
      <strong>Không thể tải danh sách dịch vụ</strong>
      <p>Vui lòng kiểm tra kết nối tới API và thử lại.</p>
      <BaseButton variant="secondary" @click="refresh()">Thử lại</BaseButton>
    </div>

    <template v-else-if="filteredServices.length">
      <div class="catalog__grid">
        <ServiceCard v-for="service in filteredServices" :key="service.id" :service="service" />
      </div>
      <p class="catalog__count">
        Hiển thị {{ filteredServices.length }}/{{ services.length }} dịch vụ
      </p>
    </template>

    <div v-else class="catalog__state">
      <strong>Không có dịch vụ phù hợp</strong>
      <p>Hãy chọn một bộ lọc khác.</p>
    </div>
  </section>
</template>

<style scoped>
.catalog__intro {
  position: relative;
  display: flex;
  max-width: none;
  min-height: 230px;
  align-items: flex-end;
  justify-content: space-between;
  gap: 32px;
  margin-bottom: 22px;
  overflow: hidden;
  padding: 38px 42px;
  border-radius: 24px;
  color: #fff;
  background:
    radial-gradient(circle at 86% 15%, rgb(200 154 66 / 24%), transparent 18rem),
    linear-gradient(135deg, #0e2341, #1c4a78);
  box-shadow: 0 22px 54px rgb(10 31 64 / 18%);
}
.catalog__intro::after {
  position: absolute;
  top: -80px;
  right: -45px;
  width: 250px;
  height: 250px;
  border: 1px solid rgb(255 255 255 / 10%);
  border-radius: 50%;
  box-shadow: 0 0 0 45px rgb(255 255 255 / 3%);
  content: '';
}
.catalog__intro > div {
  position: relative;
  z-index: 1;
  max-width: 650px;
}
.catalog__intro .page-eyebrow {
  color: #e2bd70;
}
.catalog__intro .page-title {
  color: #fff;
  font-size: clamp(2.25rem, 5vw, 3.5rem);
}
.catalog__intro .page-description {
  color: rgb(255 255 255 / 64%);
}
.catalog__intro-mark {
  position: relative;
  z-index: 1;
  width: 84px;
  height: 84px;
  flex: none;
  border: 2px solid rgb(226 189 112 / 70%);
  border-radius: 50%;
  object-fit: cover;
  box-shadow: 0 15px 35px rgb(0 0 0 / 24%);
}
.catalog__summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  margin-bottom: 20px;
}
.catalog__summary > div {
  display: grid;
  gap: 5px;
  padding: 17px 18px;
  border: 1px solid rgb(220 228 239 / 82%);
  border-radius: 15px;
  background: rgb(255 255 255 / 92%);
  box-shadow: 0 8px 24px rgb(15 33 60 / 5%);
}
.catalog__summary span {
  color: var(--color-muted);
  font-size: 13px;
}
.catalog__summary strong {
  font-size: 20px;
}
.catalog__summary strong.success {
  color: var(--color-success);
}
.catalog__filters {
  display: flex;
  flex-wrap: wrap;
  gap: 9px;
  margin-bottom: 22px;
}
.catalog__filters button {
  min-height: 42px;
  padding: 8px 15px;
  border: 1px solid var(--color-border);
  border-radius: 11px;
  color: var(--color-muted);
  background: rgb(255 255 255 / 90%);
  cursor: pointer;
  font-size: 14px;
  font-weight: 650;
}
.catalog__filters button:hover {
  border-color: #a8c6ff;
  color: var(--color-primary);
}
.catalog__filters button.active {
  border-color: var(--color-primary);
  color: #fff;
  background: var(--color-primary);
  box-shadow: 0 8px 18px rgb(21 94 239 / 18%);
}
.catalog__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px;
}
.catalog__count {
  margin: 20px 0 0;
  color: var(--color-muted);
  text-align: center;
  font-size: 13px;
}
.catalog__state {
  display: grid;
  justify-items: center;
  gap: 8px;
  padding: 48px 28px;
  border: 1px dashed var(--color-border);
  border-radius: 16px;
  background: var(--color-surface);
  text-align: center;
}
.catalog__state strong {
  font-size: 18px;
}
.catalog__state p {
  margin-bottom: 8px;
  color: var(--color-muted);
}
.catalog__state--error {
  border-color: #fecaca;
  background: var(--color-error-background);
}
.catalog__state--error strong {
  color: var(--color-error);
}
.catalog__loader {
  width: 28px;
  height: 28px;
  border: 3px solid #dbeafe;
  border-top-color: var(--color-primary);
  border-radius: 999px;
  animation: spin 750ms linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@media (max-width: 900px) {
  .catalog__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 640px) {
  .catalog__intro {
    min-height: 210px;
    padding: 30px 24px;
  }
  .catalog__intro-mark {
    display: none;
  }
  .catalog__summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .catalog__summary > div:last-child {
    grid-column: 1 / -1;
  }
  .catalog__grid {
    grid-template-columns: 1fr;
  }
}
</style>
