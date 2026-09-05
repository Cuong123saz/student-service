<script setup lang="ts">
import type { SystemRoleCode } from '~/types/auth'

definePageMeta({ layout: 'admin', middleware: 'admin-auth' })

const { user } = useAdminAuth()
const { createInvitation, resendInvitation } = useUserInvitation()
const form = reactive({ fullName: '', username: '', email: '', roles: [] as SystemRoleCode[], studentCode: '', classId: '' })
const errors = reactive({ fullName: '', username: '', email: '', roles: '', studentCode: '', classId: '' })
const isSubmitting = ref(false)
const successMessage = ref('')
const requestError = ref('')
const lastInvitedUserId = ref('')
const isResending = ref(false)
const deliveryFailed = ref(false)

const standardRoles: { code: SystemRoleCode, label: string }[] = [
  { code: 'STUDENT', label: 'Sinh viên' },
  { code: 'ACADEMIC_ADVISOR', label: 'Giảng viên cố vấn' },
  { code: 'FACULTY_REVIEWER', label: 'Cán bộ khoa' },
  { code: 'DOCUMENT_SIGNER', label: 'Người ký văn bản' },
]
const privilegedRoles: { code: SystemRoleCode, label: string }[] = [
  { code: 'ADMIN', label: 'Quản trị nghiệp vụ' },
  { code: 'SYSTEM_ADMIN', label: 'Quản trị hệ thống' },
]
const availableRoles = computed(() => (
  user.value?.roles.includes('SYSTEM_ADMIN')
    ? [...standardRoles, ...privilegedRoles]
    : standardRoles
))
const isStudent = computed(() => form.roles.includes('STUDENT'))

function validate() {
  errors.fullName = form.fullName.trim().length < 2 ? 'Vui lòng nhập họ và tên.' : ''
  errors.username = !/^[a-z0-9_.]+$/.test(form.username.trim())
    ? 'Chỉ dùng chữ thường, số, dấu chấm và gạch dưới.'
    : ''
  errors.email = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())
    ? 'Địa chỉ email không hợp lệ.'
    : ''
  errors.roles = form.roles.length ? '' : 'Chọn ít nhất một vai trò.'
  errors.studentCode = isStudent.value && !form.studentCode.trim()
    ? 'Vui lòng nhập mã sinh viên.' : ''
  errors.classId = isStudent.value && !form.classId.trim()
    ? 'Vui lòng nhập mã lớp.' : ''
  return !Object.values(errors).some(Boolean)
}

function resetForm() {
  form.fullName = ''
  form.username = ''
  form.email = ''
  form.roles = []
  form.studentCode = ''
  form.classId = ''
  Object.assign(errors, { fullName: '', username: '', email: '', roles: '', studentCode: '', classId: '' })
  requestError.value = ''
}

async function handleSubmit() {
  successMessage.value = ''
  requestError.value = ''
  deliveryFailed.value = false
  lastInvitedUserId.value = ''
  if (!validate() || isSubmitting.value) return
  isSubmitting.value = true

  const invitedEmail = form.email.trim().toLowerCase()
  try {
    const response = await createInvitation({
      fullName: form.fullName.trim(),
      username: form.username.trim().toLowerCase(),
      email: invitedEmail,
      roles: [...form.roles],
      ...(isStudent.value ? { studentCode: form.studentCode.trim().toUpperCase(), classId: form.classId.trim() } : {}),
    })
    successMessage.value = response.invitation.deliveryStatus === 'SENT'
      ? `Đã gửi liên kết kích hoạt đến ${invitedEmail}.`
      : `Tài khoản đã tạo nhưng email chưa gửi được đến ${invitedEmail}. Hãy dùng chức năng gửi lại lời mời.`
    lastInvitedUserId.value = response.user.id
    deliveryFailed.value = response.invitation.deliveryStatus === 'FAILED'
    resetForm()
  } catch (error: unknown) {
    const responseError = (error as {
      data?: {
        error?: {
          field?: string
          message?: string
        }
      }
    } | undefined)?.data?.error
    const field = responseError?.field
    if (
      field === 'username'
      || field === 'email'
      || field === 'studentCode'
      || field === 'classId'
    ) {
      errors[field] = responseError.message ?? 'Giá trị không hợp lệ.'
      requestError.value = ''
    } else {
      requestError.value = 'Không thể gửi lời mời. Bạn hãy kiểm tra quyền và dữ liệu đã nhập.'
    }
  } finally {
    isSubmitting.value = false
  }
}

async function handleResend() {
  if (!lastInvitedUserId.value || isResending.value) return
  isResending.value = true
  requestError.value = ''
  try {
    const response = await resendInvitation(lastInvitedUserId.value)
    deliveryFailed.value = response.invitation.deliveryStatus === 'FAILED'
    successMessage.value = deliveryFailed.value
      ? 'Hệ thống vẫn chưa gửi được email. Bạn có thể thử lại sau.'
      : 'Đã gửi lại liên kết kích hoạt thành công.'
  } catch {
    requestError.value = 'Không thể gửi lại lời mời lúc này.'
  } finally {
    isResending.value = false
  }
}
</script>

<template>
  <section class="invite-page">
    <header>
      <p class="page-eyebrow">Quản lý người dùng</p>
      <h1 class="page-title">Gửi lời mời người dùng</h1>
      <p class="page-description">Người dùng sẽ nhận email chứa liên kết để tự tạo mật khẩu và kích hoạt tài khoản.</p>
    </header>

    <BaseAlert v-if="successMessage" :variant="deliveryFailed ? 'warning' : 'success'" :title="deliveryFailed ? 'Tài khoản đã tạo' : 'Gửi lời mời thành công'">
      {{ successMessage }}
      <button v-if="deliveryFailed" class="invite-resend" type="button" :disabled="isResending" @click="handleResend">
        {{ isResending ? 'Đang gửi lại…' : 'Gửi lại lời mời' }}
      </button>
    </BaseAlert>
    <BaseAlert v-if="requestError" variant="error" title="Không thể gửi lời mời">
      {{ requestError }}
    </BaseAlert>

    <form class="invite-form surface-card" novalidate @submit.prevent="handleSubmit">
      <BaseAlert variant="info">
        Hệ thống không hiển thị mã kích hoạt. Người dùng tự thiết lập mật khẩu qua liên kết gửi đến email.
      </BaseAlert>
      <BaseInput
        id="invite-full-name"
        v-model="form.fullName"
        label="Họ và tên"
        placeholder="Ví dụ: Nguyễn Văn A"
        maxlength="255"
        required
        :disabled="isSubmitting"
        :error="errors.fullName"
        @update:model-value="errors.fullName = ''; successMessage = ''; requestError = ''"
      />

      <template v-if="isStudent">
        <BaseInput
          id="invite-student-code"
          v-model="form.studentCode"
          label="Mã sinh viên"
          placeholder="Ví dụ: 22QLGD001"
          maxlength="50"
          required
          :disabled="isSubmitting"
          :error="errors.studentCode"
          @update:model-value="errors.studentCode = ''; successMessage = ''; requestError = ''"
        />
        <BaseInput
          id="invite-class-id"
          v-model="form.classId"
          label="Mã lớp học vụ"
          placeholder="UUID lớp do hệ thống cung cấp"
          hint="Tạm thời nhập mã định danh lớp đã được seed; màn hình chọn lớp sẽ bổ sung sau."
          required
          :disabled="isSubmitting"
          :error="errors.classId"
          @update:model-value="errors.classId = ''; successMessage = ''; requestError = ''"
        />
      </template>
      <BaseInput
        id="invite-username"
        v-model="form.username"
        label="Tên đăng nhập"
        placeholder="Ví dụ: nguyenvana"
        maxlength="100"
        required
        hint="Chỉ dùng chữ thường, số, dấu chấm và gạch dưới."
        :disabled="isSubmitting"
        :error="errors.username"
        @update:model-value="errors.username = ''; successMessage = ''; requestError = ''"
      />
      <BaseInput
        id="invite-email"
        v-model="form.email"
        label="Địa chỉ email"
        type="email"
        placeholder="Ví dụ: sinhvien@example.edu.vn"
        maxlength="255"
        required
        :disabled="isSubmitting"
        :error="errors.email"
        @update:model-value="errors.email = ''; successMessage = ''; requestError = ''"
      />

      <fieldset :aria-describedby="errors.roles ? 'invite-roles-error' : undefined">
        <legend>Vai trò <span>(có thể chọn nhiều)</span></legend>
        <label v-for="role in availableRoles" :key="role.code">
          <input v-model="form.roles" type="checkbox" :value="role.code" :disabled="isSubmitting">
          <span><strong>{{ role.label }}</strong><small>{{ role.code }}</small></span>
        </label>
        <p v-if="errors.roles" id="invite-roles-error" role="alert">{{ errors.roles }}</p>
      </fieldset>

      <div class="invite-form__actions">
        <BaseButton type="submit" :loading="isSubmitting">
          {{ isSubmitting ? 'Đang gửi...' : 'Gửi lời mời' }}
        </BaseButton>
        <BaseButton type="button" variant="secondary" :disabled="isSubmitting" @click="resetForm">
          Xóa form
        </BaseButton>
      </div>
    </form>
  </section>
</template>

<style scoped>
.invite-page { max-width: 650px; }
.invite-page > header { margin-bottom: 24px; }
.invite-page > .base-alert { margin-bottom: 14px; }
.invite-form { display: grid; gap: 20px; padding: 26px; }
.invite-form fieldset { display: grid; gap: 9px; margin: 0; padding: 0; border: 0; }
.invite-form legend { margin-bottom: 2px; font-size: 14px; font-weight: 700; }
.invite-form legend span { color: var(--color-muted); font-weight: 400; }
.invite-form fieldset label { display: flex; min-height: 48px; align-items: center; gap: 11px; padding: 9px 12px; border: 1px solid var(--color-border); border-radius: 10px; cursor: pointer; }
.invite-form fieldset label:has(input:checked) { border-color: #93c5fd; background: var(--color-primary-soft); }
.invite-form fieldset input { width: 18px; height: 18px; accent-color: var(--color-primary); }
.invite-form fieldset label span { display: flex; align-items: center; justify-content: space-between; flex: 1; gap: 12px; }
.invite-form fieldset small { color: var(--color-muted); font-size: 11px; }
.invite-form fieldset p { margin: 0; color: var(--color-error); font-size: 13px; }
.invite-form__actions { display: flex; gap: 10px; padding-top: 4px; }
.invite-resend { display: block; margin-top: 9px; padding: 0; border: 0; color: var(--color-primary); background: transparent; font-size: 13px; font-weight: 800; cursor: pointer; }
.invite-resend:disabled { opacity: .6; cursor: wait; }
@media (max-width: 520px) {
  .invite-form { padding: 21px 18px; }
  .invite-form__actions { flex-direction: column; }
  .invite-form__actions :deep(button) { width: 100%; }
}
</style>
