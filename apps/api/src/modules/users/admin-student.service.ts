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

export interface AdminStudentRepository {
  listVisibleTo(
    input: ListVisibleStudentsInput,
  ): Promise<StudentDirectoryPage>
}

export interface AdminStudentUseCase {
  listVisibleStudents(
    input: ListVisibleStudentsInput,
  ): Promise<StudentDirectoryPage>
}

export class AdminStudentService
implements AdminStudentUseCase {
  constructor(
    private readonly repository:
      AdminStudentRepository,
  ) {}

  listVisibleStudents(
    input: ListVisibleStudentsInput,
  ): Promise<StudentDirectoryPage> {
    return this.repository
      .listVisibleTo(input)
  }
}
