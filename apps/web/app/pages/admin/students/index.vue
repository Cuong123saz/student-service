<script setup lang="ts">
import {
  studentAccountStatusLabels,
  studentAccountStatuses,
  type StudentAccountStatus,
  type AdminStudentDirectoryItem,
} from '~/types/admin-student'
import { buildStudentExportUrl } from '~/utils/student-export-url'

definePageMeta({
  layout: 'admin',
  middleware: 'admin-auth',
})

const PAGE_SIZE = 20
const config = useRuntimeConfig()
const importTemplateUrl = computed(
  () => `${config.public.apiBase}/api/v1/admin/students/import-template.xlsx`,
)

const {
  students,
  nextCursor,
  isLoading,
  hasLoaded,
  errorMessage,
  isUpdating,
  updateErrorMessage,
  load,
  updateStudent,
} = useAdminStudents()
const {
  faculties,
  isLoading: isCatalogLoading,
  errorMessage: catalogErrorMessage,
  load: loadCatalog,
} = useAcademicCatalog()
const { resendInvitation } = useUserInvitation()

type ResendFeedbackVariant =
  'success' | 'warning' | 'error'

interface ResendFeedback {
  userId: string
  variant: ResendFeedbackVariant
  title: string
  message: string
}

const searchInput = ref('')
const statusInput = ref<'' | StudentAccountStatus>('')
const facultyInput = ref('')
const classInput = ref('')
const appliedSearch = ref('')
const appliedStatus = ref<'' | StudentAccountStatus>('')
const appliedFaculty = ref('')
const appliedClass = ref('')
const currentCursor = ref<string | undefined>()
const cursorHistory = ref<Array<string | undefined>>([])
const pendingResendUserId = ref('')
const resendingUserId = ref('')
const resendFeedback = ref<ResendFeedback | null>(null)
const editingStudent = ref<AdminStudentDirectoryItem | null>(null)
const editForm = reactive({
  studentCode: '',
  fullName: '',
  facultyId: '',
  classId: '',
})
const editValidationMessage = ref('')
const editSuccessMessage = ref('')

const exportUrl = computed(() =>
  buildStudentExportUrl(config.public.apiBase, {
    search: appliedSearch.value,
    status: appliedStatus.value,
    facultyId: appliedFaculty.value,
    classId: appliedClass.value,
  }),
)

const pageNumber = computed(
  () => cursorHistory.value.length + 1,
)
const hasActiveFilters = computed(
  () => Boolean(
    appliedSearch.value
    || appliedStatus.value
    || appliedFaculty.value
    || appliedClass.value,
  ),
)
const availableClasses = computed(() => {
  if (!facultyInput.value) {
    return faculties.value.flatMap(
      faculty => faculty.classes,
    )
  }

  return faculties.value.find(
    faculty => faculty.id === facultyInput.value,
  )?.classes ?? []
})
const availableEditClasses = computed(() =>
  faculties.value.find(
    faculty => faculty.id === editForm.facultyId,
  )?.classes ?? [],
)

function beginEdit(student: AdminStudentDirectoryItem) {
  editingStudent.value = student
  editForm.studentCode = student.studentCode
  editForm.fullName = student.fullName
  editForm.facultyId = student.faculty.id
  editForm.classId = student.academicClass.id
  editValidationMessage.value = ''
  editSuccessMessage.value = ''
}

function cancelEdit() {
  if (isUpdating.value) return
  editingStudent.value = null
  editValidationMessage.value = ''
}

async function saveStudent() {
  const student = editingStudent.value
  if (!student || isUpdating.value) return

  const studentCode = editForm.studentCode.trim()
  const fullName = editForm.fullName.trim().replace(/\s+/g, ' ')
  if (!/^\d{1,50}$/.test(studentCode)) {
    editValidationMessage.value = 'Mã sinh viên chỉ được chứa chữ số (tối đa 50 số).'
    return
  }
  if (fullName.length < 2 || !editForm.facultyId || !editForm.classId) {
    editValidationMessage.value = 'Vui lòng nhập tên và chọn đầy đủ khoa, lớp hành chính.'
    return
  }

  editValidationMessage.value = ''
  const saved = await updateStudent(student.userId, {
    studentCode,
    fullName,
    facultyId: editForm.facultyId,
    classId: editForm.classId,
  })
  if (!saved) return

  editingStudent.value = null
  editSuccessMessage.value = `Đã cập nhật hồ sơ ${fullName}.`
  await loadPage()
}

function initials(fullName: string): string {
  return fullName
    .trim()
    .split(/\s+/)
    .slice(-2)
    .map(part => part.charAt(0))
    .join('')
    .toUpperCase()
}

function getResponseStatus(
  error: unknown,
): number | undefined {
  if (!error || typeof error !== 'object') {
    return undefined
  }

  const candidate = error as {
    statusCode?: unknown
    response?: { status?: unknown }
  }

  if (typeof candidate.statusCode === 'number') {
    return candidate.statusCode
  }

  return typeof candidate.response?.status === 'number'
    ? candidate.response.status
    : undefined
}

function beginResend(userId: string) {
  if (resendingUserId.value) return

  pendingResendUserId.value = userId
  resendFeedback.value = null
}

function cancelResend() {
  pendingResendUserId.value = ''
}

async function confirmResend(
  student: {
    userId: string
    fullName: string
    email: string | null
  },
) {
  if (resendingUserId.value) return

  pendingResendUserId.value = ''
  resendingUserId.value = student.userId
  resendFeedback.value = null

  try {
    const response = await resendInvitation(student.userId)
    const recipient = student.email
      ? ` tới ${student.email}`
      : ''

    resendFeedback.value = response.invitation.deliveryStatus === 'SENT'
      ? {
          userId: student.userId,
          variant: 'success',
          title: 'Đã gửi lại lời mời',
          message: `Liên kết kích hoạt mới của ${student.fullName} đã được gửi${recipient}.`,
        }
      : {
          userId: student.userId,
          variant: 'warning',
          title: 'Email chưa gửi được',
          message: 'Token mới đã được tạo nhưng dịch vụ email chưa gửi thành công. Bạn có thể thử lại sau.',
        }
  } catch (error: unknown) {
    const status = getResponseStatus(error)
    let message =
      'Không thể gửi lại lời mời lúc này. Vui lòng thử lại sau.'

    if (status === 401) {
      message =
        'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
    } else if (status === 403) {
      message =
        'Bạn không có quyền gửi lời mời cho sinh viên này hoặc sinh viên nằm ngoài phạm vi được giao.'
    } else if (status === 404 || status === 409) {
      message =
        'Tài khoản không còn ở trạng thái có thể gửi lại lời mời. Hãy làm mới danh sách.'
    } else if (status === 429) {
      message =
        'Bạn đã gửi lại quá nhiều lần. Vui lòng chờ 15 phút rồi thử lại.'
    }

    resendFeedback.value = {
      userId: student.userId,
      variant: 'error',
      title: 'Không thể gửi lại lời mời',
      message,
    }
  } finally {
    resendingUserId.value = ''
  }
}

async function loadPage(
  cursor = currentCursor.value,
) {
  pendingResendUserId.value = ''

  return await load({
    limit: PAGE_SIZE,
    ...(cursor ? { after: cursor } : {}),
    ...(appliedStatus.value
      ? { status: appliedStatus.value }
      : {}),
    ...(appliedSearch.value
      ? { search: appliedSearch.value }
      : {}),
    ...(appliedFaculty.value
      ? { facultyId: appliedFaculty.value }
      : {}),
    ...(appliedClass.value
      ? { classId: appliedClass.value }
      : {}),
  })
}

async function applyFilters() {
  appliedSearch.value = searchInput.value.trim()
  appliedStatus.value = statusInput.value
  appliedFaculty.value = facultyInput.value
  appliedClass.value = classInput.value
  currentCursor.value = undefined
  cursorHistory.value = []
  await loadPage()
}

async function clearFilters() {
  searchInput.value = ''
  statusInput.value = ''
  facultyInput.value = ''
  classInput.value = ''
  appliedSearch.value = ''
  appliedStatus.value = ''
  appliedFaculty.value = ''
  appliedClass.value = ''
  currentCursor.value = undefined
  cursorHistory.value = []
  await loadPage()
}

async function goToNextPage() {
  if (!nextCursor.value || isLoading.value) return

  cursorHistory.value.push(currentCursor.value)
  currentCursor.value = nextCursor.value
  await loadPage()
}

async function goToPreviousPage() {
  if (!cursorHistory.value.length || isLoading.value) return

  currentCursor.value = cursorHistory.value.pop()
  await loadPage()
}

watch(facultyInput, () => {
  classInput.value = ''
})

watch(() => editForm.facultyId, (facultyId, previousFacultyId) => {
  if (previousFacultyId && facultyId !== previousFacultyId) {
    editForm.classId = ''
  }
})

onMounted(() => {
  void Promise.all([
    loadPage(),
    loadCatalog(),
  ])
})
</script>

<template>
  <section class="student-directory">
    <header class="student-directory__header">
      <div>
        <p class="page-eyebrow">Quản lý người dùng</p>
        <h1 class="page-title">Danh sách sinh viên</h1>
        <p class="page-description">
          Tra cứu tài khoản và thông tin học vụ trong phạm vi bạn được phân quyền.
        </p>
      </div>
      <div class="student-directory__header-actions">
        <NuxtLink
          class="student-directory__import"
          to="/admin/students/import"
        >
          Import danh sách
        </NuxtLink>

        <a
          class="student-directory__template"
          :href="importTemplateUrl"
          download="mau-import-sinh-vien.xlsx"
        >
          <span aria-hidden="true">⇩</span>
          Tải Excel mẫu
        </a>

        <a
          class="student-directory__export"
          :href="exportUrl"
          download="danh-sach-sinh-vien.xlsx"
        >
          <span aria-hidden="true">⇩</span>
          Xuất Excel
        </a>

        <NuxtLink class="student-directory__invite" to="/admin/users/invite">
          <span aria-hidden="true">＋</span>
          Mời sinh viên mới
        </NuxtLink>
      </div>
    </header>

    <div class="student-directory__scope-note" role="note">
      <span aria-hidden="true">✓</span>
      <p>
        <strong>Dữ liệu đã được giới hạn tự động</strong>
        Bạn chỉ nhìn thấy sinh viên thuộc phạm vi toàn hệ thống, khoa hoặc lớp được giao.
      </p>
    </div>

    <form
      class="student-directory__filters surface-card"
      role="search"
      @submit.prevent="applyFilters"
    >
      <label class="student-directory__search">
        <span>Tìm kiếm sinh viên</span>
        <span class="student-directory__search-control">
          <span aria-hidden="true">⌕</span>
          <input
            v-model="searchInput"
            type="search"
            maxlength="100"
            placeholder="Họ tên, mã sinh viên hoặc tên đăng nhập"
            :disabled="isLoading"
          >
        </span>
      </label>

      <label class="student-directory__select">
        <span>Trạng thái tài khoản</span>
        <select v-model="statusInput" :disabled="isLoading">
          <option value="">Tất cả trạng thái</option>
          <option
            v-for="status in studentAccountStatuses"
            :key="status"
            :value="status"
          >
            {{ studentAccountStatusLabels[status] }}
          </option>
        </select>
      </label>

      <label class="student-directory__select">
        <span>Khoa</span>
        <select
          v-model="facultyInput"
          :disabled="isLoading || isCatalogLoading"
        >
          <option value="">Tất cả khoa</option>
          <option
            v-for="faculty in faculties"
            :key="faculty.id"
            :value="faculty.id"
          >
            {{ faculty.code }} · {{ faculty.name }}
          </option>
        </select>
      </label>

      <label class="student-directory__select">
        <span>Lớp học vụ</span>
        <select
          v-model="classInput"
          :disabled="isLoading || isCatalogLoading"
        >
          <option value="">Tất cả lớp</option>
          <option
            v-for="academicClass in availableClasses"
            :key="academicClass.id"
            :value="academicClass.id"
          >
            {{ academicClass.code }} · {{ academicClass.name }}
          </option>
        </select>
      </label>

      <div class="student-directory__filter-actions">
        <BaseButton type="submit" :loading="isLoading">
          Áp dụng
        </BaseButton>
        <BaseButton
          v-if="hasActiveFilters || searchInput || statusInput || facultyInput || classInput"
          type="button"
          variant="secondary"
          :disabled="isLoading"
          @click="clearFilters"
        >
          Xóa lọc
        </BaseButton>
      </div>
    </form>

    <BaseAlert
      v-if="catalogErrorMessage"
      variant="warning"
      title="Bộ lọc khoa/lớp chưa sẵn sàng"
    >
      {{ catalogErrorMessage }} Bạn vẫn có thể tìm theo từ khóa và trạng thái.
      <button
        type="button"
        class="student-directory__catalog-retry"
        :disabled="isCatalogLoading"
        @click="loadCatalog"
      >
        {{ isCatalogLoading ? 'Đang thử lại…' : 'Thử tải lại danh mục' }}
      </button>
    </BaseAlert>

    <section class="student-directory__results" aria-live="polite">
      <div class="student-directory__result-heading">
        <div>
          <h2>Kết quả tra cứu</h2>
          <p v-if="hasLoaded && !errorMessage">
            {{ students.length }} sinh viên trên trang {{ pageNumber }}
          </p>
        </div>
        <button
          v-if="hasLoaded && !errorMessage"
          type="button"
          class="student-directory__refresh"
          :disabled="isLoading"
          @click="loadPage()"
        >
          Làm mới
        </button>
      </div>

      <BaseAlert
        v-if="resendFeedback"
        :variant="resendFeedback.variant"
        :title="resendFeedback.title"
      >
        {{ resendFeedback.message }}
        <NuxtLink
          v-if="resendFeedback.variant === 'error' && resendFeedback.message.includes('hết hạn')"
          class="student-directory__feedback-link"
          to="/admin/login"
        >
          Đăng nhập lại
        </NuxtLink>
      </BaseAlert>

      <BaseAlert
        v-if="editSuccessMessage"
        variant="success"
        title="Đã lưu thông tin sinh viên"
      >
        {{ editSuccessMessage }}
      </BaseAlert>

      <div v-if="isLoading" class="student-directory__loading" role="status">
        <img src="/images/naem-logo.jpg" alt="">
        <div>
          <strong>Đang tải danh sách sinh viên</strong>
          <span>Hệ thống đang kiểm tra quyền và phạm vi dữ liệu…</span>
        </div>
      </div>

      <BaseAlert
        v-else-if="errorMessage"
        variant="error"
        title="Không thể hiển thị danh sách"
      >
        {{ errorMessage }}
        <div class="student-directory__error-actions">
          <BaseButton type="button" variant="secondary" @click="loadPage()">
            Thử lại
          </BaseButton>
          <NuxtLink v-if="errorMessage.includes('hết hạn')" to="/admin/login">
            Đăng nhập lại
          </NuxtLink>
        </div>
      </BaseAlert>

      <div
        v-else-if="hasLoaded && students.length === 0"
        class="student-directory__empty surface-card"
      >
        <span aria-hidden="true">SV</span>
        <h2>Không tìm thấy sinh viên</h2>
        <p>
          Hãy thay đổi từ khóa hoặc trạng thái. Kết quả cũng có thể bị giới hạn bởi phạm vi được giao.
        </p>
        <BaseButton
          v-if="hasActiveFilters"
          type="button"
          variant="secondary"
          @click="clearFilters"
        >
          Xóa bộ lọc
        </BaseButton>
      </div>

      <template v-else-if="hasLoaded">
        <div class="student-directory__table-wrap surface-card">
          <table>
            <thead>
              <tr>
                <th>Sinh viên</th>
                <th>Mã sinh viên</th>
                <th>Lớp</th>
                <th>Khoa</th>
                <th>Trạng thái</th>
                <th class="student-directory__action-heading">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="student in students" :key="student.userId">
                <td>
                  <div class="student-directory__identity">
                    <span aria-hidden="true">{{ initials(student.fullName) }}</span>
                    <div>
                      <strong>{{ student.fullName }}</strong>
                      <small>{{ student.email || student.username }}</small>
                    </div>
                  </div>
                </td>
                <td><code>{{ student.studentCode }}</code></td>
                <td>
                  <strong>{{ student.academicClass.code }}</strong>
                  <small>{{ student.academicClass.name }}</small>
                </td>
                <td>
                  <strong>{{ student.faculty.code }}</strong>
                  <small>{{ student.faculty.name }}</small>
                </td>
                <td>
                  <span
                    class="student-directory__status"
                    :class="`student-directory__status--${student.status.toLowerCase()}`"
                  >
                    {{ studentAccountStatusLabels[student.status] }}
                  </span>
                </td>
                <td class="student-directory__action-cell">
                  <button
                    type="button"
                    class="student-directory__edit-button"
                    :disabled="Boolean(resendingUserId)"
                    :aria-label="`Sửa thông tin ${student.fullName}`"
                    @click="beginEdit(student)"
                  >
                    Sửa thông tin
                  </button>
                  <template v-if="student.status === 'INVITED'">
                    <div
                      v-if="pendingResendUserId === student.userId"
                      class="student-directory__confirmation"
                    >
                      <span>Gửi liên kết mới?</span>
                      <div>
                        <button
                          type="button"
                          class="student-directory__confirm-button"
                          :disabled="Boolean(resendingUserId)"
                          @click="confirmResend(student)"
                        >
                          Xác nhận
                        </button>
                        <button
                          type="button"
                          class="student-directory__cancel-button"
                          :disabled="Boolean(resendingUserId)"
                          @click="cancelResend"
                        >
                          Hủy
                        </button>
                      </div>
                    </div>
                    <button
                      v-else
                      type="button"
                      class="student-directory__resend-button"
                      :disabled="Boolean(resendingUserId)"
                      :aria-label="`Gửi lại lời mời cho ${student.fullName}`"
                      @click="beginResend(student.userId)"
                    >
                      <span aria-hidden="true">↻</span>
                      {{ resendingUserId === student.userId ? 'Đang gửi…' : 'Gửi lại lời mời' }}
                    </button>
                  </template>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <nav class="student-directory__pagination" aria-label="Phân trang sinh viên">
          <button
            type="button"
            :disabled="cursorHistory.length === 0 || isLoading"
            @click="goToPreviousPage"
          >
            ← Trang trước
          </button>
          <span>Trang {{ pageNumber }}</span>
          <button
            type="button"
            :disabled="!nextCursor || isLoading"
            @click="goToNextPage"
          >
            Trang sau →
          </button>
        </nav>
      </template>
    </section>

    <div
      v-if="editingStudent"
      class="student-directory__modal-backdrop"
      role="presentation"
      @click.self="cancelEdit"
    >
      <form
        class="student-directory__edit-modal surface-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="student-edit-title"
        @submit.prevent="saveStudent"
      >
        <header>
          <div>
            <p class="page-eyebrow">Hồ sơ sinh viên</p>
            <h2 id="student-edit-title">Sửa thông tin cá nhân</h2>
          </div>
          <button type="button" aria-label="Đóng" :disabled="isUpdating" @click="cancelEdit">×</button>
        </header>

        <label>
          <span>Mã sinh viên</span>
          <input
            v-model="editForm.studentCode"
            type="text"
            inputmode="numeric"
            pattern="[0-9]+"
            maxlength="50"
            autocomplete="off"
            required
          >
          <small>Chỉ nhập chữ số. Số 0 ở đầu vẫn được giữ nguyên.</small>
        </label>

        <label>
          <span>Tên sinh viên</span>
          <input v-model="editForm.fullName" type="text" minlength="2" maxlength="255" required>
        </label>

        <label>
          <span>Khoa</span>
          <select v-model="editForm.facultyId" required>
            <option value="" disabled>Chọn khoa</option>
            <option v-for="faculty in faculties" :key="faculty.id" :value="faculty.id">
              {{ faculty.code }} · {{ faculty.name }}
            </option>
          </select>
        </label>

        <label>
          <span>Lớp hành chính</span>
          <select v-model="editForm.classId" :disabled="!editForm.facultyId" required>
            <option value="" disabled>Chọn lớp hành chính</option>
            <option v-for="academicClass in availableEditClasses" :key="academicClass.id" :value="academicClass.id">
              {{ academicClass.code }} · {{ academicClass.name }}
            </option>
          </select>
          <small>Khoa được đồng bộ tự động theo lớp đã chọn.</small>
        </label>

        <BaseAlert
          v-if="editValidationMessage || updateErrorMessage"
          variant="error"
          title="Chưa thể lưu"
        >
          {{ editValidationMessage || updateErrorMessage }}
        </BaseAlert>

        <footer>
          <BaseButton type="button" variant="secondary" :disabled="isUpdating" @click="cancelEdit">
            Hủy
          </BaseButton>
          <BaseButton type="submit" :loading="isUpdating">
            Lưu thay đổi
          </BaseButton>
        </footer>
      </form>
    </div>
  </section>
</template>

<style scoped>
.student-directory { display: grid; gap: 24px; }
.student-directory__header { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; }
.student-directory__header > div { max-width: 720px; }
.student-directory__header-actions { display: flex; flex: 0 0 auto; align-items: center; gap: 9px; }
.student-directory__header-actions .student-directory__import { display: inline-flex; min-height: 44px; align-items: center; padding: 10px 16px; border: 1px solid var(--color-border); border-radius: 12px; color: var(--color-primary); background: var(--color-surface); font-size: 14px; font-weight: 750; text-decoration: none; transition: border-color 160ms ease, background-color 160ms ease; }
.student-directory__header-actions .student-directory__import:hover { border-color: #b9d6ff; background: var(--color-primary-soft); }
.student-directory__template { display: inline-flex; min-height: 44px; align-items: center; gap: 7px; padding: 10px 16px; border: 1px solid #b9d6ff; border-radius: 12px; color: var(--color-primary-dark); background: var(--color-primary-soft); font-size: 14px; font-weight: 750; text-decoration: none; transition: border-color 160ms ease, background-color 160ms ease; }
.student-directory__template:hover { border-color: var(--color-primary); background: #e2f0ff; }
.student-directory__export { display: inline-flex; min-height: 44px; align-items: center; gap: 7px; padding: 10px 16px; border: 1px solid #b9d6ff; border-radius: 12px; color: var(--color-primary-dark); background: var(--color-primary-soft); font-size: 14px; font-weight: 750; text-decoration: none; transition: border-color 160ms ease, background-color 160ms ease; }
.student-directory__export:hover { border-color: var(--color-primary); background: #e2f0ff; }
.student-directory__invite { display: inline-flex; min-height: 44px; flex: 0 0 auto; align-items: center; gap: 7px; padding: 10px 17px; border-radius: 12px; color: #fff; background: linear-gradient(135deg, var(--color-primary), #205c94); box-shadow: 0 8px 20px rgb(23 76 130 / 20%); font-size: 14px; font-weight: 750; text-decoration: none; transition: transform 160ms ease, box-shadow 160ms ease; }
.student-directory__invite:hover { transform: translateY(-1px); box-shadow: 0 11px 24px rgb(23 76 130 / 28%); }
.student-directory__scope-note { display: flex; align-items: center; gap: 13px; padding: 14px 17px; border: 1px solid #cfe2f5; border-radius: 14px; color: var(--color-primary-dark); background: linear-gradient(100deg, #edf6ff, #f8fbff); }
.student-directory__scope-note > span { display: grid; width: 30px; height: 30px; flex: 0 0 auto; place-items: center; border-radius: 9px; color: #fff; background: var(--color-primary); font-weight: 800; }
.student-directory__scope-note p { display: grid; gap: 2px; margin: 0; font-size: 13px; line-height: 1.45; }
.student-directory__scope-note strong { font-size: 14px; }
.student-directory__filters { display: grid; grid-template-columns: minmax(240px, 1fr) repeat(3, minmax(150px, .48fr)); align-items: end; gap: 14px; padding: 20px; border-radius: 18px; }
.student-directory__filters label { display: grid; gap: 8px; color: var(--color-text); font-size: 13px; font-weight: 700; }
.student-directory__search-control { position: relative; display: block; }
.student-directory__search-control > span { position: absolute; top: 50%; left: 14px; color: var(--color-subtle); font-size: 20px; transform: translateY(-52%); }
.student-directory__filters input,
.student-directory__filters select { width: 100%; min-height: 46px; border: 1px solid var(--color-border); border-radius: 11px; color: var(--color-text); background: #fbfdff; transition: border-color 150ms ease, box-shadow 150ms ease; }
.student-directory__filters input { padding: 10px 14px 10px 42px; }
.student-directory__filters select { padding: 10px 36px 10px 13px; }
.student-directory__filters input:focus,
.student-directory__filters select:focus { border-color: var(--color-primary); outline: 0; background: #fff; box-shadow: 0 0 0 4px rgb(21 94 239 / 10%); }
.student-directory__filter-actions { display: flex; grid-column: 1 / -1; gap: 8px; }
.student-directory__catalog-retry { display: block; margin-top: 8px; padding: 0; border: 0; color: currentcolor; background: transparent; cursor: pointer; font-size: 13px; font-weight: 800; text-decoration: underline; }
.student-directory__catalog-retry:disabled { cursor: wait; opacity: .6; }
.student-directory__result-heading { display: flex; min-height: 45px; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 12px; }
.student-directory__result-heading h2 { margin-bottom: 3px; font-size: 18px; }
.student-directory__result-heading p { margin: 0; color: var(--color-muted); font-size: 13px; }
.student-directory__refresh { padding: 7px 2px; border: 0; color: var(--color-primary); background: transparent; cursor: pointer; font-size: 13px; font-weight: 750; }
.student-directory__refresh:disabled { cursor: wait; opacity: .55; }
.student-directory__loading { display: flex; min-height: 220px; align-items: center; justify-content: center; gap: 18px; border: 1px solid var(--color-border); border-radius: 18px; background: var(--color-surface); }
.student-directory__loading img { width: 58px; height: 58px; border-radius: 13px; object-fit: cover; box-shadow: 0 8px 24px rgb(11 31 64 / 15%); animation: loading-pulse 1.4s ease-in-out infinite; }
.student-directory__loading div { display: grid; gap: 5px; }
.student-directory__loading span { color: var(--color-muted); font-size: 13px; }
.student-directory__error-actions { display: flex; align-items: center; gap: 15px; margin-top: 10px; }
.student-directory__error-actions a { color: var(--color-primary); font-weight: 750; }
.student-directory__feedback-link { display: inline-block; margin-left: 8px; color: currentcolor; font-weight: 800; }
.student-directory__empty { display: grid; min-height: 280px; place-items: center; align-content: center; gap: 9px; padding: 32px; text-align: center; }
.student-directory__empty > span { display: grid; width: 58px; height: 58px; place-items: center; border: 1px solid #cfe2f5; border-radius: 17px; color: var(--color-primary); background: var(--color-primary-soft); font-weight: 850; }
.student-directory__empty h2 { margin: 3px 0 0; font-size: 19px; }
.student-directory__empty p { max-width: 510px; margin: 0 0 6px; color: var(--color-muted); font-size: 14px; line-height: 1.6; }
.student-directory__table-wrap { overflow: hidden; border-radius: 18px; }
.student-directory table { width: 100%; border-collapse: collapse; font-size: 13px; }
.student-directory th { padding: 13px 16px; border-bottom: 1px solid var(--color-border); color: var(--color-muted); background: #f6f9fd; font-size: 10px; letter-spacing: .055em; text-align: left; text-transform: uppercase; }
.student-directory td { padding: 15px 16px; border-bottom: 1px solid var(--color-border); vertical-align: middle; }
.student-directory tbody tr { transition: background-color 140ms ease; }
.student-directory tbody tr:hover { background: #f8fbff; }
.student-directory tbody tr:last-child td { border-bottom: 0; }
.student-directory td > strong,
.student-directory td > small { display: block; }
.student-directory td > strong { margin-bottom: 3px; }
.student-directory td > small { max-width: 220px; overflow: hidden; color: var(--color-muted); text-overflow: ellipsis; white-space: nowrap; }
.student-directory code { padding: 4px 7px; border-radius: 7px; color: var(--color-primary-dark); background: var(--color-primary-soft); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; font-weight: 750; }
.student-directory__identity { display: flex; min-width: 220px; align-items: center; gap: 11px; }
.student-directory__identity > span { display: grid; width: 38px; height: 38px; flex: 0 0 auto; place-items: center; border-radius: 11px; color: #fff; background: linear-gradient(145deg, var(--color-primary), #3272aa); font-size: 11px; font-weight: 800; }
.student-directory__identity div { display: grid; gap: 3px; min-width: 0; }
.student-directory__identity small { overflow: hidden; max-width: 220px; color: var(--color-muted); text-overflow: ellipsis; white-space: nowrap; }
.student-directory__status { display: inline-flex; padding: 5px 9px; border-radius: 999px; font-size: 11px; font-weight: 750; white-space: nowrap; }
.student-directory__status--active { color: var(--color-success); background: var(--color-success-background); }
.student-directory__status--invited { color: var(--color-info); background: var(--color-info-background); }
.student-directory__status--inactive { color: var(--color-muted); background: #edf1f5; }
.student-directory__status--suspended { color: var(--color-error); background: var(--color-error-background); }
.student-directory__action-heading,
.student-directory__action-cell { width: 180px; text-align: right !important; }
.student-directory__resend-button { display: inline-flex; min-height: 36px; align-items: center; justify-content: center; gap: 6px; padding: 7px 10px; border: 1px solid #b9d6ff; border-radius: 9px; color: var(--color-primary-dark); background: var(--color-primary-soft); cursor: pointer; font-size: 12px; font-weight: 780; white-space: nowrap; transition: border-color 140ms ease, background-color 140ms ease, transform 140ms ease; }
.student-directory__edit-button { display: inline-flex; min-height: 34px; align-items: center; justify-content: center; margin-bottom: 6px; padding: 6px 10px; border: 1px solid var(--color-border); border-radius: 9px; color: var(--color-primary); background: #fff; cursor: pointer; font-size: 12px; font-weight: 780; white-space: nowrap; }
.student-directory__edit-button:hover:not(:disabled) { border-color: var(--color-primary); background: var(--color-primary-soft); }
.student-directory__modal-backdrop { position: fixed; z-index: 100; inset: 0; display: grid; overflow-y: auto; place-items: center; padding: 24px; background: rgb(8 24 43 / 58%); }
.student-directory__edit-modal { display: grid; width: min(560px, 100%); gap: 18px; padding: 24px; border-radius: 18px; box-shadow: 0 24px 70px rgb(0 0 0 / 25%); }
.student-directory__edit-modal header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.student-directory__edit-modal h2 { margin: 2px 0 0; }
.student-directory__edit-modal header > button { width: 36px; height: 36px; border: 0; border-radius: 9px; color: var(--color-muted); background: #f2f5f8; cursor: pointer; font-size: 24px; }
.student-directory__edit-modal label { display: grid; gap: 7px; color: var(--color-text); font-size: 13px; font-weight: 750; }
.student-directory__edit-modal input,
.student-directory__edit-modal select { min-height: 45px; padding: 10px 12px; border: 1px solid var(--color-border); border-radius: 10px; background: #fff; }
.student-directory__edit-modal small { color: var(--color-muted); font-weight: 500; }
.student-directory__edit-modal footer { display: flex; justify-content: flex-end; gap: 9px; padding-top: 4px; }
.student-directory__resend-button:hover:not(:disabled) { border-color: var(--color-primary); background: #e2f0ff; transform: translateY(-1px); }
.student-directory__resend-button:disabled { cursor: wait; opacity: .6; }
.student-directory__confirmation { display: grid; justify-items: end; gap: 6px; }
.student-directory__confirmation > span { color: var(--color-text); font-size: 12px; font-weight: 750; white-space: nowrap; }
.student-directory__confirmation > div { display: flex; justify-content: flex-end; gap: 5px; }
.student-directory__confirm-button,
.student-directory__cancel-button { min-height: 31px; padding: 5px 8px; border-radius: 8px; cursor: pointer; font-size: 11px; font-weight: 800; }
.student-directory__confirm-button { border: 1px solid var(--color-primary); color: #fff; background: var(--color-primary); }
.student-directory__cancel-button { border: 1px solid var(--color-border); color: var(--color-muted); background: #fff; }
.student-directory__confirm-button:disabled,
.student-directory__cancel-button:disabled { cursor: wait; opacity: .6; }
.student-directory__no-action { color: var(--color-subtle); }
.student-directory__pagination { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-top: 14px; }
.student-directory__pagination button,
.student-directory__pagination span { min-height: 38px; padding: 8px 12px; border: 1px solid var(--color-border); border-radius: 10px; background: var(--color-surface); font-size: 12px; font-weight: 700; }
.student-directory__pagination button { color: var(--color-primary); cursor: pointer; }
.student-directory__pagination button:hover:not(:disabled) { border-color: #b9d6ff; background: var(--color-primary-soft); }
.student-directory__pagination button:disabled { color: var(--color-subtle); cursor: not-allowed; opacity: .65; }
.student-directory__pagination span { display: grid; place-items: center; color: var(--color-muted); }
@keyframes loading-pulse { 50% { transform: scale(.95); opacity: .7; } }
@media (max-width: 960px) {
  .student-directory__filters { grid-template-columns: 1fr 220px; }
  .student-directory__filter-actions { grid-column: 1 / -1; }
  .student-directory__table-wrap { overflow-x: auto; }
  .student-directory table { min-width: 900px; }
}
@media (max-width: 640px) {
  .student-directory__header { align-items: stretch; flex-direction: column; }
  .student-directory__header-actions { align-items: stretch; flex-direction: column; }
  .student-directory__header-actions > a { justify-content: center; }
  .student-directory__invite { align-self: flex-start; }
  .student-directory__filters { grid-template-columns: 1fr; padding: 17px; }
  .student-directory__filter-actions { grid-column: auto; flex-wrap: wrap; }
  .student-directory__scope-note { align-items: flex-start; }
  .student-directory__loading { align-items: center; flex-direction: column; padding: 28px; text-align: center; }
  .student-directory__pagination { justify-content: space-between; }
}
</style>
