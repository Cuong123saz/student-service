<script setup lang="ts">
definePageMeta({ layout: 'auth', middleware: 'admin-auth' })

const { changePassword } = useAdminAuth()
const form = reactive({ currentPassword: '', newPassword: '', confirmPassword: '' })
const errors = reactive({ currentPassword: '', newPassword: '', confirmPassword: '' })
const isSubmitting = ref(false)
const requestError = ref('')

function clearFieldError(field: keyof typeof errors) {
  errors[field] = ''
  requestError.value = ''
}

function validate() {
  errors.currentPassword = form.currentPassword ? '' : 'Vui lòng nhập mật khẩu hiện tại.'
  const length = [...form.newPassword].length
  errors.newPassword =
    length < 15 || length > 128 ? 'Mật khẩu mới phải có từ 15 đến 128 ký tự.' : ''
  errors.confirmPassword =
    form.newPassword !== form.confirmPassword ? 'Mật khẩu xác nhận không khớp.' : ''
  return !Object.values(errors).some(Boolean)
}

async function handleSubmit() {
  requestError.value = ''
  if (!validate() || isSubmitting.value) return
  isSubmitting.value = true

  try {
    await changePassword({
      currentPassword: form.currentPassword,
      newPassword: form.newPassword,
    })
    await navigateTo('/admin/login?passwordChanged=1')
  } catch {
    requestError.value = 'Không thể đổi mật khẩu. Hãy kiểm tra mật khẩu hiện tại và thử lại.'
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <div class="change-password-page">
    <section class="change-password-card surface-card" aria-labelledby="change-password-title">
      <header>
        <p class="page-eyebrow">Bảo mật tài khoản</p>
        <h1 id="change-password-title">Đổi mật khẩu bắt buộc</h1>
        <p>Bạn cần thay mật khẩu tạm trước khi sử dụng các chức năng quản trị.</p>
      </header>
      <form novalidate @submit.prevent="handleSubmit">
        <BaseAlert variant="info"
          >Mật khẩu mới phải có từ <strong>15 đến 128 ký tự</strong>.</BaseAlert
        >
        <BaseInput
          id="current-password"
          v-model="form.currentPassword"
          label="Mật khẩu hiện tại"
          type="password"
          autocomplete="current-password"
          maxlength="128"
          required
          :disabled="isSubmitting"
          :error="errors.currentPassword"
          @update:model-value="clearFieldError('currentPassword')"
        />
        <BaseInput
          id="new-password"
          v-model="form.newPassword"
          label="Mật khẩu mới"
          type="password"
          autocomplete="new-password"
          maxlength="128"
          required
          :disabled="isSubmitting"
          :error="errors.newPassword"
          @update:model-value="clearFieldError('newPassword')"
        />
        <BaseInput
          id="confirm-password"
          v-model="form.confirmPassword"
          label="Xác nhận mật khẩu mới"
          type="password"
          autocomplete="new-password"
          maxlength="128"
          required
          :disabled="isSubmitting"
          :error="errors.confirmPassword"
          @update:model-value="clearFieldError('confirmPassword')"
        />
        <BaseAlert v-if="requestError" variant="error">{{ requestError }}</BaseAlert>
        <BaseButton type="submit" block :loading="isSubmitting">
          {{ isSubmitting ? 'Đang đổi mật khẩu...' : 'Đổi mật khẩu' }}
        </BaseButton>
      </form>
    </section>
  </div>
</template>

<style scoped>
.change-password-page {
  display: grid;
  width: min(100% - 32px, 500px);
  min-height: calc(100vh - 126px);
  align-content: center;
  margin: 0 auto;
  padding: 38px 0;
}
.change-password-card {
  overflow: hidden;
}
.change-password-card > header {
  padding: 27px 28px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface-subtle);
}
.change-password-card h1 {
  margin-bottom: 7px;
  font-size: 23px;
}
.change-password-card > header p:last-child {
  margin: 0;
  color: var(--color-muted);
  font-size: 14px;
  line-height: 1.5;
}
.change-password-card form {
  display: grid;
  gap: 19px;
  padding: 27px 28px;
}
</style>
