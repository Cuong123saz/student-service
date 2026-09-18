<script setup lang="ts">
definePageMeta({ middleware: 'user-auth' })

const { profile, advisor, isLoading, errorMessage, load } = useStudentProfile()

onMounted(() => {
  void load()
})
</script>

<template>
  <section class="profile-page">
    <header class="profile-page__header">
      <p class="page-eyebrow">Hồ sơ sinh viên</p>
      <h1 class="page-title">Thông tin học vụ</h1>
      <p class="page-description">Thông tin được đồng bộ từ dữ liệu quản lý của Học viện.</p>
    </header>

    <div v-if="isLoading" class="profile-state" role="status">Đang tải hồ sơ của bạn…</div>

    <BaseAlert
      v-else-if="errorMessage && !profile"
      variant="warning"
      title="Chưa hoàn tất cấu hình hồ sơ"
    >
      {{ errorMessage }}
      <button class="profile-retry" type="button" @click="load">Thử lại</button>
    </BaseAlert>

    <template v-else-if="profile">
      <div class="profile-grid">
        <article class="surface-card profile-card">
          <div class="profile-card__heading">
            <span class="profile-card__icon" aria-hidden="true">SV</span>
            <div>
              <p class="profile-card__eyebrow">Định danh</p>
              <h2>{{ profile.fullName }}</h2>
            </div>
          </div>
          <dl class="profile-details">
            <div>
              <dt>Mã sinh viên</dt>
              <dd>{{ profile.studentCode }}</dd>
            </div>
            <div>
              <dt>Tên đăng nhập</dt>
              <dd>{{ profile.username }}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{{ profile.email || 'Chưa cập nhật' }}</dd>
            </div>
          </dl>
        </article>

        <article class="surface-card profile-card">
          <div class="profile-card__heading">
            <span class="profile-card__icon profile-card__icon--gold" aria-hidden="true">LỚP</span>
            <div>
              <p class="profile-card__eyebrow">Đơn vị học tập</p>
              <h2>{{ profile.class.name }}</h2>
            </div>
          </div>
          <dl class="profile-details">
            <div>
              <dt>Mã lớp</dt>
              <dd>{{ profile.class.code }}</dd>
            </div>
            <div>
              <dt>Khoa</dt>
              <dd>{{ profile.faculty.name }}</dd>
            </div>
            <div>
              <dt>Mã khoa</dt>
              <dd>{{ profile.faculty.code }}</dd>
            </div>
          </dl>
        </article>
      </div>

      <article class="surface-card advisor-card">
        <div>
          <p class="profile-card__eyebrow">Cố vấn học tập</p>
          <h2 v-if="advisor?.advisor">{{ advisor.advisor.fullName }}</h2>
          <h2 v-else>Chưa được phân công</h2>
          <p v-if="advisor?.advisor" class="advisor-card__meta">
            {{ advisor.advisor.email || advisor.advisor.username }}
          </p>
          <p v-else class="advisor-card__meta">
            Lớp của bạn hiện chưa có cố vấn active. Nhà trường sẽ cập nhật khi có phân công.
          </p>
        </div>
        <span
          class="advisor-card__status"
          :class="advisor?.assignmentStatus === 'ASSIGNED' ? 'advisor-card__status--active' : ''"
        >
          {{ advisor?.assignmentStatus === 'ASSIGNED' ? 'Đang phụ trách' : 'Chờ phân công' }}
        </span>
      </article>

      <BaseAlert v-if="errorMessage" variant="warning">
        {{ errorMessage }}
      </BaseAlert>
    </template>
  </section>
</template>

<style scoped>
.profile-page {
  max-width: 980px;
  margin: 0 auto;
}
.profile-page__header {
  margin-bottom: 26px;
}
.profile-state {
  padding: 40px;
  border: 1px dashed var(--color-border-strong);
  border-radius: var(--radius-lg);
  color: var(--color-muted);
  text-align: center;
  background: rgb(255 255 255 / 74%);
}
.profile-retry {
  display: block;
  margin: 12px auto 0;
  border: 0;
  color: var(--color-primary);
  background: transparent;
  font-weight: 700;
  cursor: pointer;
}
.profile-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}
.profile-card {
  padding: 24px;
}
.profile-card__heading {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 23px;
}
.profile-card__icon {
  display: grid;
  width: 46px;
  height: 46px;
  place-items: center;
  border-radius: 13px;
  color: #fff;
  background: var(--color-primary);
  font-size: 12px;
  font-weight: 800;
}
.profile-card__icon--gold {
  color: #48330d;
  background: #f4d994;
}
.profile-card__eyebrow {
  margin: 0 0 5px;
  color: var(--color-primary);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.profile-card h2,
.advisor-card h2 {
  margin: 0;
  font-size: 20px;
  letter-spacing: -0.02em;
}
.profile-details {
  display: grid;
  gap: 13px;
  margin: 0;
}
.profile-details div {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  padding-bottom: 11px;
  border-bottom: 1px solid var(--color-border);
}
.profile-details dt {
  color: var(--color-muted);
  font-size: 13px;
}
.profile-details dd {
  margin: 0;
  color: var(--color-text);
  font-size: 13px;
  font-weight: 700;
  text-align: right;
}
.advisor-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  margin-top: 18px;
  padding: 25px;
}
.advisor-card__meta {
  margin: 8px 0 0;
  color: var(--color-muted);
  font-size: 14px;
}
.advisor-card__status {
  flex: 0 0 auto;
  padding: 8px 12px;
  border-radius: 999px;
  color: var(--color-warning);
  background: var(--color-warning-background);
  font-size: 12px;
  font-weight: 800;
}
.advisor-card__status--active {
  color: var(--color-success);
  background: var(--color-success-background);
}
@media (max-width: 700px) {
  .profile-grid {
    grid-template-columns: 1fr;
  }
  .advisor-card {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
