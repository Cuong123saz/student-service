export interface ListVisibleStudentsInput {
  actorUserId: string
  limit: number
  afterStudentCode?: string
  status?: string
  facultyId?: string
  classId?: string
  search?: string
}

export interface StudentDirectoryItem {
  userId: string
  username: string
  fullName: string
  email: string | null
  status: string
  studentCode: string
  academicClass: {
    id: string
    code: string
    name: string
  }
  faculty: {
    id: string
    code: string
    name: string
  }
}

export interface StudentDirectoryPage {
  students: StudentDirectoryItem[]
  nextCursor: string | null
}

export interface StudentUpdateAuditContext {
  requestId: string | null
  ipAddress: string | null
  userAgent: string | null
}

export interface UpdateStudentInput {
  actorUserId: string
  actorUsername: string
  userId: string
  studentCode: string
  fullName: string
  facultyId: string
  classId: string
  audit: StudentUpdateAuditContext
  changedAt: Date
}

export class InvalidStudentUpdateError extends Error {
  constructor(
    readonly field: 'studentCode' | 'fullName',
    message: string,
  ) {
    super(message)
    this.name = 'InvalidStudentUpdateError'
  }
}

export interface AdminStudentRepository {
  listVisibleTo(input: ListVisibleStudentsInput): Promise<StudentDirectoryPage>

  updateStudent(input: UpdateStudentInput): Promise<void>
}

export interface AdminStudentUseCase {
  listVisibleStudents(input: ListVisibleStudentsInput): Promise<StudentDirectoryPage>

  updateStudent(input: Omit<UpdateStudentInput, 'changedAt'>): Promise<void>
}

export class AdminStudentService implements AdminStudentUseCase {
  constructor(
    private readonly repository: AdminStudentRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  listVisibleStudents(input: ListVisibleStudentsInput): Promise<StudentDirectoryPage> {
    return this.repository.listVisibleTo(input)
  }

  updateStudent(input: Omit<UpdateStudentInput, 'changedAt'>): Promise<void> {
    const studentCode = input.studentCode.trim()
    const fullName = input.fullName.trim().replace(/\s+/g, ' ')

    if (!/^\d{1,50}$/.test(studentCode)) {
      throw new InvalidStudentUpdateError('studentCode', 'Mã sinh viên chỉ được chứa chữ số')
    }

    if (fullName.length < 2 || fullName.length > 255) {
      throw new InvalidStudentUpdateError('fullName', 'Tên sinh viên phải có từ 2 đến 255 ký tự')
    }

    return this.repository.updateStudent({
      ...input,
      studentCode,
      fullName,
      changedAt: this.clock(),
    })
  }
}
