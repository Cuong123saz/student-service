<script setup lang="ts">
const { user, ensureCurrentUser } = useUserAuth()

// TODO(Sprint 3): thay dữ liệu minh họa bằng API yêu cầu kê khai của Nhà trường.
const declarations = [
  {
    title: 'Kê khai điểm rèn luyện',
    description: 'Tự đánh giá, bổ sung minh chứng và gửi cố vấn học tập xác nhận.',
    schedule: 'Theo đợt do Nhà trường mở',
    status: 'Bắt buộc',
  },
  {
    title: 'Bổ sung hồ sơ sinh viên',
    description: 'Kiểm tra và cập nhật thông tin khi nhận được yêu cầu từ đơn vị phụ trách.',
    schedule: 'Thông báo trong cổng cá nhân',
    status: 'Theo yêu cầu',
  },
]

// TODO(Sprint 3): thay dữ liệu minh họa bằng API hoạt động và đăng ký ngoại khóa.
const activities = [
  {
    category: 'Ngoại khóa',
    title: 'Chuỗi hoạt động kỹ năng sinh viên',
    description: 'Các hoạt động phát triển kỹ năng, công tác xã hội và phong trào sinh viên.',
    schedule: 'Lịch cụ thể do Học viện công bố',
  },
  {
    category: 'Nghiên cứu khoa học',
    title: 'Đăng ký đề xuất nghiên cứu sinh viên',
    description: 'Theo dõi đợt đăng ký đề tài và gửi đề xuất nghiên cứu khoa học.',
    schedule: 'Theo đợt mở đăng ký',
  },
]

const portalTarget = computed(() => (user.value ? '/portal' : '/login?redirect=/portal'))

onMounted(() => {
  void ensureCurrentUser()
})

useSeoMeta({
  title: 'Trang chủ | Cổng Dịch vụ Sinh viên NAEM',
  description:
    'Thông tin dịch vụ, yêu cầu kê khai và hoạt động dành cho sinh viên Học viện Quản lý Giáo dục.',
})
</script>

<template>
  <div class="home-page">
    <section class="home-overview" aria-labelledby="home-overview-title">
      <header class="home-overview__header">
        <div>
          <p>Học viện Quản lý Giáo dục</p>
          <h1 id="home-overview-title">Tổng quan dành cho sinh viên</h1>
          <span>Dịch vụ, yêu cầu từ Nhà trường và hoạt động sắp diễn ra.</span>
        </div>
        <NuxtLink class="home-overview__account" :to="portalTarget">
          <small>{{ user ? 'Tài khoản hiện tại' : 'Cổng cá nhân' }}</small>
          <strong>{{ user ? user.username : 'Đăng nhập sinh viên' }}</strong>
          <span aria-hidden="true">→</span>
        </NuxtLink>
      </header>

      <div class="home-overview__grid">
        <NuxtLink class="overview-card overview-card--service" to="/services">
          <span class="overview-card__icon" aria-hidden="true">01</span>
          <div>
            <p>Cổng dịch vụ sinh viên</p>
            <h2>Tra cứu và thực hiện thủ tục</h2>
            <span>Thông tin, hồ sơ và thời gian xử lý.</span>
          </div>
          <strong>Xem dịch vụ <span aria-hidden="true">→</span></strong>
        </NuxtLink>

        <a class="overview-card" href="#declarations">
          <span class="overview-card__icon" aria-hidden="true">02</span>
          <div>
            <p>Yêu cầu từ Nhà trường</p>
            <h2>{{ declarations.length }} nhóm cần theo dõi</h2>
            <span>Kê khai và nộp minh chứng đúng hạn.</span>
          </div>
          <strong>Xem yêu cầu <span aria-hidden="true">↓</span></strong>
        </a>

        <a class="overview-card" href="#activities">
          <span class="overview-card__icon" aria-hidden="true">03</span>
          <div>
            <p>Hoạt động sắp diễn ra</p>
            <h2>{{ activities.length }} nhóm đang giới thiệu</h2>
            <span>Ngoại khóa và nghiên cứu khoa học.</span>
          </div>
          <strong>Xem hoạt động <span aria-hidden="true">↓</span></strong>
        </a>
      </div>
    </section>

    <div class="home-content-grid">
      <section id="declarations" class="home-panel" aria-labelledby="declaration-title">
        <header class="home-panel__header">
          <div>
            <p class="page-eyebrow">Cần thực hiện</p>
            <h2 id="declaration-title">Yêu cầu kê khai từ Nhà trường</h2>
          </div>
          <span class="preview-label">Nội dung mẫu</span>
        </header>

        <div class="declaration-list">
          <article v-for="(item, index) in declarations" :key="item.title">
            <span class="declaration-list__index">0{{ index + 1 }}</span>
            <div>
              <span class="declaration-list__status">{{ item.status }}</span>
              <h3>{{ item.title }}</h3>
              <p>{{ item.description }}</p>
              <small>{{ item.schedule }}</small>
            </div>
            <NuxtLink :to="portalTarget" :aria-label="`${item.title}: vào cổng cá nhân`"
              >→</NuxtLink
            >
          </article>
        </div>

        <NuxtLink class="home-panel__link" :to="portalTarget">
          Xem tất cả yêu cầu <span aria-hidden="true">→</span>
        </NuxtLink>
      </section>

      <section id="activities" class="home-panel" aria-labelledby="activities-title">
        <header class="home-panel__header">
          <div>
            <p class="page-eyebrow">Sắp diễn ra</p>
            <h2 id="activities-title">Hoạt động dành cho sinh viên</h2>
          </div>
          <span class="preview-label">Nội dung mẫu</span>
        </header>

        <div class="activity-list">
          <article v-for="item in activities" :key="item.title">
            <span>{{ item.category }}</span>
            <h3>{{ item.title }}</h3>
            <p>{{ item.description }}</p>
            <small>{{ item.schedule }}</small>
            <NuxtLink :to="portalTarget">
              {{ user ? 'Xem và đăng ký' : 'Đăng nhập để đăng ký' }}
              <span aria-hidden="true">→</span>
            </NuxtLink>
          </article>
        </div>
      </section>
    </div>

    <section class="home-notice">
      <div>
        <p class="page-eyebrow">Thông báo</p>
        <h2>Đừng bỏ lỡ yêu cầu quan trọng</h2>
        <p>
          Khi đăng nhập, hệ thống sẽ hiển thị các công việc đúng với tài khoản và vai trò của bạn.
        </p>
      </div>
      <NuxtLink class="home-button home-button--navy" :to="portalTarget">
        {{ user ? 'Mở cổng cá nhân' : 'Đăng nhập ngay' }}
      </NuxtLink>
    </section>
  </div>
</template>

<style scoped>
.home-page {
  display: grid;
  gap: 48px;
}
.home-button {
  display: inline-flex;
  min-height: 48px;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 11px 18px;
  border: 1px solid transparent;
  border-radius: 12px;
  font-size: 14px;
  font-weight: 750;
  text-decoration: none;
  transition:
    transform 160ms ease,
    box-shadow 160ms ease,
    background-color 160ms ease;
}
.home-button:hover {
  transform: translateY(-2px);
}
.home-button--navy {
  color: #fff;
  background: linear-gradient(135deg, var(--color-primary), #205c94);
  box-shadow: 0 10px 22px rgb(23 76 130 / 20%);
}
.home-overview {
  position: relative;
  overflow: hidden;
  min-height: 500px;
  padding: 32px;
  border-radius: 25px;
  color: #fff;
  background:
    radial-gradient(circle at 92% 0%, rgb(200 154 66 / 25%), transparent 20rem),
    linear-gradient(135deg, #0e2341, #1a4774);
  box-shadow: 0 22px 54px rgb(14 35 65 / 18%);
}
.home-overview::after {
  position: absolute;
  top: -135px;
  right: -95px;
  width: 340px;
  height: 340px;
  border: 1px solid rgb(255 255 255 / 8%);
  border-radius: 50%;
  box-shadow: 0 0 0 52px rgb(255 255 255 / 2%);
  content: '';
}
.home-overview__header {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 32px;
  margin-bottom: 26px;
}
.home-overview__header > div {
  max-width: 650px;
}
.home-overview__header p {
  margin-bottom: 7px;
  color: #e2bd70;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.home-overview__header h1 {
  margin-bottom: 8px;
  font-family: Georgia, 'Times New Roman', serif;
  font-size: clamp(2rem, 4.5vw, 3.25rem);
  line-height: 1.08;
  letter-spacing: -0.035em;
}
.home-overview__header > div > span {
  color: rgb(255 255 255 / 62%);
  font-size: 14px;
}
.home-overview__account {
  position: relative;
  z-index: 1;
  display: grid;
  min-width: 215px;
  grid-template-columns: 1fr auto;
  gap: 2px 16px;
  padding: 13px 15px;
  border: 1px solid rgb(255 255 255 / 16%);
  border-radius: 13px;
  color: #fff;
  background: rgb(255 255 255 / 7%);
  text-decoration: none;
}
.home-overview__account small {
  grid-column: 1;
  color: rgb(255 255 255 / 50%);
  font-size: 11px;
}
.home-overview__account strong {
  grid-column: 1;
  font-size: 13px;
}
.home-overview__account > span {
  display: grid;
  grid-row: 1 / 3;
  grid-column: 2;
  place-items: center;
  color: #e2bd70;
}
.home-overview__grid {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}
.overview-card {
  display: grid;
  min-height: 260px;
  align-content: space-between;
  gap: 18px;
  padding: 22px;
  border: 1px solid rgb(255 255 255 / 12%);
  border-radius: 18px;
  color: #fff;
  background: rgb(255 255 255 / 7%);
  text-decoration: none;
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 6%);
  transition:
    transform 160ms ease,
    background-color 160ms ease,
    border-color 160ms ease;
}
.overview-card:hover {
  transform: translateY(-3px);
  border-color: rgb(226 189 112 / 42%);
  background: rgb(255 255 255 / 11%);
}
.overview-card--service {
  border-color: rgb(226 189 112 / 48%);
  background: linear-gradient(145deg, rgb(226 189 112 / 17%), rgb(255 255 255 / 8%));
}
.overview-card__icon {
  display: grid;
  width: 38px;
  height: 38px;
  place-items: center;
  border: 1px solid rgb(226 189 112 / 30%);
  border-radius: 11px;
  color: #e9c981;
  background: rgb(226 189 112 / 10%);
  font-size: 11px;
  font-weight: 850;
}
.overview-card p {
  margin-bottom: 13px;
  color: #e2bd70;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.07em;
  text-transform: uppercase;
}
.overview-card h2 {
  margin-bottom: 9px;
  font-size: 18px;
  line-height: 1.3;
  letter-spacing: -0.02em;
}
.overview-card div > span {
  color: rgb(255 255 255 / 55%);
  font-size: 13px;
  line-height: 1.5;
}
.overview-card > strong {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: #f0d79f;
  font-size: 13px;
}
.home-panel h2,
.home-notice h2 {
  margin: 0;
  color: var(--color-text);
  font-size: clamp(1.45rem, 2.6vw, 2rem);
  letter-spacing: -0.03em;
}
.home-content-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
}
.home-panel {
  padding: 27px;
  border: 1px solid var(--color-border);
  border-radius: 22px;
  background: rgb(255 255 255 / 94%);
  box-shadow: var(--shadow-card);
}
.home-panel__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 23px;
}
.home-panel__header .page-eyebrow {
  margin-bottom: 7px;
}
.preview-label {
  flex: none;
  padding: 5px 8px;
  border-radius: 7px;
  color: #8a5a0a;
  background: #fff5d9;
  font-size: 11px;
  font-weight: 750;
}
.declaration-list {
  display: grid;
}
.declaration-list article {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 14px;
  align-items: start;
  padding: 20px 0;
  border-top: 1px solid var(--color-border);
}
.declaration-list__index {
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  border-radius: 10px;
  color: var(--color-primary);
  background: var(--color-primary-soft);
  font-size: 11px;
  font-weight: 850;
}
.declaration-list__status {
  display: inline-flex;
  margin-bottom: 6px;
  color: #a05e08;
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
}
.declaration-list h3,
.activity-list h3 {
  margin-bottom: 7px;
  font-size: 16px;
  letter-spacing: -0.01em;
}
.declaration-list p,
.activity-list p {
  margin-bottom: 9px;
  color: var(--color-muted);
  font-size: 14px;
  line-height: 1.55;
}
.declaration-list small,
.activity-list small {
  color: var(--color-subtle);
  font-size: 12px;
}
.declaration-list article > a {
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  border-radius: 10px;
  color: var(--color-primary);
  background: #f4f7fb;
  text-decoration: none;
}
.declaration-list article > a:hover {
  background: var(--color-primary-soft);
}
.home-panel__link {
  display: inline-flex;
  gap: 8px;
  margin-top: 9px;
  color: var(--color-primary);
  font-size: 14px;
  font-weight: 750;
  text-decoration: none;
}
.activity-list {
  display: grid;
  gap: 12px;
}
.activity-list article {
  padding: 20px;
  border: 1px solid var(--color-border);
  border-radius: 16px;
  background: #f9fbfd;
}
.activity-list article > span:first-child {
  display: inline-flex;
  margin-bottom: 11px;
  padding: 5px 8px;
  border-radius: 7px;
  color: var(--color-primary);
  background: var(--color-primary-soft);
  font-size: 11px;
  font-weight: 800;
}
.activity-list article > a {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--color-border);
  color: var(--color-primary);
  font-size: 13px;
  font-weight: 750;
  text-decoration: none;
}
.home-notice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 32px;
  padding: 29px 32px;
  border: 1px solid #c9d8e7;
  border-radius: 20px;
  background: linear-gradient(135deg, #fff, #eef5fb);
}
.home-notice .page-eyebrow {
  margin-bottom: 7px;
}
.home-notice h2 {
  margin-bottom: 8px;
}
.home-notice p:last-child {
  margin: 0;
  color: var(--color-muted);
  font-size: 14px;
  line-height: 1.6;
}
.home-notice .home-button {
  flex: none;
}
@media (max-width: 940px) {
  .home-overview__grid {
    grid-template-columns: 1fr;
  }
  .overview-card {
    min-height: 190px;
  }
  .home-content-grid {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 680px) {
  .home-page {
    gap: 40px;
  }
  .home-overview {
    min-height: auto;
    padding: 25px 20px;
    border-radius: 21px;
  }
  .home-overview__header {
    align-items: flex-start;
    flex-direction: column;
  }
  .home-overview__account {
    width: 100%;
  }
  .overview-card {
    min-height: 180px;
    padding: 20px;
  }
  .home-panel {
    padding: 22px 19px;
  }
  .home-panel__header {
    align-items: flex-start;
    flex-direction: column;
  }
  .declaration-list article {
    grid-template-columns: auto 1fr;
  }
  .declaration-list article > a {
    grid-column: 2;
  }
  .home-notice {
    align-items: flex-start;
    flex-direction: column;
    padding: 25px;
  }
  .home-notice .home-button {
    width: 100%;
  }
}
</style>
