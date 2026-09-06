<script setup lang="ts">
import type {
  ManagedAcademicClass,
  ManagedFaculty,
  ManagedOrganizationalUnit,
  OrganizationApiError,
} from '~/types/organization-management'

definePageMeta({
  layout: 'admin',
  middleware: 'admin-auth',
})

const {
  data,
  isLoading,
  hasLoaded,
  errorMessage,
  load,
  createFaculty,
  updateFaculty,
  createAcademicClass,
  updateAcademicClass,
  createOrganizationalUnit,
  updateOrganizationalUnit,
  setAcademicAdvisor,
} = useOrganizationManagement()

const openForm = ref<'' | 'faculty' | 'class' | 'unit'>('')
const busyKey = ref('')
const feedback = ref<{
  variant: 'success' | 'error'
  title: string
  message: string
} | null>(null)
const editingFacultyId = ref('')
const editingClassId = ref('')
const editingUnitId = ref('')
const pendingStatusKey = ref('')
const advisorDrafts = reactive<Record<string, string>>({})
const facultyForm = reactive({ code: '', name: '' })
const classForm = reactive({ facultyId: '', code: '', name: '' })
const unitForm = reactive({ code: '', name: '' })
const facultyEditForm = reactive({ code: '', name: '' })
const classEditForm = reactive({ code: '', name: '' })
const unitEditForm = reactive({ code: '', name: '' })
const formErrors = reactive({
  facultyCode: '',
  facultyName: '',
  classFacultyId: '',
  classCode: '',
  className: '',
  unitCode: '',
  unitName: '',
})

const faculties = computed(() => data.value?.faculties ?? [])
const organizationalUnits = computed(
  () => data.value?.organizationalUnits ?? [],
)
const advisors = computed(() => data.value?.advisors ?? [])
const manageableFaculties = computed(() =>
  faculties.value.filter(
    faculty => faculty.canCreateClass && faculty.status === 'ACTIVE',
  ),
)
const classCount = computed(() =>
  faculties.value.reduce(
    (total, faculty) => total + faculty.classes.length,
    0,
  ),
)
const unassignedClassCount = computed(() =>
  faculties.value.reduce(
    (total, faculty) => total + faculty.classes.filter(
      academicClass =>
        academicClass.status === 'ACTIVE'
        && !academicClass.currentAdvisor,
    ).length,
    0,
  ),
)

function syncAdvisorDrafts() {
  for (const faculty of faculties.value) {
    for (const academicClass of faculty.classes) {
      advisorDrafts[academicClass.id] =
        academicClass.currentAdvisor?.userId ?? ''
    }
  }
}

async function loadPage() {
  const loaded = await load()
  if (loaded) syncAdvisorDrafts()
}

function clearFeedback() {
  feedback.value = null
}

function showError(error: unknown) {
  const parsed = error as OrganizationApiError
  let message = 'Không thể lưu thay đổi. Vui lòng thử lại.'

  if (parsed.status === 401) {
    message = 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
  } else if (parsed.status === 403) {
    message = 'Bạn không có quyền thay đổi dữ liệu này hoặc dữ liệu nằm ngoài phạm vi được giao.'
  } else if (parsed.status === 404) {
    message = 'Dữ liệu không còn tồn tại. Hãy làm mới trang.'
  } else if (parsed.status === 409 && parsed.field === 'code') {
    message = 'Mã khoa hoặc mã lớp đã được sử dụng.'
  } else if (parsed.status === 409 && parsed.field === 'advisorUserId') {
    message = 'Không thể áp dụng cố vấn đã chọn. Người dùng có thể không còn hoạt động hoặc kỳ phân công bị chồng thời gian.'
  } else if (parsed.status === 409) {
    message = 'Trạng thái dữ liệu hiện tại không cho phép thay đổi này.'
  }

  feedback.value = {
    variant: 'error',
    title: 'Chưa lưu được thay đổi',
    message,
  }
}

function showSuccess(message: string) {
  feedback.value = {
    variant: 'success',
    title: 'Đã cập nhật dữ liệu',
    message,
  }
}

async function runMutation(
  key: string,
  action: () => Promise<unknown>,
  successMessage: string,
) {
  if (busyKey.value) return false

  busyKey.value = key
  clearFeedback()
  try {
    await action()
    await loadPage()
    showSuccess(successMessage)
    return true
  } catch (error: unknown) {
    showError(error)
    return false
  } finally {
    busyKey.value = ''
  }
}

function validateCode(value: string): string {
  return /^[A-Za-z0-9._-]+$/.test(value.trim())
    ? ''
    : 'Chỉ dùng chữ, số, dấu chấm, gạch dưới hoặc gạch ngang.'
}

async function submitFaculty() {
  formErrors.facultyCode = validateCode(facultyForm.code)
  formErrors.facultyName = facultyForm.name.trim().length >= 2
    ? '' : 'Vui lòng nhập tên khoa.'
  if (formErrors.facultyCode || formErrors.facultyName) return

  const saved = await runMutation(
    'create-faculty',
    () => createFaculty({
      code: facultyForm.code.trim().toUpperCase(),
      name: facultyForm.name.trim(),
    }),
    'Khoa mới đã được tạo cùng phạm vi phân quyền tương ứng.',
  )
  if (saved) {
    facultyForm.code = ''
    facultyForm.name = ''
    openForm.value = ''
  }
}

async function submitClass() {
  formErrors.classFacultyId = classForm.facultyId
    ? '' : 'Vui lòng chọn khoa.'
  formErrors.classCode = validateCode(classForm.code)
  formErrors.className = classForm.name.trim().length >= 2
    ? '' : 'Vui lòng nhập tên lớp.'
  if (
    formErrors.classFacultyId
    || formErrors.classCode
    || formErrors.className
  ) return

  const saved = await runMutation(
    'create-class',
    () => createAcademicClass({
      facultyId: classForm.facultyId,
      code: classForm.code.trim().toUpperCase(),
      name: classForm.name.trim(),
    }),
    'Lớp học vụ mới đã được tạo cùng phạm vi phân quyền tương ứng.',
  )
  if (saved) {
    classForm.facultyId = ''
    classForm.code = ''
    classForm.name = ''
    openForm.value = ''
  }
}

async function submitOrganizationalUnit() {
  formErrors.unitCode = validateCode(unitForm.code)
  formErrors.unitName = unitForm.name.trim().length >= 2
    ? '' : 'Vui lòng nhập tên đơn vị.'
  if (formErrors.unitCode || formErrors.unitName) return

  const saved = await runMutation(
    'create-unit',
    () => createOrganizationalUnit({
      code: unitForm.code.trim().toUpperCase(),
      name: unitForm.name.trim(),
    }),
    'Đơn vị hành chính mới đã được tạo cùng phạm vi phân quyền tương ứng.',
  )
  if (saved) {
    unitForm.code = ''
    unitForm.name = ''
    openForm.value = ''
  }
}

function startFacultyEdit(faculty: ManagedFaculty) {
  editingFacultyId.value = faculty.id
  editingClassId.value = ''
  facultyEditForm.code = faculty.code
  facultyEditForm.name = faculty.name
  clearFeedback()
}

async function saveFaculty(faculty: ManagedFaculty) {
  if (
    validateCode(facultyEditForm.code)
    || facultyEditForm.name.trim().length < 2
  ) {
    showError({ message: 'Dữ liệu khoa không hợp lệ.' })
    return
  }

  const saved = await runMutation(
    `faculty-edit-${faculty.id}`,
    () => updateFaculty(faculty.id, {
      code: facultyEditForm.code.trim().toUpperCase(),
      name: facultyEditForm.name.trim(),
    }),
    `Đã cập nhật khoa ${faculty.code}.`,
  )
  if (saved) editingFacultyId.value = ''
}

function startClassEdit(academicClass: ManagedAcademicClass) {
  editingClassId.value = academicClass.id
  editingFacultyId.value = ''
  classEditForm.code = academicClass.code
  classEditForm.name = academicClass.name
  clearFeedback()
}

function startUnitEdit(unit: ManagedOrganizationalUnit) {
  editingUnitId.value = unit.id
  editingFacultyId.value = ''
  editingClassId.value = ''
  unitEditForm.code = unit.code
  unitEditForm.name = unit.name
  clearFeedback()
}

async function saveUnit(unit: ManagedOrganizationalUnit) {
  if (
    validateCode(unitEditForm.code)
    || unitEditForm.name.trim().length < 2
  ) {
    showError({ message: 'Dữ liệu đơn vị hành chính không hợp lệ.' })
    return
  }

  const saved = await runMutation(
    `unit-edit-${unit.id}`,
    () => updateOrganizationalUnit(unit.id, {
      code: unitEditForm.code.trim().toUpperCase(),
      name: unitEditForm.name.trim(),
    }),
    `Đã cập nhật đơn vị ${unit.code}.`,
  )
  if (saved) editingUnitId.value = ''
}

async function saveClass(academicClass: ManagedAcademicClass) {
  if (
    validateCode(classEditForm.code)
    || classEditForm.name.trim().length < 2
  ) {
    showError({ message: 'Dữ liệu lớp không hợp lệ.' })
    return
  }

  const saved = await runMutation(
    `class-edit-${academicClass.id}`,
    () => updateAcademicClass(academicClass.id, {
      code: classEditForm.code.trim().toUpperCase(),
      name: classEditForm.name.trim(),
    }),
    `Đã cập nhật lớp ${academicClass.code}.`,
  )
  if (saved) editingClassId.value = ''
}

async function toggleFacultyStatus(faculty: ManagedFaculty) {
  const nextStatus = faculty.status === 'ACTIVE'
    ? 'INACTIVE' as const : 'ACTIVE' as const
  const saved = await runMutation(
    `faculty-status-${faculty.id}`,
    () => updateFaculty(faculty.id, { status: nextStatus }),
    nextStatus === 'ACTIVE'
      ? `Đã kích hoạt lại khoa ${faculty.code}.`
      : `Đã ngừng hoạt động khoa ${faculty.code}.`,
  )
  if (saved) pendingStatusKey.value = ''
}

async function toggleClassStatus(academicClass: ManagedAcademicClass) {
  const nextStatus = academicClass.status === 'ACTIVE'
    ? 'INACTIVE' as const : 'ACTIVE' as const
  const saved = await runMutation(
    `class-status-${academicClass.id}`,
    () => updateAcademicClass(academicClass.id, { status: nextStatus }),
    nextStatus === 'ACTIVE'
      ? `Đã kích hoạt lại lớp ${academicClass.code}.`
      : `Đã ngừng hoạt động lớp ${academicClass.code}.`,
  )
  if (saved) pendingStatusKey.value = ''
}

async function toggleUnitStatus(unit: ManagedOrganizationalUnit) {
  const nextStatus = unit.status === 'ACTIVE'
    ? 'INACTIVE' as const : 'ACTIVE' as const
  const saved = await runMutation(
    `unit-status-${unit.id}`,
    () => updateOrganizationalUnit(unit.id, { status: nextStatus }),
    nextStatus === 'ACTIVE'
      ? `Đã kích hoạt lại đơn vị ${unit.code}.`
      : `Đã ngừng hoạt động đơn vị ${unit.code}.`,
  )
  if (saved) pendingStatusKey.value = ''
}

async function saveAdvisor(academicClass: ManagedAcademicClass) {
  const advisorUserId = advisorDrafts[academicClass.id] || null
  await runMutation(
    `advisor-${academicClass.id}`,
    () => setAcademicAdvisor(academicClass.id, advisorUserId),
    advisorUserId
      ? `Đã cập nhật cố vấn cho lớp ${academicClass.code}.`
      : `Đã kết thúc phân công cố vấn của lớp ${academicClass.code}.`,
  )
}

function openCreateClassForm() {
  openForm.value = openForm.value === 'class' ? '' : 'class'
  if (!classForm.facultyId) {
    classForm.facultyId = manageableFaculties.value[0]?.id ?? ''
  }
  clearFeedback()
}

onMounted(() => {
  void loadPage()
})
</script>

<template>
  <section class="organization-page">
    <header class="organization-page__header">
      <div>
        <p class="page-eyebrow">Cơ cấu tổ chức</p>
        <h1 class="page-title">Quản lý cơ cấu và cố vấn</h1>
        <p class="page-description">
          Duy trì khoa, lớp, đơn vị hành chính và người chịu trách nhiệm xác nhận hồ sơ.
        </p>
      </div>
      <div class="organization-page__header-actions">
        <BaseButton
          v-if="data?.capabilities.canCreateFaculty"
          type="button"
          variant="secondary"
          :disabled="Boolean(busyKey)"
          @click="openForm = openForm === 'faculty' ? '' : 'faculty'; clearFeedback()"
        >
          ＋ Thêm khoa
        </BaseButton>
        <BaseButton
          v-if="data?.capabilities.canCreateOrganizationalUnit"
          type="button"
          variant="secondary"
          :disabled="Boolean(busyKey)"
          @click="openForm = openForm === 'unit' ? '' : 'unit'; clearFeedback()"
        >
          ＋ Thêm đơn vị
        </BaseButton>
        <BaseButton
          v-if="manageableFaculties.length"
          type="button"
          :disabled="Boolean(busyKey)"
          @click="openCreateClassForm"
        >
          ＋ Thêm lớp
        </BaseButton>
      </div>
    </header>

    <div v-if="data" class="organization-page__metrics">
      <article>
        <span>Khoa hiển thị</span>
        <strong>{{ faculties.length }}</strong>
      </article>
      <article>
        <span>Lớp học vụ</span>
        <strong>{{ classCount }}</strong>
      </article>
      <article :class="{ 'organization-page__metric--warning': unassignedClassCount }">
        <span>Lớp chưa có cố vấn</span>
        <strong>{{ unassignedClassCount }}</strong>
      </article>
      <article>
        <span>Đơn vị hành chính</span>
        <strong>{{ organizationalUnits.length }}</strong>
      </article>
      <article>
        <span>Cố vấn sẵn sàng</span>
        <strong>{{ advisors.length }}</strong>
      </article>
    </div>

    <BaseAlert
      v-if="feedback"
      :variant="feedback.variant"
      :title="feedback.title"
    >
      {{ feedback.message }}
      <NuxtLink
        v-if="feedback.message.includes('hết hạn')"
        class="organization-page__login-link"
        to="/admin/login"
      >
        Đăng nhập lại
      </NuxtLink>
    </BaseAlert>

    <form
      v-if="openForm === 'unit'"
      class="organization-page__create-form surface-card"
      @submit.prevent="submitOrganizationalUnit"
    >
      <div class="organization-page__form-heading">
        <div>
          <h2>Thêm đơn vị hành chính</h2>
          <p>Hệ thống tự tạo phạm vi đơn vị để gán cho cán bộ phụ trách.</p>
        </div>
        <button type="button" aria-label="Đóng biểu mẫu" @click="openForm = ''">×</button>
      </div>
      <BaseInput
        id="unit-code"
        v-model="unitForm.code"
        label="Mã đơn vị"
        placeholder="Ví dụ: PCTSV"
        maxlength="50"
        :disabled="Boolean(busyKey)"
        :error="formErrors.unitCode"
        @update:model-value="formErrors.unitCode = ''"
      />
      <BaseInput
        id="unit-name"
        v-model="unitForm.name"
        label="Tên đơn vị"
        placeholder="Ví dụ: Phòng Công tác sinh viên"
        maxlength="255"
        :disabled="Boolean(busyKey)"
        :error="formErrors.unitName"
        @update:model-value="formErrors.unitName = ''"
      />
      <BaseButton type="submit" :loading="busyKey === 'create-unit'">
        Tạo đơn vị
      </BaseButton>
    </form>

    <form
      v-if="openForm === 'faculty'"
      class="organization-page__create-form surface-card"
      @submit.prevent="submitFaculty"
    >
      <div class="organization-page__form-heading">
        <div>
          <h2>Thêm khoa mới</h2>
          <p>Hệ thống tự tạo phạm vi khoa để có thể phân quyền sau này.</p>
        </div>
        <button type="button" aria-label="Đóng biểu mẫu" @click="openForm = ''">×</button>
      </div>
      <BaseInput
        id="faculty-code"
        v-model="facultyForm.code"
        label="Mã khoa"
        placeholder="Ví dụ: QLGD"
        maxlength="50"
        :disabled="Boolean(busyKey)"
        :error="formErrors.facultyCode"
        @update:model-value="formErrors.facultyCode = ''"
      />
      <BaseInput
        id="faculty-name"
        v-model="facultyForm.name"
        label="Tên khoa"
        placeholder="Ví dụ: Khoa Quản lý giáo dục"
        maxlength="255"
        :disabled="Boolean(busyKey)"
        :error="formErrors.facultyName"
        @update:model-value="formErrors.facultyName = ''"
      />
      <BaseButton type="submit" :loading="busyKey === 'create-faculty'">
        Tạo khoa
      </BaseButton>
    </form>

    <form
      v-if="openForm === 'class'"
      class="organization-page__create-form surface-card"
      @submit.prevent="submitClass"
    >
      <div class="organization-page__form-heading">
        <div>
          <h2>Thêm lớp học vụ</h2>
          <p>Chỉ các khoa trong phạm vi được giao mới xuất hiện.</p>
        </div>
        <button type="button" aria-label="Đóng biểu mẫu" @click="openForm = ''">×</button>
      </div>
      <BaseSelect
        id="class-faculty"
        v-model="classForm.facultyId"
        label="Khoa trực thuộc"
        :disabled="Boolean(busyKey)"
        :error="formErrors.classFacultyId"
        @update:model-value="formErrors.classFacultyId = ''"
      >
        <option value="">Chọn khoa</option>
        <option
          v-for="faculty in manageableFaculties"
          :key="faculty.id"
          :value="faculty.id"
        >
          {{ faculty.code }} · {{ faculty.name }}
        </option>
      </BaseSelect>
      <BaseInput
        id="class-code"
        v-model="classForm.code"
        label="Mã lớp"
        placeholder="Ví dụ: QLGD-K17A"
        maxlength="50"
        :disabled="Boolean(busyKey)"
        :error="formErrors.classCode"
        @update:model-value="formErrors.classCode = ''"
      />
      <BaseInput
        id="class-name"
        v-model="classForm.name"
        label="Tên lớp"
        placeholder="Ví dụ: Quản lý giáo dục K17A"
        maxlength="255"
        :disabled="Boolean(busyKey)"
        :error="formErrors.className"
        @update:model-value="formErrors.className = ''"
      />
      <BaseButton type="submit" :loading="busyKey === 'create-class'">
        Tạo lớp
      </BaseButton>
    </form>

    <div v-if="isLoading" class="organization-page__loading" role="status">
      <img src="/images/naem-logo.jpg" alt="">
      <div>
        <strong>Đang tải cơ cấu học vụ</strong>
        <span>Hệ thống đang áp dụng quyền và phạm vi dữ liệu…</span>
      </div>
    </div>

    <BaseAlert
      v-else-if="errorMessage"
      variant="error"
      title="Không thể hiển thị cơ cấu"
    >
      {{ errorMessage }}
      <div class="organization-page__error-actions">
        <BaseButton type="button" variant="secondary" @click="loadPage">
          Thử lại
        </BaseButton>
        <NuxtLink v-if="errorMessage.includes('hết hạn')" to="/admin/login">
          Đăng nhập lại
        </NuxtLink>
      </div>
    </BaseAlert>

    <div
      v-else-if="hasLoaded && faculties.length === 0 && organizationalUnits.length === 0"
      class="organization-page__empty surface-card"
    >
      <span aria-hidden="true">⌂</span>
      <h2>Chưa có dữ liệu trong phạm vi của bạn</h2>
      <p>Hãy kiểm tra quyền quản lý cơ cấu và phạm vi dữ liệu được gán.</p>
    </div>

    <section v-if="data && organizationalUnits.length" class="organization-page__unit-section">
      <div class="organization-page__section-heading">
        <div>
          <p class="page-eyebrow">Khối hành chính</p>
          <h2>Đơn vị hành chính</h2>
        </div>
        <span>{{ organizationalUnits.length }} đơn vị trong phạm vi</span>
      </div>
      <div class="organization-page__unit-grid">
        <article
          v-for="unit in organizationalUnits"
          :key="unit.id"
          class="organization-page__unit-card surface-card"
        >
          <div class="organization-page__unit-icon" aria-hidden="true">
            {{ unit.code.slice(0, 3) }}
          </div>
          <div class="organization-page__unit-content">
            <template v-if="editingUnitId !== unit.id">
              <div class="organization-page__title-line">
                <h3>{{ unit.name }}</h3>
                <span :class="`status status--${unit.status.toLowerCase()}`">
                  {{ unit.status === 'ACTIVE' ? 'Đang hoạt động' : 'Ngừng hoạt động' }}
                </span>
              </div>
              <p>{{ unit.code }}</p>
            </template>
            <div v-else class="organization-page__inline-edit organization-page__inline-edit--unit">
              <input v-model="unitEditForm.code" maxlength="50" aria-label="Mã đơn vị">
              <input v-model="unitEditForm.name" maxlength="255" aria-label="Tên đơn vị">
              <div>
                <button type="button" :disabled="Boolean(busyKey)" @click="saveUnit(unit)">Lưu</button>
                <button type="button" :disabled="Boolean(busyKey)" @click="editingUnitId = ''">Hủy</button>
              </div>
            </div>
          </div>
          <div v-if="unit.canManage && editingUnitId !== unit.id" class="organization-page__row-actions">
            <button type="button" :disabled="Boolean(busyKey)" @click="startUnitEdit(unit)">Chỉnh sửa</button>
            <template v-if="pendingStatusKey === `unit-${unit.id}`">
              <button type="button" class="confirm" :disabled="Boolean(busyKey)" @click="toggleUnitStatus(unit)">Xác nhận</button>
              <button type="button" :disabled="Boolean(busyKey)" @click="pendingStatusKey = ''">Hủy</button>
            </template>
            <button v-else type="button" :disabled="Boolean(busyKey)" @click="pendingStatusKey = `unit-${unit.id}`">
              {{ unit.status === 'ACTIVE' ? 'Ngừng' : 'Kích hoạt' }}
            </button>
          </div>
        </article>
      </div>
    </section>

    <div v-if="data && faculties.length" class="organization-page__faculty-list">
      <article
        v-for="faculty in faculties"
        :key="faculty.id"
        class="organization-page__faculty surface-card"
      >
        <header class="organization-page__faculty-header">
          <div class="organization-page__faculty-identity">
            <span aria-hidden="true">{{ faculty.code.slice(0, 3) }}</span>
            <div v-if="editingFacultyId !== faculty.id">
              <div class="organization-page__title-line">
                <h2>{{ faculty.name }}</h2>
                <span :class="`status status--${faculty.status.toLowerCase()}`">
                  {{ faculty.status === 'ACTIVE' ? 'Đang hoạt động' : 'Ngừng hoạt động' }}
                </span>
              </div>
              <p>{{ faculty.code }} · {{ faculty.classes.length }} lớp</p>
            </div>
            <div v-else class="organization-page__inline-edit">
              <input v-model="facultyEditForm.code" maxlength="50" aria-label="Mã khoa">
              <input v-model="facultyEditForm.name" maxlength="255" aria-label="Tên khoa">
              <div>
                <button type="button" :disabled="Boolean(busyKey)" @click="saveFaculty(faculty)">Lưu</button>
                <button type="button" :disabled="Boolean(busyKey)" @click="editingFacultyId = ''">Hủy</button>
              </div>
            </div>
          </div>
          <div v-if="faculty.canManage && editingFacultyId !== faculty.id" class="organization-page__row-actions">
            <button type="button" :disabled="Boolean(busyKey)" @click="startFacultyEdit(faculty)">Chỉnh sửa</button>
            <template v-if="pendingStatusKey === `faculty-${faculty.id}`">
              <span>Xác nhận</span>
              <button type="button" class="confirm" :disabled="Boolean(busyKey)" @click="toggleFacultyStatus(faculty)">Xác nhận</button>
              <button type="button" :disabled="Boolean(busyKey)" @click="pendingStatusKey = ''">Hủy</button>
            </template>
            <button v-else type="button" :disabled="Boolean(busyKey)" @click="pendingStatusKey = `faculty-${faculty.id}`">
              {{ faculty.status === 'ACTIVE' ? 'Ngừng hoạt động' : 'Kích hoạt' }}
            </button>
          </div>
        </header>

        <div v-if="faculty.classes.length" class="organization-page__class-table">
          <table>
            <thead>
              <tr>
                <th>Lớp học vụ</th>
                <th>Cố vấn hiện tại</th>
                <th>Phân công cố vấn</th>
                <th>Trạng thái</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="academicClass in faculty.classes" :key="academicClass.id">
                <td>
                  <template v-if="editingClassId !== academicClass.id">
                    <strong>{{ academicClass.code }}</strong>
                    <small>{{ academicClass.name }}</small>
                  </template>
                  <div v-else class="organization-page__inline-edit organization-page__inline-edit--class">
                    <input v-model="classEditForm.code" maxlength="50" aria-label="Mã lớp">
                    <input v-model="classEditForm.name" maxlength="255" aria-label="Tên lớp">
                    <div>
                      <button type="button" :disabled="Boolean(busyKey)" @click="saveClass(academicClass)">Lưu</button>
                      <button type="button" :disabled="Boolean(busyKey)" @click="editingClassId = ''">Hủy</button>
                    </div>
                  </div>
                </td>
                <td>
                  <template v-if="academicClass.currentAdvisor">
                    <strong>{{ academicClass.currentAdvisor.fullName }}</strong>
                    <small>{{ academicClass.currentAdvisor.email || academicClass.currentAdvisor.username }}</small>
                  </template>
                  <span v-else class="organization-page__unassigned">Chưa phân công</span>
                </td>
                <td>
                  <div class="organization-page__advisor-control">
                    <select
                      v-model="advisorDrafts[academicClass.id]"
                      :disabled="!academicClass.canManage || academicClass.status !== 'ACTIVE' || Boolean(busyKey)"
                      :aria-label="`Chọn cố vấn cho lớp ${academicClass.code}`"
                    >
                      <option value="">Chưa phân công</option>
                      <option v-for="advisor in advisors" :key="advisor.userId" :value="advisor.userId">
                        {{ advisor.fullName }} · {{ advisor.username }}
                      </option>
                    </select>
                    <button
                      type="button"
                      :disabled="!academicClass.canManage || academicClass.status !== 'ACTIVE' || Boolean(busyKey) || advisorDrafts[academicClass.id] === (academicClass.currentAdvisor?.userId ?? '')"
                      @click="saveAdvisor(academicClass)"
                    >
                      {{ busyKey === `advisor-${academicClass.id}` ? 'Đang lưu…' : 'Áp dụng' }}
                    </button>
                  </div>
                </td>
                <td>
                  <span :class="`status status--${academicClass.status.toLowerCase()}`">
                    {{ academicClass.status === 'ACTIVE' ? 'Hoạt động' : 'Ngừng' }}
                  </span>
                </td>
                <td>
                  <div v-if="academicClass.canManage && editingClassId !== academicClass.id" class="organization-page__row-actions organization-page__row-actions--class">
                    <button type="button" :disabled="Boolean(busyKey)" @click="startClassEdit(academicClass)">Sửa</button>
                    <template v-if="pendingStatusKey === `class-${academicClass.id}`">
                      <button type="button" class="confirm" :disabled="Boolean(busyKey)" @click="toggleClassStatus(academicClass)">Xác nhận</button>
                      <button type="button" :disabled="Boolean(busyKey)" @click="pendingStatusKey = ''">Hủy</button>
                    </template>
                    <button v-else type="button" :disabled="Boolean(busyKey)" @click="pendingStatusKey = `class-${academicClass.id}`">
                      {{ academicClass.status === 'ACTIVE' ? 'Ngừng' : 'Kích hoạt' }}
                    </button>
                  </div>
                  <span v-else-if="!academicClass.canManage" class="organization-page__read-only">Chỉ xem</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="organization-page__no-classes">
          Khoa này chưa có lớp học vụ.
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.organization-page { display: grid; gap: 24px; }
.organization-page__header { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; }
.organization-page__header > div:first-child { max-width: 720px; }
.organization-page__header-actions { display: flex; flex: 0 0 auto; gap: 9px; }
.organization-page__metrics { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; }
.organization-page__metrics article { display: grid; gap: 5px; padding: 16px 18px; border: 1px solid var(--color-border); border-radius: 15px; background: var(--color-surface); box-shadow: 0 4px 18px rgb(15 23 42 / 4%); }
.organization-page__metrics span { color: var(--color-muted); font-size: 12px; font-weight: 700; }
.organization-page__metrics strong { color: var(--color-primary-dark); font-size: 25px; }
.organization-page__metric--warning { border-color: #f4d7a1 !important; background: #fffaf0 !important; }
.organization-page__metric--warning strong { color: #9a5b08; }
.organization-page__login-link { display: inline-block; margin-left: 8px; color: currentcolor; font-weight: 800; }
.organization-page__create-form { display: grid; grid-template-columns: minmax(150px, .45fr) minmax(260px, 1fr) auto; align-items: end; gap: 14px; padding: 20px; border-radius: 18px; }
.organization-page__form-heading { display: flex; grid-column: 1 / -1; align-items: flex-start; justify-content: space-between; gap: 20px; padding-bottom: 13px; border-bottom: 1px solid var(--color-border); }
.organization-page__form-heading h2 { margin: 0 0 3px; font-size: 18px; }
.organization-page__form-heading p { margin: 0; color: var(--color-muted); font-size: 13px; }
.organization-page__form-heading > button { width: 34px; height: 34px; border: 1px solid var(--color-border); border-radius: 9px; color: var(--color-muted); background: #fff; cursor: pointer; font-size: 20px; }
.organization-page__loading { display: flex; min-height: 260px; align-items: center; justify-content: center; gap: 18px; border: 1px solid var(--color-border); border-radius: 18px; background: var(--color-surface); }
.organization-page__loading img { width: 58px; height: 58px; border-radius: 13px; object-fit: cover; box-shadow: 0 8px 24px rgb(11 31 64 / 15%); animation: organization-pulse 1.4s ease-in-out infinite; }
.organization-page__loading div { display: grid; gap: 4px; }
.organization-page__loading span { color: var(--color-muted); font-size: 13px; }
.organization-page__error-actions { display: flex; align-items: center; gap: 14px; margin-top: 10px; }
.organization-page__error-actions a { color: var(--color-primary); font-weight: 750; }
.organization-page__empty { display: grid; min-height: 280px; place-items: center; align-content: center; gap: 8px; padding: 30px; text-align: center; }
.organization-page__empty > span { display: grid; width: 58px; height: 58px; place-items: center; border-radius: 17px; color: var(--color-primary); background: var(--color-primary-soft); font-size: 24px; }
.organization-page__empty h2 { margin: 4px 0 0; font-size: 19px; }
.organization-page__empty p { margin: 0; color: var(--color-muted); }
.organization-page__unit-section { display: grid; gap: 12px; }
.organization-page__section-heading { display: flex; align-items: end; justify-content: space-between; gap: 16px; }
.organization-page__section-heading h2 { margin: 2px 0 0; font-size: 20px; }
.organization-page__section-heading > span { color: var(--color-muted); font-size: 12px; }
.organization-page__unit-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.organization-page__unit-card { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 13px; padding: 17px; border-radius: 16px; }
.organization-page__unit-icon { display: grid; width: 45px; height: 45px; place-items: center; border-radius: 13px; color: #fff; background: linear-gradient(145deg, #694f14, #b58a24); font-size: 11px; font-weight: 850; text-transform: uppercase; }
.organization-page__unit-content { min-width: 0; }
.organization-page__unit-content h3 { margin: 0; overflow: hidden; font-size: 15px; text-overflow: ellipsis; white-space: nowrap; }
.organization-page__unit-content p { margin: 5px 0 0; color: var(--color-muted); font-size: 11px; font-weight: 750; }
.organization-page__inline-edit--unit { grid-template-columns: 100px minmax(170px, 1fr); }
.organization-page__inline-edit--unit > div { grid-column: 1 / -1; }
.organization-page__faculty-list { display: grid; gap: 16px; }
.organization-page__faculty { overflow: hidden; border-radius: 18px; }
.organization-page__faculty-header { display: flex; min-height: 92px; align-items: center; justify-content: space-between; gap: 20px; padding: 18px 20px; border-bottom: 1px solid var(--color-border); background: linear-gradient(100deg, #f7fbff, #fff); }
.organization-page__faculty-identity { display: flex; min-width: 0; align-items: center; gap: 13px; }
.organization-page__faculty-identity > span { display: grid; width: 46px; height: 46px; flex: 0 0 auto; place-items: center; border-radius: 13px; color: #fff; background: linear-gradient(145deg, var(--color-primary-dark), #2e70aa); font-size: 11px; font-weight: 850; text-transform: uppercase; }
.organization-page__title-line { display: flex; align-items: center; gap: 10px; }
.organization-page__title-line h2 { margin: 0; font-size: 18px; }
.organization-page__faculty-identity p { margin: 4px 0 0; color: var(--color-muted); font-size: 12px; }
.status { display: inline-flex; padding: 4px 8px; border-radius: 999px; font-size: 10px; font-weight: 800; white-space: nowrap; }
.status--active { color: var(--color-success); background: var(--color-success-background); }
.status--inactive { color: var(--color-muted); background: #edf1f5; }
.organization-page__row-actions { display: flex; align-items: center; justify-content: flex-end; gap: 6px; }
.organization-page__row-actions > span { color: var(--color-error); font-size: 11px; font-weight: 750; }
.organization-page__row-actions button { min-height: 34px; padding: 6px 9px; border: 1px solid var(--color-border); border-radius: 8px; color: var(--color-primary-dark); background: #fff; cursor: pointer; font-size: 11px; font-weight: 750; }
.organization-page__row-actions button:hover:not(:disabled) { border-color: #b9d6ff; background: var(--color-primary-soft); }
.organization-page__row-actions button.confirm { border-color: #f2b8b5; color: #a5231c; background: #fff5f4; }
.organization-page__row-actions button:disabled { cursor: wait; opacity: .55; }
.organization-page__row-actions--class { flex-wrap: wrap; }
.organization-page__inline-edit { display: grid; grid-template-columns: 130px minmax(230px, 1fr) auto; align-items: center; gap: 7px; }
.organization-page__inline-edit--class { grid-template-columns: 110px 180px; }
.organization-page__inline-edit--class > div { grid-column: 1 / -1; }
.organization-page__inline-edit input { min-height: 36px; padding: 7px 9px; border: 1px solid var(--color-border); border-radius: 8px; }
.organization-page__inline-edit input:focus { border-color: var(--color-primary); outline: 0; box-shadow: 0 0 0 3px rgb(21 94 239 / 10%); }
.organization-page__inline-edit > div { display: flex; gap: 5px; }
.organization-page__inline-edit button { min-height: 32px; padding: 5px 8px; border: 1px solid var(--color-border); border-radius: 7px; background: #fff; cursor: pointer; font-size: 11px; font-weight: 750; }
.organization-page__class-table { overflow-x: auto; }
.organization-page table { width: 100%; min-width: 940px; border-collapse: collapse; font-size: 12px; }
.organization-page th { padding: 11px 14px; border-bottom: 1px solid var(--color-border); color: var(--color-muted); background: #f8fafc; font-size: 10px; letter-spacing: .045em; text-align: left; text-transform: uppercase; }
.organization-page td { padding: 14px; border-bottom: 1px solid var(--color-border); vertical-align: middle; }
.organization-page tbody tr:last-child td { border-bottom: 0; }
.organization-page tbody tr:hover { background: #fbfdff; }
.organization-page td > strong,
.organization-page td > small { display: block; }
.organization-page td > small { max-width: 220px; margin-top: 3px; overflow: hidden; color: var(--color-muted); text-overflow: ellipsis; white-space: nowrap; }
.organization-page__advisor-control { display: flex; min-width: 300px; gap: 6px; }
.organization-page__advisor-control select { width: 100%; min-height: 38px; padding: 7px 30px 7px 9px; border: 1px solid var(--color-border); border-radius: 9px; color: var(--color-text); background: #fff; }
.organization-page__advisor-control button { min-height: 38px; padding: 7px 10px; border: 1px solid #b9d6ff; border-radius: 9px; color: var(--color-primary-dark); background: var(--color-primary-soft); cursor: pointer; font-size: 11px; font-weight: 800; white-space: nowrap; }
.organization-page__advisor-control button:disabled,
.organization-page__advisor-control select:disabled { cursor: not-allowed; opacity: .55; }
.organization-page__unassigned { display: inline-flex; padding: 5px 8px; border-radius: 8px; color: #9a5b08; background: #fff4d6; font-size: 11px; font-weight: 750; }
.organization-page__read-only { color: var(--color-subtle); font-size: 11px; }
.organization-page__no-classes { padding: 24px 20px; color: var(--color-muted); text-align: center; }
@keyframes organization-pulse { 50% { transform: scale(.95); opacity: .7; } }
@media (max-width: 1050px) {
  .organization-page__metrics { grid-template-columns: repeat(2, 1fr); }
  .organization-page__create-form { grid-template-columns: 1fr 1fr; }
  .organization-page__create-form > :last-child { justify-self: start; }
  .organization-page__unit-grid { grid-template-columns: 1fr; }
}
@media (max-width: 700px) {
  .organization-page__header { align-items: stretch; flex-direction: column; }
  .organization-page__header-actions { flex-wrap: wrap; }
  .organization-page__metrics { grid-template-columns: 1fr 1fr; }
  .organization-page__create-form { grid-template-columns: 1fr; padding: 17px; }
  .organization-page__form-heading { grid-column: auto; }
  .organization-page__faculty-header { align-items: flex-start; flex-direction: column; }
  .organization-page__row-actions { justify-content: flex-start; }
  .organization-page__inline-edit { grid-template-columns: 1fr; }
  .organization-page__inline-edit--class > div { grid-column: auto; }
  .organization-page__inline-edit--unit { grid-template-columns: 1fr; }
  .organization-page__inline-edit--unit > div { grid-column: auto; }
  .organization-page__unit-card { grid-template-columns: auto minmax(0, 1fr); }
  .organization-page__unit-card > .organization-page__row-actions { grid-column: 1 / -1; }
}
</style>
