<script setup lang="ts">
definePageMeta({ layout: 'auth', middleware: 'admin-guest' })

const route = useRoute()
const { login } = useAdminAuth()
const form = reactive({ username: '', password: '' })
const isSubmitting = ref(false)
const errorMessage = ref('')

function getStatusCode(error: unknown) {
  if (typeof error !== 'object' || error === null) return undefined
  const response = (error as Record<string, unknown>).response
  if (typeof response !== 'object' || response === null) return undefined
  const status = (response as Record<string, unknown>).status
  return typeof status === 'number' ? status : undefined
}

async function handleSubmit() {
  if (isSubmitting.value) return
  errorMessage.value = ''
  isSubmitting.value = true

  try {
    const authenticatedUser = await login({
      username: form.username.trim(),
      password: form.password,
    })
    await navigateTo(authenticatedUser.mustChangePassword ? '/admin/change-password' : '/admin')
  } catch (error) {
    errorMessage.value =
      getStatusCode(error) === 429
        ? 'Bạn đã thử đăng nhập quá nhiều lần. Vui lòng chờ một phút rồi thử lại.'
        : 'Tên đăng nhập hoặc mật khẩu không đúng.'
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <div class="admin-login">
    <section class="admin-login__intro">
      <img
        class="admin-login__shield"
        src="/images/naem-logo.jpg"
        alt="Logo Học viện Quản lý Giáo dục"
        width="62"
        height="62"
      />
      <p class="admin-login__eyebrow">Khu vực dành cho cán bộ</p>
      <h1>Cổng Quản trị<br /><span>Học viện Quản lý Giáo dục</span></h1>
      <p>Quản lý người dùng, dịch vụ và quy trình xử lý hồ sơ sinh viên.</p>
      <ul>
        <li>Quản lý người dùng và vai trò</li>
        <li>Quản lý danh mục dịch vụ</li>
        <li>Cấu hình và vận hành hệ thống</li>
      </ul>
    </section>

    <section class="admin-login__card surface-card" aria-labelledby="admin-login-title">
      <header>
        <h2 id="admin-login-title">Đăng nhập quản trị</h2>
        <p>Chỉ dành cho tài khoản quản trị được cấp quyền.</p>
      </header>
      <form novalidate @submit.prevent="handleSubmit">
        <BaseAlert v-if="route.query.passwordChanged === '1'" variant="success">
          Đổi mật khẩu thành công. Hãy đăng nhập lại bằng mật khẩu mới.
        </BaseAlert>
        <BaseAlert v-if="errorMessage" variant="error">{{ errorMessage }}</BaseAlert>
        <BaseInput
          id="admin-username"
          v-model="form.username"
          label="Tên đăng nhập"
          autocomplete="username"
          maxlength="100"
          required
          :disabled="isSubmitting"
          @update:model-value="errorMessage = ''"
        />
        <BaseInput
          id="admin-password"
          v-model="form.password"
          label="Mật khẩu"
          type="password"
          autocomplete="current-password"
          maxlength="128"
          required
          :disabled="isSubmitting"
          @update:model-value="errorMessage = ''"
        />
        <BaseButton
          type="submit"
          block
          :loading="isSubmitting"
          :disabled="!form.username.trim() || !form.password"
        >
          {{ isSubmitting ? 'Đang đăng nhập...' : 'Đăng nhập' }}
        </BaseButton>
        <p>Không phải quản trị viên? <NuxtLink to="/login">Cổng người dùng</NuxtLink></p>
      </form>
    </section>
  </div>
</template>

<style scoped>
.admin-login {
  position: relative;
  display: grid;
  overflow: hidden;
  grid-template-columns: minmax(0, 1fr) minmax(340px, 440px);
  gap: 64px;
  align-items: center;
  min-height: calc(100vh - 126px);
  padding: 44px max(24px, calc((100vw - 1040px) / 2));
  color: #fff;
  background:
    radial-gradient(circle at 15% 18%, rgb(35 82 132 / 32%), transparent 31%),
    radial-gradient(circle at 70% 100%, rgb(200 154 66 / 14%), transparent 32%), var(--color-admin);
}
.admin-login::after {
  position: absolute;
  right: -120px;
  bottom: -150px;
  width: 430px;
  height: 430px;
  border: 70px solid rgb(255 255 255 / 3%);
  border-radius: 50%;
  content: '';
}
.admin-login > * {
  position: relative;
  z-index: 1;
}
.admin-login__intro {
  max-width: 520px;
}
.admin-login__shield {
  width: 62px;
  height: 62px;
  margin-bottom: 22px;
  border: 2px solid rgb(226 189 112 / 68%);
  border-radius: 50%;
  object-fit: cover;
  box-shadow: 0 12px 30px rgb(0 0 0 / 24%);
}
.admin-login__eyebrow {
  color: #e2bd70;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.admin-login__intro h1 {
  margin-bottom: 15px;
  font-size: clamp(34px, 5vw, 48px);
  line-height: 1.12;
}
.admin-login__intro h1 span {
  color: rgb(255 255 255 / 54%);
}
.admin-login__intro > p:not(.admin-login__eyebrow) {
  color: rgb(255 255 255 / 62%);
  line-height: 1.65;
}
.admin-login__intro ul {
  display: grid;
  gap: 11px;
  margin: 28px 0 0;
  padding-left: 20px;
  color: rgb(255 255 255 / 72%);
  font-size: 14px;
}
.admin-login__card {
  overflow: hidden;
  border-color: rgb(255 255 255 / 18%);
  color: var(--color-text);
  box-shadow: 0 28px 70px rgb(0 0 0 / 28%);
}
.admin-login__card header {
  padding: 26px 28px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface-subtle);
}
.admin-login__card h2 {
  margin-bottom: 6px;
  font-size: 22px;
}
.admin-login__card header p {
  margin: 0;
  color: var(--color-muted);
  font-size: 14px;
}
.admin-login__card form {
  display: grid;
  gap: 19px;
  padding: 26px 28px;
}
.admin-login__card form > p {
  margin: 0;
  color: var(--color-muted);
  text-align: center;
  font-size: 13px;
}
.admin-login__card form a {
  color: var(--color-primary);
  font-weight: 700;
}
@media (max-width: 820px) {
  .admin-login {
    grid-template-columns: 1fr;
    gap: 32px;
  }
  .admin-login__intro ul {
    display: none;
  }
}
</style>
