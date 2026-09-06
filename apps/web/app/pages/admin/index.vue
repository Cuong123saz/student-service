<script setup lang="ts">
import type { Service } from '~/types/service'

definePageMeta({ layout: 'admin', middleware: 'admin-auth' })

const config = useRuntimeConfig()
const { user } = useAdminAuth()
const { data: services, status, error, refresh } = await useFetch<Service[]>(
  `${config.public.apiBase}/services`,
  { default: () => [] },
)
</script>

<template>
  <section class="admin-dashboard">
    <header class="admin-dashboard__header">
      <div>
        <p class="page-eyebrow">Cổng quản trị</p>
        <h1 class="page-title">Tổng quan</h1>
        <p class="page-description">Xin chào, <strong>{{ user?.username }}</strong>.</p>
      </div>
      <div v-if="user" class="admin-dashboard__roles">
        <RoleBadge v-for="role in user.roles" :key="role" :role="role" />
      </div>
    </header>

    <div class="admin-dashboard__stats">
      <article>
        <span>Tổng dịch vụ</span>
        <strong>{{ status === 'success' ? services.length : '—' }}</strong>
        <small>Dữ liệu trực tiếp từ API</small>
      </article>
      <article class="planned"><span>Người dùng hoạt động</span><strong>—</strong><small>Sắp triển khai</small></article>
      <article class="planned"><span>Lời mời chưa xác nhận</span><strong>—</strong><small>Sắp triển khai</small></article>
      <article class="planned"><span>Hồ sơ đang xử lý</span><strong>—</strong><small>Sắp triển khai</small></article>
    </div>

    <section class="admin-dashboard__actions">
      <h2>Thao tác nhanh</h2>
      <div>
        <NuxtLink to="/admin/users/invite">
          <strong>Gửi lời mời người dùng</strong>
          <span>Mời sinh viên, giảng viên hoặc cán bộ vào hệ thống.</span>
          <b aria-hidden="true">→</b>
        </NuxtLink>
        <NuxtLink to="/admin/students">
          <strong>Danh sách sinh viên</strong>
          <span>Tra cứu tài khoản theo khoa, lớp và phạm vi được phân quyền.</span>
          <b aria-hidden="true">→</b>
        </NuxtLink>
      </div>
    </section>

    <section class="admin-dashboard__services">
      <div class="admin-dashboard__section-title">
        <h2>Danh mục dịch vụ hiện tại</h2>
        <NuxtLink to="/services" target="_blank" rel="noopener noreferrer">Mở cổng công khai</NuxtLink>
      </div>
      <div v-if="status === 'pending'" class="admin-dashboard__state" role="status">Đang tải dữ liệu dịch vụ...</div>
      <div v-else-if="error" class="admin-dashboard__state error" role="alert">
        Không thể tải dữ liệu. <button type="button" @click="refresh()">Thử lại</button>
      </div>
      <div v-else class="admin-dashboard__table-wrap">
        <table>
          <thead><tr><th>Mã</th><th>Tên dịch vụ</th><th>Thời gian xử lý</th><th>Trạng thái</th></tr></thead>
          <tbody>
            <tr v-for="service in services" :key="service.id">
              <td>{{ service.code }}</td>
              <td>{{ service.name }}</td>
              <td>{{ service.processingDays }} ngày</td>
              <td><span :class="{ inactive: service.status === 'INACTIVE' }">{{ service.status === 'ACTIVE' ? 'Hoạt động' : 'Tạm ngừng' }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </section>
</template>

<style scoped>
.admin-dashboard__header { position: relative; display: flex; overflow: hidden; min-height: 168px; align-items: center; justify-content: space-between; gap: 28px; margin-bottom: 22px; padding: 28px 30px; border-radius: 22px; color: #fff; background: linear-gradient(125deg, #0e2341 0%, #173c66 70%, #1c4a78 100%); box-shadow: 0 18px 42px rgb(8 21 38 / 15%); }
.admin-dashboard__header::after { position: absolute; right: -48px; width: 220px; height: 220px; border: 42px solid rgb(226 189 112 / 10%); border-radius: 50%; content: ''; }
.admin-dashboard__header > * { position: relative; z-index: 1; }
.admin-dashboard__header :deep(.page-eyebrow) { color: #e2bd70; }
.admin-dashboard__header :deep(.page-description) { color: rgb(255 255 255 / 68%); }
.admin-dashboard__roles { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 7px; }
.admin-dashboard__stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-bottom: 30px; }
.admin-dashboard__stats article { position: relative; display: grid; overflow: hidden; gap: 7px; padding: 20px; border: 1px solid var(--color-border); border-radius: 17px; background: var(--color-surface); box-shadow: var(--shadow-sm); transition: transform 160ms ease, box-shadow 160ms ease; }
.admin-dashboard__stats article:first-child::before { position: absolute; top: 0; right: 0; left: 0; height: 3px; background: linear-gradient(90deg, var(--color-primary), var(--color-accent)); content: ''; }
.admin-dashboard__stats article:hover { transform: translateY(-2px); box-shadow: var(--shadow-md); }
.admin-dashboard__stats span { color: var(--color-muted); font-size: 13px; }
.admin-dashboard__stats strong { font-size: 26px; }
.admin-dashboard__stats small { color: var(--color-success); font-size: 12px; }
.admin-dashboard__stats article.planned { opacity: .62; }
.admin-dashboard__stats .planned small { color: var(--color-warning); }
.admin-dashboard h2 { margin-bottom: 13px; font-size: 17px; }
.admin-dashboard__actions { margin-bottom: 30px; }
.admin-dashboard__actions > div { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.admin-dashboard__actions a,
.admin-dashboard__actions article { position: relative; display: grid; gap: 6px; min-height: 126px; padding: 22px; border: 1px solid var(--color-border); border-radius: 17px; background: var(--color-surface); box-shadow: var(--shadow-sm); text-decoration: none; }
.admin-dashboard__actions a { background: linear-gradient(135deg, #fff 35%, #eff7ff); transition: transform 160ms ease, border-color 160ms ease, box-shadow 160ms ease; }
.admin-dashboard__actions a:hover { transform: translateY(-2px); border-color: #b9d6ff; box-shadow: var(--shadow-md); }
.admin-dashboard__actions span { color: var(--color-muted); font-size: 14px; line-height: 1.5; }
.admin-dashboard__actions b { position: absolute; right: 18px; bottom: 16px; color: var(--color-primary); }
.admin-dashboard__actions article { opacity: .6; }
.admin-dashboard__actions small { color: var(--color-warning); }
.admin-dashboard__section-title { display: flex; align-items: center; justify-content: space-between; gap: 20px; }
.admin-dashboard__section-title a { color: var(--color-primary); font-size: 13px; font-weight: 700; }
.admin-dashboard__table-wrap { overflow-x: auto; border: 1px solid var(--color-border); border-radius: 17px; background: var(--color-surface); box-shadow: var(--shadow-sm); }
.admin-dashboard table { width: 100%; border-collapse: collapse; font-size: 14px; }
.admin-dashboard th,
.admin-dashboard td { padding: 13px 16px; border-bottom: 1px solid var(--color-border); text-align: left; }
.admin-dashboard th { color: var(--color-muted); background: #f6f9fd; font-size: 11px; letter-spacing: .04em; text-transform: uppercase; }
.admin-dashboard tbody tr { transition: background-color 140ms ease; }
.admin-dashboard tbody tr:hover { background: #f8fbff; }
.admin-dashboard tbody tr:last-child td { border-bottom: 0; }
.admin-dashboard td:first-child { color: var(--color-muted); font-family: ui-monospace, monospace; font-size: 12px; font-weight: 700; }
.admin-dashboard td span { display: inline-flex; padding: 4px 7px; border-radius: 999px; color: var(--color-success); background: var(--color-success-background); font-size: 12px; font-weight: 700; }
.admin-dashboard td span.inactive { color: var(--color-warning); background: var(--color-warning-background); }
.admin-dashboard__state { padding: 28px; border: 1px solid var(--color-border); border-radius: 14px; color: var(--color-muted); background: var(--color-surface); text-align: center; }
.admin-dashboard__state.error { color: var(--color-error); }
.admin-dashboard__state button { border: 0; color: var(--color-primary); background: transparent; cursor: pointer; font-weight: 700; }
@media (max-width: 1000px) { .admin-dashboard__stats { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 640px) {
  .admin-dashboard__header { flex-direction: column; }
  .admin-dashboard__roles { justify-content: flex-start; }
  .admin-dashboard__actions > div { grid-template-columns: 1fr; }
  .admin-dashboard__stats { gap: 10px; }
  .admin-dashboard__stats article { padding: 15px; }
}
</style>
