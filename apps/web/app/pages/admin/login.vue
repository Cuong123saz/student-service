<script setup lang="ts">
const form = reactive({
  username: '',
  password: '',
})

const isSubmitting = ref(false)
const errorMessage = ref('')

const {
  login,
} = useAdminAuth()

async function handleSubmit() {
  if (isSubmitting.value) {
    return
  }

  errorMessage.value = ''
  isSubmitting.value = true

  try {
    const authenticatedUser =
      await login({
        username:
          form.username.trim(),
        password: form.password,
      })

  if (
  authenticatedUser
    .mustChangePassword
) {
  await navigateTo(
    '/admin/change-password',
  )
  return
}

    await navigateTo('/admin')
  } catch {
    errorMessage.value =
      'Không thể đăng nhập. Vui lòng kiểm tra thông tin tài khoản hoặc thử lại.'
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <main class="admin-login">
    <section class="admin-login__intro">
      <p class="admin-login__eyebrow">
        Khu vực dành cho cán bộ
      </p>

      <h1>Cổng quản trị</h1>

      <p>
        Quản lý dịch vụ, người dùng và quy trình
        xử lý hồ sơ sinh viên.
      </p>
    </section>

    <section
      class="admin-login__card"
      aria-labelledby="admin-login-title"
    >
      <header>
        <h2 id="admin-login-title">
          Đăng nhập
        </h2>

        <p>
          Sử dụng tài khoản quản trị được cấp.
        </p>
      </header>

      <form @submit.prevent="handleSubmit">
        <div class="form-field">
          <label for="username">
            Tên đăng nhập
          </label>

          <input
            id="username"
            v-model="form.username"
            name="username"
            type="text"
            autocomplete="username"
            maxlength="100"
            required
          >
        </div>

        <div class="form-field">
          <label for="password">
            Mật khẩu
          </label>

          <input
            id="password"
            v-model="form.password"
            name="password"
            type="password"
            autocomplete="current-password"
            maxlength="128"
            required
          >
        </div>

        <p
          v-if="errorMessage"
          class="form-error"
          role="alert"
        >
          {{ errorMessage }}
        </p>

        <button
          type="submit"
          :disabled="isSubmitting"
        >
          {{
            isSubmitting
              ? 'Đang đăng nhập...'
              : 'Đăng nhập'
          }}
        </button>
      </form>
    </section>
  </main>
</template>

<style scoped>
.admin-login {
  display: grid;
  grid-template-columns:
    minmax(0, 1fr)
    minmax(320px, 440px);
  gap: 72px;
  align-items: center;
  min-height: 520px;
}

.admin-login__intro {
  max-width: 560px;
}

.admin-login__eyebrow {
  color: var(--color-primary);
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.admin-login__intro h1 {
  margin-bottom: 16px;
  font-size: clamp(36px, 5vw, 52px);
  letter-spacing: -0.035em;
}

.admin-login__intro p:last-child {
  color: var(--color-muted);
  font-size: 18px;
  line-height: 1.7;
}

.admin-login__card {
  padding: 32px;
  border: 1px solid var(--color-border);
  border-radius: 20px;
  background: var(--color-surface);
  box-shadow:
    0 18px 45px
    rgb(23 32 51 / 8%);
}

.admin-login__card header {
  margin-bottom: 28px;
}

.admin-login__card h2 {
  margin-bottom: 8px;
  font-size: 26px;
}

.admin-login__card header p {
  margin-bottom: 0;
  color: var(--color-muted);
}

.form-field {
  display: grid;
  gap: 8px;
  margin-bottom: 20px;
}

.form-field label {
  font-size: 14px;
  font-weight: 700;
}

.form-field input {
  width: 100%;
  padding: 12px 14px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  color: var(--color-text);
  background: #ffffff;
}

.form-field input:focus {
  border-color: var(--color-primary);
  outline: 3px solid rgb(37 99 235 / 15%);
}

.form-error {
  padding: 12px 14px;
  border-radius: 10px;
  background: #fee2e2;
  color: #b91c1c;
  font-size: 14px;
}

button {
  width: 100%;
  padding: 13px 18px;
  border: 0;
  border-radius: 10px;
  background: var(--color-primary);
  color: #ffffff;
  cursor: pointer;
  font-weight: 700;
}

button:hover:not(:disabled) {
  background: var(--color-primary-dark);
}

button:disabled {
  cursor: wait;
  opacity: 0.65;
}

@media (max-width: 800px) {
  .admin-login {
    grid-template-columns: 1fr;
    gap: 36px;
  }
}
</style>