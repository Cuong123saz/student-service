import type {
  CurrentAdvisorView,
  StudentProfileRepository,
  StudentProfileView,
} from './student-profile.repository.js'

export class StudentProfileNotFoundError
extends Error {
  constructor() {
    super('Student profile not found')
    this.name = 'StudentProfileNotFoundError'
  }
}

export interface StudentProfileUseCase {
  getProfile(
    userId: string,
  ): Promise<StudentProfileView>

  getCurrentAdvisor(
    userId: string,
  ): Promise<CurrentAdvisorView | null>
}

export class StudentProfileService
implements StudentProfileUseCase {
  constructor(
    private readonly repository:
      StudentProfileRepository,
    private readonly now: () => Date =
      () => new Date(),
  ) {}

  async getProfile(
    userId: string,
  ): Promise<StudentProfileView> {
    const profile = await this.repository
      .findStudentProfileByUserId(userId)

    if (!profile) {
      throw new StudentProfileNotFoundError()
    }

    return profile
  }

  async getCurrentAdvisor(
    userId: string,
  ): Promise<CurrentAdvisorView | null> {
    const profile = await this.repository
      .findStudentProfileByUserId(userId)

    if (!profile) {
      throw new StudentProfileNotFoundError()
    }

    const advisor = await this.repository
      .findCurrentAdvisorForStudentUserId(
        userId,
        this.now(),
      )

    return advisor
  }
}
