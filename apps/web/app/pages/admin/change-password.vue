<script setup lang="ts">
const form = reactive({
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
})

const isCheckingSession = ref(true)
const isSubmitting = ref(false)
const errorMessage = ref('')

const {
  loadCurrentUser,
  changePassword,
} = useAdminAuth()

onMounted(async () => {
  try {
    const currentUser =
      await loadCurrentUser()

    if (
      !currentUser
        .mustChangePassword
    ) {
      await navigateTo('/admin')
    }
  } catch {
    await navigateTo(
      '/admin/login',
    )
  } finally {
    isCheckingSession.value = false
  }
})

async function handleSubmit() {
  if (isSubmitting.value) {
    return
  }

  errorMessage.value = ''

  if (
    form.newPassword
    !== form.confirmPassword
  ) {
    errorMessage.value =
      'Mật khẩu xác nhận không khớp.'
    return
  }

  if (
    [...form.newPassword].length
    < 15
  ) {
    errorMessage.value =
      'Mật khẩu mới phải có ít nhất 15 ký tự.'
    return
  }

  isSubmitting.value = true

  try {
    await changePassword({
      currentPassword:
        form.currentPassword,
      newPassword:
        form.newPassword,
    })

    await navigateTo(
      '/admin/login?passwordChanged=1',
    )
  } catch {
    errorMessage.value =
      'Không thể đổi mật khẩu. Hãy kiểm tra mật khẩu hiện tại và thử lại.'
  } finally {
    isSubmitting.value = false
  }
}
</script>
<template>
  <main class="change-password">
    <p v-if="isCheckingSession">
      Đang kiểm tra phiên đăng nhập...
    </p>

    <section
      v-else
      class="change-password__card"
    >
      <header>
        <p class="change-password__eyebrow">
          Bảo mật tài khoản
        </p>

        <h1>Đổi mật khẩu</h1>

        <p>
          Bạn cần thay mật khẩu tạm trước khi
          sử dụng các chức năng quản trị.
        </p>
      </header>

      <form @submit.prevent="handleSubmit">
        <div class="form-field">
          <label for="current-password">
            Mật khẩu hiện tại
          </label>

          <input
            id="current-password"
            v-model="form.currentPassword"
            type="password"
            autocomplete="current-password"
            maxlength="128"
            required
          >
        </div>

        <div class="form-field">
          <label for="new-password">
            Mật khẩu mới
          </label>

          <input
            id="new-password"
            v-model="form.newPassword"
            type="password"
            autocomplete="new-password"
            maxlength="128"
            required
          >
        </div>

        <div class="form-field">
          <label for="confirm-password">
            Xác nhận mật khẩu mới
          </label>

          <input
            id="confirm-password"
            v-model="form.confirmPassword"
            type="password"
            autocomplete="new-password"
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
              ? 'Đang đổi mật khẩu...'
              : 'Đổi mật khẩu'
          }}
        </button>
      </form>
    </section>
  </main>
</template>