<script setup lang="ts">
definePageMeta({ layout: 'auth' })

useHead({ meta: [{ name: 'referrer', content: 'no-referrer' }] })

const route = useRoute()
const { activateAccount } = useAccountActivation()
const initialToken = typeof route.query.token === 'string' ? route.query.token : ''
const token = ref(initialToken)
const form = reactive({ newPassword: '', confirmPassword: '' })
const errors = reactive({ newPassword: '', confirmPassword: '' })
const isSubmitting = ref(false)
const isActivated = ref(false)
const requestError = ref('')

const hasValidTokenShape = computed(() => /^[A-Za-z0-9_-]{43}$/.test(token.value))
const passwordLength = computed(() => [...form.newPassword].length)

onMounted(() => {
  if (initialToken) {
    window.history.replaceState(window.history.state, '', route.path)
  }
})

function validate() {
  errors.newPassword = passwordLength.value < 15 || passwordLength.value > 128
    ? 'Mật khẩu phải có từ 15 đến 128 ký tự.'
    : ''
  errors.confirmPassword = form.newPassword !== form.confirmPassword
    ? 'Mật khẩu xác nhận không khớp.'
    : ''
  return !errors.newPassword && !errors.confirmPassword
}

function getStatusCode(error: unknown) {
  if (typeof error !== 'object' || error === null) return undefined
  const response = (error as Record<string, unknown>).response
  if (typeof response !== 'object' || response === null) return undefined
  const status = (response as Record<string, unknown>).status
  return typeof status === 'number' ? status : undefined
}

async function submitActivation() {
  requestError.value = ''
  if (!hasValidTokenShape.value || !validate() || isSubmitting.value) return
  isSubmitting.value = true

  try {
    await activateAccount({ token: token.value, newPassword: form.newPassword })
    form.newPassword = ''
    form.confirmPassword = ''
    token.value = ''
    isActivated.value = true
  } catch (error) {
    requestError.value = getStatusCode(error) === 429
      ? 'Bạn đã thử quá nhiều lần. Vui lòng chờ một phút rồi thử lại.'
      : 'Liên kết không hợp lệ, đã hết hạn hoặc đã được sử dụng. Vui lòng liên hệ quản trị viên để nhận liên kết mới.'
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <div class="activation-page">
    <section class="activation-card surface-card" aria-labelledby="activation-title">
      <header>
        <p class="page-eyebrow">Bảo mật tài khoản</p>
        <h1 id="activation-title">Kích hoạt tài khoản</h1>
        <p>Thiết lập mật khẩu để hoàn tất việc kích hoạt.</p>
      </header>

      <div v-if="isActivated" class="activation-card__body activation-success">
        <div class="activation-success__icon" aria-hidden="true">✓</div>
        <h2>Kích hoạt thành công</h2>
        <p>Tài khoản của bạn đã sẵn sàng để đăng nhập.</p>
        <NuxtLink class="activation-success__link" to="/login">Đăng nhập ngay</NuxtLink>
      </div>

      <div v-else-if="!hasValidTokenShape" class="activation-card__body">
        <BaseAlert variant="error" title="Liên kết không hợp lệ">
          Liên kết có thể đã hết hạn, đã được sử dụng hoặc bị thiếu token. Vui lòng liên hệ quản trị viên để nhận liên kết mới.
        </BaseAlert>
      </div>

      <form v-else class="activation-card__body activation-form" novalidate @submit.prevent="submitActivation">
        <BaseAlert variant="info">
          Mật khẩu cần có từ <strong>15 đến 128 ký tự</strong>. Hãy ưu tiên một cụm từ dài, dễ nhớ và không dùng lại ở dịch vụ khác.
        </BaseAlert>
        <div>
          <BaseInput
            id="activation-password"
            v-model="form.newPassword"
            label="Mật khẩu mới"
            type="password"
            autocomplete="new-password"
            maxlength="128"
            required
            :disabled="isSubmitting"
            :error="errors.newPassword"
            @update:model-value="errors.newPassword = ''; requestError = ''"
          />
          <p class="activation-form__count" :class="{ valid: passwordLength >= 15 }">
            {{ passwordLength >= 15 ? 'Đã đủ độ dài tối thiểu' : `Cần thêm ${15 - passwordLength} ký tự` }} · {{ passwordLength }}/128
          </p>
        </div>
        <BaseInput
          id="activation-confirm-password"
          v-model="form.confirmPassword"
          label="Xác nhận mật khẩu"
          type="password"
          autocomplete="new-password"
          maxlength="128"
          required
          :disabled="isSubmitting"
          :error="errors.confirmPassword"
          @update:model-value="errors.confirmPassword = ''; requestError = ''"
        />
        <BaseAlert v-if="requestError" variant="error">{{ requestError }}</BaseAlert>
        <BaseButton type="submit" block :loading="isSubmitting">
          {{ isSubmitting ? 'Đang kích hoạt...' : 'Kích hoạt tài khoản' }}
        </BaseButton>
      </form>
    </section>
  </div>
</template>

<style scoped>
.activation-page { display: grid; width: min(100% - 32px, 500px); min-height: calc(100vh - 126px); align-content: center; margin: 0 auto; padding: 38px 0; }
.activation-card { overflow: hidden; }
.activation-card > header { padding: 28px; border-bottom: 1px solid var(--color-border); background: var(--color-surface-subtle); }
.activation-card h1 { margin-bottom: 7px; font-size: 24px; }
.activation-card > header p:last-child { margin: 0; color: var(--color-muted); font-size: 14px; }
.activation-card__body { padding: 27px 28px; }
.activation-form { display: grid; gap: 20px; }
.activation-form__count { margin: 7px 0 0; color: var(--color-muted); font-size: 12px; }
.activation-form__count.valid { color: var(--color-success); }
.activation-success { display: grid; justify-items: center; text-align: center; }
.activation-success__icon { display: grid; width: 56px; height: 56px; margin-bottom: 14px; place-items: center; border-radius: 16px; color: var(--color-success); background: var(--color-success-background); font-size: 26px; font-weight: 800; }
.activation-success h2 { margin-bottom: 7px; }
.activation-success p { margin-bottom: 20px; color: var(--color-muted); }
.activation-success__link { display: inline-flex; min-height: 44px; align-items: center; padding: 10px 18px; border-radius: 10px; color: #fff; background: var(--color-primary); font-weight: 700; text-decoration: none; }
</style>
