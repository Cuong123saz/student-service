<script setup lang="ts">
const route = useRoute()

const {
  activateAccount,
} = useAccountActivation()

const form = reactive({
  newPassword: '',
  confirmPassword: '',
})

const isSubmitting = ref(false)
const isActivated = ref(false)
const errorMessage = ref('')

const token = computed(() => {
  const value = route.query.token

  return typeof value === 'string'
    ? value
    : ''
})

const hasValidTokenShape =
  computed(() =>
    /^[A-Za-z0-9_-]{43}$/.test(
      token.value,
    ),
  )

async function submitActivation() {
  errorMessage.value = ''

  if (!hasValidTokenShape.value) {
    errorMessage.value =
      'Liên kết kích hoạt không hợp lệ.'
    return
  }

  if (
    form.newPassword
    !== form.confirmPassword
  ) {
    errorMessage.value =
      'Mật khẩu xác nhận không khớp.'
    return
  }

  const passwordLength =
    [...form.newPassword].length

  if (passwordLength < 15) {
    errorMessage.value =
      'Mật khẩu phải có ít nhất 15 ký tự.'
    return
  }

  if (passwordLength > 128) {
    errorMessage.value =
      'Mật khẩu không được vượt quá 128 ký tự.'
    return
  }

  isSubmitting.value = true

  try {
    await activateAccount({
      token: token.value,
      newPassword:
        form.newPassword,
    })

    form.newPassword = ''
    form.confirmPassword = ''
    isActivated.value = true
  } catch {
    errorMessage.value =
      'Liên kết không hợp lệ, đã hết hạn hoặc đã được sử dụng.'
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <main class="activation-page">
    <section class="activation-card">
      <p class="activation-card__eyebrow">
        CỔNG DỊCH VỤ SINH VIÊN
      </p>

      <h1>Kích hoạt tài khoản</h1>

      <div
        v-if="!hasValidTokenShape"
        class="activation-message activation-message--error"
      >
        Liên kết kích hoạt không hợp lệ hoặc bị thiếu token.
      </div>

      <div
        v-else-if="isActivated"
        class="activation-message activation-message--success"
      >
        <strong>Kích hoạt thành công.</strong>

        <p>
          Tài khoản của bạn đã sẵn sàng để đăng nhập.
        </p>

        <NuxtLink to="/">
          Quay về trang chủ
        </NuxtLink>
      </div>

      <form
        v-else
        class="activation-form"
        @submit.prevent="submitActivation"
      >
        <p class="activation-card__description">
          Tạo mật khẩu để hoàn tất việc kích hoạt tài khoản.
        </p>

        <div class="activation-field">
          <label for="new-password">
            Mật khẩu mới
          </label>

          <input
            id="new-password"
            v-model="form.newPassword"
            type="password"
            autocomplete="new-password"
            minlength="15"
            maxlength="128"
            required
          >
        </div>

        <div class="activation-field">
          <label for="confirm-password">
            Xác nhận mật khẩu
          </label>

          <input
            id="confirm-password"
            v-model="form.confirmPassword"
            type="password"
            autocomplete="new-password"
            minlength="15"
            maxlength="128"
            required
          >
        </div>

        <p
          v-if="errorMessage"
          class="activation-message activation-message--error"
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
              ? 'Đang kích hoạt...'
              : 'Kích hoạt tài khoản'
          }}
        </button>
      </form>
    </section>
  </main>
</template>

<style scoped>
.activation-page {
  display: grid;
  min-height: 100vh;
  padding: 32px 20px;
  place-items: center;
}

.activation-card {
  width: min(100%, 520px);
  padding: 36px;
  border: 1px solid var(--color-border);
  border-radius: 20px;
  background: var(--color-surface);
  box-shadow: 0 20px 50px rgb(23 32 51 / 10%);
}

.activation-card__eyebrow {
  color: var(--color-primary);
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.12em;
}

.activation-card__description {
  color: var(--color-muted);
}

.activation-form {
  display: grid;
  gap: 20px;
}

.activation-field {
  display: grid;
  gap: 8px;
}

.activation-field label {
  font-weight: 600;
}

.activation-field input {
  width: 100%;
  padding: 12px 14px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
}

.activation-field input:focus {
  border-color: var(--color-primary);
  outline: 3px solid rgb(37 99 235 / 15%);
}

.activation-form button {
  padding: 13px 18px;
  border: 0;
  border-radius: 10px;
  color: white;
  background: var(--color-primary);
  cursor: pointer;
  font-weight: 700;
}

.activation-form button:hover {
  background: var(--color-primary-dark);
}

.activation-form button:disabled {
  cursor: wait;
  opacity: 0.65;
}

.activation-message {
  padding: 14px;
  border-radius: 10px;
}

.activation-message--error {
  color: var(--color-warning);
  background: var(--color-warning-background);
}

.activation-message--success {
  color: var(--color-success);
  background: var(--color-success-background);
}
</style>