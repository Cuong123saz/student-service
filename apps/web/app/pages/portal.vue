<script setup lang="ts">
import {
  roleLabels,
  type SystemRoleCode,
} from '~/types/auth'

definePageMeta({ middleware: 'user-auth' })

const { user } = useUserAuth()

interface PortalItem {
  label: string
  description: string
  to?: string
  roles?: SystemRoleCode[]
}

const allItems: PortalItem[] = [
  {
    label: 'Hồ sơ của tôi',
    description: 'Xem mã sinh viên, lớp, khoa và cố vấn học tập.',
    to: '/profile',
    roles: ['STUDENT'],
  },
  {
    label: 'Dịch vụ sinh viên',
    description: 'Tra cứu và thực hiện các thủ tục hành chính.',
    to: '/services',
  },
  {
    label: 'Điểm rèn luyện',
    description: 'Kê khai và tra cứu kết quả theo học kỳ.',
    roles: ['STUDENT', 'ACADEMIC_ADVISOR', 'FACULTY_REVIEWER'],
  },
  {
    label: 'Hoạt động ngoại khóa',
    description: 'Đăng ký và theo dõi hoạt động đã tham gia.',
    roles: ['STUDENT'],
  },
  {
    label: 'Nghiên cứu khoa học',
    description: 'Theo dõi đề tài và đề xuất nghiên cứu.',
    roles: ['STUDENT'],
  },
  {
    label: 'Hồ sơ chờ duyệt',
    description: 'Xem các hồ sơ đang chờ bạn xử lý.',
    roles: ['ACADEMIC_ADVISOR', 'FACULTY_REVIEWER', 'DOCUMENT_SIGNER'],
  },
]

const items = computed(() => allItems.filter(item => (
  !item.roles || item.roles.some(role => user.value?.roles.includes(role))
)))
</script>

<template>
  <section v-if="user" class="portal">
    <header class="portal__header">
      <div>
        <p class="page-eyebrow">Cổng của tôi</p>
        <h1 class="page-title">Xin chào, {{ user.username }}</h1>
        <p class="page-description">
          Các chức năng hiển thị dựa trên vai trò được cấp cho tài khoản.
        </p>
      </div>
      <div class="portal__roles" aria-label="Vai trò hiện tại">
        <RoleBadge v-for="role in user.roles" :key="role" :role="role" />
      </div>
    </header>

    <div class="portal__grid">
      <template v-for="item in items" :key="item.label">
        <NuxtLink v-if="item.to" class="portal-card portal-card--active" :to="item.to">
          <span class="portal-card__icon" aria-hidden="true">→</span>
          <div><h2>{{ item.label }}</h2><p>{{ item.description }}</p></div>
          <strong>Truy cập</strong>
        </NuxtLink>
        <article v-else class="portal-card" aria-disabled="true">
          <span class="portal-card__status">Sắp triển khai</span>
          <div><h2>{{ item.label }}</h2><p>{{ item.description }}</p></div>
        </article>
      </template>
    </div>

    <p class="portal__identity">
      Quyền hiện tại: {{ user.roles.map(role => roleLabels[role]).join(', ') }}
    </p>
  </section>
</template>

<style scoped>
.portal { max-width: 920px; margin: 0 auto; }
.portal__header {
  position: relative;
  display: flex;
  min-height: 210px;
  align-items: flex-end;
  justify-content: space-between;
  gap: 30px;
  margin-bottom: 24px;
  overflow: hidden;
  padding: 34px 38px;
  border-radius: 24px;
  color: #fff;
  background:
    radial-gradient(circle at 88% 12%, rgb(200 154 66 / 25%), transparent 17rem),
    linear-gradient(135deg, #0e2341, #1c4a78);
  box-shadow: 0 20px 48px rgb(10 31 64 / 17%);
}
.portal__header::after {
  position: absolute;
  top: -110px;
  right: -70px;
  width: 280px;
  height: 280px;
  border: 1px solid rgb(255 255 255 / 9%);
  border-radius: 50%;
  box-shadow: 0 0 0 48px rgb(255 255 255 / 2.5%);
  content: "";
}
.portal__header > div { position: relative; z-index: 1; }
.portal__header .page-eyebrow { color: #e2bd70; }
.portal__header .page-title { color: #fff; }
.portal__header .page-description { color: rgb(255 255 255 / 62%); }
.portal__roles { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 7px; }
.portal__roles :deep(.role-badge) { border: 1px solid rgb(226 189 112 / 25%); color: #f5dfb3; background: rgb(255 255 255 / 8%); }
.portal__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.portal-card { position: relative; display: flex; min-height: 184px; flex-direction: column; justify-content: space-between; gap: 18px; padding: 23px; border: 1px solid rgb(220 228 239 / 85%); border-radius: 18px; color: var(--color-muted); background: rgb(255 255 255 / 94%); box-shadow: 0 8px 26px rgb(15 33 60 / 5%); text-decoration: none; }
.portal-card--active { color: var(--color-text); cursor: pointer; transition: border-color 160ms ease, box-shadow 160ms ease; }
.portal-card--active:hover { border-color: #a8c6ff; box-shadow: 0 16px 36px rgb(15 33 60 / 11%); transform: translateY(-3px); }
.portal-card__icon { display: grid; width: 42px; height: 42px; place-items: center; border-radius: 11px; color: var(--color-primary); background: var(--color-primary-soft); font-weight: 800; }
.portal-card__status { align-self: flex-start; padding: 4px 7px; border-radius: 6px; color: #92400e; background: #fef3c7; font-size: 11px; font-weight: 700; }
.portal-card h2 { margin-bottom: 7px; color: var(--color-text); font-size: 18px; letter-spacing: -.015em; }
.portal-card p { margin: 0; color: var(--color-muted); font-size: 14px; line-height: 1.55; }
.portal-card strong { color: var(--color-primary); font-size: 14px; }
.portal__identity { margin: 22px 0 0; color: var(--color-muted); font-size: 13px; }
@media (max-width: 680px) {
  .portal__header { min-height: 230px; align-items: flex-start; flex-direction: column; padding: 28px 24px; }
  .portal__roles { justify-content: flex-start; }
  .portal__grid { grid-template-columns: 1fr; }
}
</style>
