<script setup lang="ts">
import type { Service } from '~/types/service'

const route = useRoute()
const config = useRuntimeConfig()
const { user, ensureCurrentUser } = useUserAuth()
const serviceId = String(route.params.id)

onMounted(() => { void ensureCurrentUser() })

const { data: service, status, error, refresh } = await useFetch<Service>(
  `${config.public.apiBase}/services/${serviceId}`,
)

const loginTarget = computed(() => ({
  path: '/login',
  query: { redirect: route.fullPath },
}))
</script>

<template>
  <section class="service-detail">
    <NuxtLink class="service-detail__back" to="/services">
      <span aria-hidden="true">←</span> Quay lại danh sách dịch vụ
    </NuxtLink>

    <div v-if="status === 'pending'" class="service-detail__state" role="status">
      <strong>Đang tải thông tin dịch vụ</strong>
      <p>Vui lòng chờ trong giây lát.</p>
    </div>

    <div v-else-if="error" class="service-detail__state service-detail__state--error" role="alert">
      <strong>Không thể tải dịch vụ</strong>
      <p>Dịch vụ không tồn tại hoặc kết nối tới máy chủ đang gián đoạn.</p>
      <BaseButton variant="secondary" @click="refresh()">Thử lại</BaseButton>
    </div>

    <article v-else-if="service" class="service-detail__card">
      <header class="service-detail__header">
        <div>
          <p class="service-detail__code">{{ service.code }}</p>
          <h1>{{ service.name }}</h1>
          <p class="service-detail__description">{{ service.description }}</p>
        </div>
        <span
          class="service-detail__status"
          :class="{ inactive: service.status === 'INACTIVE' }"
        >
          {{ service.status === 'ACTIVE' ? 'Đang hoạt động' : 'Tạm ngừng' }}
        </span>
      </header>

      <dl class="service-detail__information">
        <div><dt>Mã dịch vụ</dt><dd>{{ service.code }}</dd></div>
        <div><dt>Thời gian xử lý</dt><dd>{{ service.processingDays }} ngày làm việc</dd></div>
        <div><dt>Trạng thái</dt><dd>{{ service.status === 'ACTIVE' ? 'Đang tiếp nhận yêu cầu' : 'Tạm ngừng tiếp nhận' }}</dd></div>
      </dl>

      <div class="service-detail__action">
        <div>
          <strong>Sẵn sàng thực hiện thủ tục?</strong>
          <p v-if="service.status === 'INACTIVE'">Dịch vụ hiện đang tạm ngừng tiếp nhận.</p>
          <p v-else-if="user">Chức năng kê khai trực tuyến sẽ được triển khai ở sprint tiếp theo.</p>
          <p v-else>Bạn cần đăng nhập trước khi thực hiện thủ tục.</p>
        </div>
        <span v-if="service.status === 'INACTIVE' || user" class="service-detail__disabled" aria-disabled="true">
          {{ user ? 'Sắp triển khai' : 'Tạm ngừng' }}
        </span>
        <NuxtLink v-else class="service-detail__login" :to="loginTarget">Đăng nhập để tiếp tục</NuxtLink>
      </div>
    </article>
  </section>
</template>

<style scoped>
.service-detail { max-width: 880px; margin: 0 auto; }
.service-detail__back { display: inline-flex; align-items: center; gap: 8px; margin-bottom: 25px; color: var(--color-primary); font-size: 14px; font-weight: 700; text-decoration: none; }
.service-detail__card { overflow: hidden; border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface); box-shadow: var(--shadow-card); }
.service-detail__header { display: flex; align-items: flex-start; justify-content: space-between; gap: 28px; padding: 36px; border-bottom: 1px solid var(--color-border); }
.service-detail__code { margin-bottom: 12px; color: var(--color-primary); font-size: 13px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
.service-detail__header h1 { margin-bottom: 14px; font-size: clamp(28px, 5vw, 40px); line-height: 1.16; letter-spacing: -.03em; }
.service-detail__description { max-width: 620px; margin-bottom: 0; color: var(--color-muted); font-size: 16px; line-height: 1.7; }
.service-detail__status { flex: none; padding: 7px 11px; border-radius: 999px; color: var(--color-success); background: var(--color-success-background); font-size: 12px; font-weight: 800; }
.service-detail__status.inactive { color: var(--color-warning); background: var(--color-warning-background); }
.service-detail__information { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); margin: 0; padding: 28px 36px; background: var(--color-surface-subtle); }
.service-detail__information div { padding: 0 20px; border-right: 1px solid var(--color-border); }
.service-detail__information div:first-child { padding-left: 0; }
.service-detail__information div:last-child { padding-right: 0; border-right: 0; }
.service-detail__information dt { margin-bottom: 7px; color: var(--color-muted); font-size: 13px; }
.service-detail__information dd { margin: 0; font-weight: 700; line-height: 1.5; }
.service-detail__action { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 26px 36px; border-top: 1px solid var(--color-border); }
.service-detail__action strong { display: block; margin-bottom: 4px; }
.service-detail__action p { margin: 0; color: var(--color-muted); font-size: 14px; line-height: 1.5; }
.service-detail__login,
.service-detail__disabled { display: inline-flex; min-height: 44px; align-items: center; justify-content: center; flex: none; padding: 10px 16px; border-radius: 10px; font-weight: 700; text-decoration: none; }
.service-detail__login { color: #fff; background: var(--color-primary); }
.service-detail__disabled { color: var(--color-muted); background: #f2f4f7; }
.service-detail__state { display: grid; justify-items: center; gap: 8px; padding: 48px 30px; border: 1px dashed var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface); text-align: center; }
.service-detail__state p { margin-bottom: 8px; color: var(--color-muted); }
.service-detail__state--error { border-color: #fecaca; background: var(--color-error-background); }
@media (max-width: 720px) {
  .service-detail__header { flex-direction: column-reverse; padding: 26px 22px; }
  .service-detail__information { grid-template-columns: 1fr; padding: 6px 22px; }
  .service-detail__information div,
  .service-detail__information div:first-child,
  .service-detail__information div:last-child { padding: 18px 0; border-right: 0; border-bottom: 1px solid var(--color-border); }
  .service-detail__information div:last-child { border-bottom: 0; }
  .service-detail__action { align-items: stretch; flex-direction: column; padding: 24px 22px; }
}
</style>
