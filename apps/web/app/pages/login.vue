<script setup lang="ts">
definePageMeta({ layout: 'auth', middleware: 'user-guest' })

const route = useRoute()
const { login } = useUserAuth()
const form = reactive({ username: '', password: '' })
const isSubmitting = ref(false)
const errorMessage = ref('')

function safeRedirect(value: unknown) {
  return typeof value === 'string'
    && value.startsWith('/')
    && !value.startsWith('//')
    ? value
    : '/portal'
}

function getStatusCode(error: unknown) {
  if (typeof error !== 'object' || error === null) return undefined
  const record = error as Record<string, unknown>
  const response = record.response
  if (typeof response === 'object' && response !== null) {
    const status = (response as Record<string, unknown>).status
    if (typeof status === 'number') return status
  }
  return typeof record.statusCode === 'number' ? record.statusCode : undefined
}

async function handleSubmit() {
  if (isSubmitting.value) return
  errorMessage.value = ''
  isSubmitting.value = true

  try {
    await login({
      username: form.username.trim(),
      password: form.password,
    })
    await navigateTo(safeRedirect(route.query.redirect))
  } catch (error) {
    errorMessage.value = getStatusCode(error) === 429
      ? 'Bạn đã thử đăng nhập quá nhiều lần. Vui lòng chờ một phút rồi thử lại.'
      : 'Tên đăng nhập hoặc mật khẩu không đúng.'
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <section class="login-experience" aria-labelledby="login-experience-title">
      <div class="login-experience__glow" aria-hidden="true" />

      <div class="login-experience__content">
        <span class="login-experience__badge">
          <span aria-hidden="true" />
          Hệ thống dịch vụ trực tuyến
        </span>

        <h1 id="login-experience-title">
          Một tài khoản.<br>
          <span>Kết nối mọi dịch vụ học viện.</span>
        </h1>

        <p>
          Truy cập đúng chức năng theo vai trò được cấp và xử lý
          công việc trong một cổng thống nhất.
        </p>

        <ul>
          <li>
            <span aria-hidden="true">01</span>
            <div>
              <strong>Tra cứu tập trung</strong>
              <small>Thông tin dịch vụ được cập nhật trực tiếp từ hệ thống.</small>
            </div>
          </li>
          <li>
            <span aria-hidden="true">02</span>
            <div>
              <strong>Truy cập theo vai trò</strong>
              <small>Sinh viên, cố vấn và cán bộ sử dụng đúng không gian làm việc.</small>
            </div>
          </li>
          <li>
            <span aria-hidden="true">03</span>
            <div>
              <strong>Kích hoạt an toàn</strong>
              <small>Mật khẩu được thiết lập qua liên kết gửi đến email cá nhân.</small>
            </div>
          </li>
        </ul>
      </div>

      <footer>
        <span>Bảo vệ phiên đăng nhập bằng cookie HttpOnly</span>
        <span aria-hidden="true">•</span>
        <span>Thời hạn phiên: 2 giờ</span>
      </footer>
    </section>

    <section class="login-panel" aria-labelledby="login-title">
      <div class="login-panel__heading">
        <img
          class="login-panel__mark"
          src="/images/naem-logo.jpg"
          alt="Logo Học viện Quản lý Giáo dục"
          width="50"
          height="50"
        >
        <div>
          <p>CỔNG NGƯỜI DÙNG</p>
          <h2 id="login-title">Chào mừng trở lại</h2>
        </div>
      </div>

      <p class="login-panel__description">
        Đăng nhập bằng tài khoản đã được nhà trường cấp.
      </p>

      <form novalidate @submit.prevent="handleSubmit">
        <BaseAlert v-if="errorMessage" variant="error">
          {{ errorMessage }}
        </BaseAlert>

        <BaseInput
          id="user-username"
          v-model="form.username"
          label="Tên đăng nhập"
          autocomplete="username"
          placeholder="Nhập tên đăng nhập"
          maxlength="100"
          required
          :disabled="isSubmitting"
          @update:model-value="errorMessage = ''"
        />

        <BaseInput
          id="user-password"
          v-model="form.password"
          label="Mật khẩu"
          type="password"
          autocomplete="current-password"
          placeholder="Nhập mật khẩu"
          maxlength="128"
          required
          :disabled="isSubmitting"
          @update:model-value="errorMessage = ''"
        />

        <div class="login-panel__form-meta">
          <span>Phiên đăng nhập được bảo mật</span>
          <span class="login-panel__future" aria-disabled="true">
            Quên mật khẩu · Sắp có
          </span>
        </div>

        <BaseButton
          type="submit"
          block
          :loading="isSubmitting"
          :disabled="!form.username.trim() || !form.password"
        >
          {{ isSubmitting ? 'Đang xác thực...' : 'Đăng nhập vào hệ thống' }}
        </BaseButton>
      </form>

      <div class="login-panel__support">
        <p>Chưa có tài khoản hoặc cần hỗ trợ?</p>
        <span>Liên hệ đơn vị phụ trách tài khoản của bạn.</span>
      </div>

      <NuxtLink class="login-panel__admin" to="/admin/login">
        Chuyển sang Cổng quản trị
        <span aria-hidden="true">↗</span>
      </NuxtLink>
    </section>
  </div>
</template>

<style scoped>
.login-page {
  display: grid;
  grid-template-columns: minmax(0, 1.12fr) minmax(390px, .88fr);
  width: min(1180px, calc(100% - 56px));
  min-height: 680px;
  margin: 38px auto;
  overflow: hidden;
  border: 1px solid rgb(199 210 225 / 80%);
  border-radius: 28px;
  background: #fff;
  box-shadow: var(--shadow-floating);
}

.login-experience {
  position: relative;
  display: flex;
  min-width: 0;
  flex-direction: column;
  justify-content: space-between;
  overflow: hidden;
  padding: 58px 58px 34px;
  color: #fff;
  background:
    linear-gradient(145deg, rgb(14 35 65 / 97%), rgb(22 61 104 / 95%)),
    var(--color-admin);
}

.login-experience::before {
  position: absolute;
  top: -180px;
  right: -130px;
  width: 440px;
  height: 440px;
  border: 1px solid rgb(255 255 255 / 8%);
  border-radius: 50%;
  box-shadow:
    0 0 0 70px rgb(255 255 255 / 2.5%),
    0 0 0 140px rgb(255 255 255 / 1.5%);
  content: "";
}

.login-experience__glow {
  position: absolute;
  right: 6%;
  bottom: 13%;
  width: 240px;
  height: 240px;
  border-radius: 50%;
  background: rgb(200 154 66 / 17%);
  filter: blur(60px);
}

.login-experience__content,
.login-experience footer {
  position: relative;
  z-index: 1;
}

.login-experience__badge {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  margin-bottom: 48px;
  padding: 8px 12px;
  border: 1px solid rgb(255 255 255 / 12%);
  border-radius: 999px;
  color: rgb(255 255 255 / 78%);
  background: rgb(255 255 255 / 6%);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: .04em;
}

.login-experience__badge > span {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #34d399;
  box-shadow: 0 0 0 4px rgb(52 211 153 / 13%);
}

.login-experience h1 {
  max-width: 590px;
  margin-bottom: 19px;
  font-size: clamp(2.55rem, 4.2vw, 4.15rem);
  font-weight: 760;
  line-height: 1.04;
  letter-spacing: -.052em;
}

.login-experience h1 span {
  color: #e2bd70;
}

.login-experience__content > p {
  max-width: 535px;
  margin-bottom: 36px;
  color: rgb(255 255 255 / 63%);
  font-size: 16px;
  line-height: 1.7;
}

.login-experience ul {
  display: grid;
  max-width: 540px;
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.login-experience li {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 13px 15px;
  border: 1px solid rgb(255 255 255 / 9%);
  border-radius: 14px;
  background: rgb(255 255 255 / 4%);
}

.login-experience li > span {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  flex: none;
  border-radius: 10px;
  color: #f0ce89;
  background: rgb(200 154 66 / 14%);
  font-size: 11px;
  font-weight: 800;
}

.login-experience li div {
  display: grid;
  gap: 2px;
}

.login-experience li strong {
  font-size: 14px;
}

.login-experience li small {
  color: rgb(255 255 255 / 55%);
  font-size: 12px;
  line-height: 1.45;
}

.login-experience footer {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 42px;
  color: rgb(255 255 255 / 43%);
  font-size: 12px;
}

.login-panel {
  display: flex;
  min-width: 0;
  flex-direction: column;
  justify-content: center;
  padding: 54px 52px;
  background:
    radial-gradient(circle at 100% 0%, rgb(21 94 239 / 6%), transparent 18rem),
    #fff;
}

.login-panel__heading {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 13px;
}

.login-panel__mark {
  width: 48px;
  height: 48px;
  flex: none;
  border: 2px solid rgb(200 154 66 / 65%);
  border-radius: 50%;
  object-fit: cover;
  box-shadow: 0 10px 24px rgb(14 35 65 / 20%);
}

.login-panel__heading p {
  margin-bottom: 4px;
  color: var(--color-primary);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: .11em;
}

.login-panel h2 {
  margin: 0;
  font-size: 26px;
  letter-spacing: -.025em;
}

.login-panel__description {
  margin-bottom: 30px;
  color: var(--color-muted);
  font-size: 14px;
  line-height: 1.55;
}

.login-panel form {
  display: grid;
  gap: 20px;
}

.login-panel__form-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: var(--color-subtle);
  font-size: 12px;
}

.login-panel__form-meta > span:first-child {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.login-panel__form-meta > span:first-child::before {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-success);
  content: "";
}

.login-panel__future {
  cursor: not-allowed;
}

.login-panel__support {
  margin-top: 24px;
  padding: 16px;
  border: 1px solid var(--color-border);
  border-radius: 13px;
  background: var(--color-surface-subtle);
}

.login-panel__support p {
  margin-bottom: 3px;
  font-size: 13px;
  font-weight: 700;
}

.login-panel__support span {
  color: var(--color-muted);
  font-size: 12px;
}

.login-panel__admin {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 44px;
  margin-top: 17px;
  padding: 0 4px;
  color: var(--color-muted);
  font-size: 13px;
  font-weight: 700;
  text-decoration: none;
}

.login-panel__admin:hover {
  color: var(--color-primary);
}

@media (max-width: 960px) {
  .login-page {
    grid-template-columns: 1fr;
    width: min(720px, calc(100% - 40px));
  }

  .login-experience {
    min-height: auto;
    padding: 38px;
  }

  .login-experience__badge {
    margin-bottom: 24px;
  }

  .login-experience h1 {
    font-size: clamp(2.2rem, 7vw, 3.2rem);
  }

  .login-experience ul,
  .login-experience footer {
    display: none;
  }

  .login-experience__content > p {
    margin-bottom: 0;
  }
}

@media (max-width: 560px) {
  .login-page {
    width: min(100% - 24px, 720px);
    margin: 20px auto;
    border-radius: 20px;
  }

  .login-experience {
    padding: 28px 24px;
  }

  .login-experience__badge {
    margin-bottom: 18px;
  }

  .login-experience h1 {
    margin-bottom: 12px;
    font-size: 2rem;
  }

  .login-experience__content > p {
    font-size: 14px;
  }

  .login-panel {
    padding: 34px 24px;
  }

  .login-panel__form-meta {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
