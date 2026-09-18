import assert from 'node:assert/strict'
import { test } from 'node:test'

import type {
  CurrentAdvisorView,
  StudentProfileRepository,
  StudentProfileView,
} from './student-profile.repository.js'
import { StudentProfileNotFoundError, StudentProfileService } from './student-profile.service.js'

const userId = '85ca4291-c7bd-4370-a117-976bf237261c'

const profile: StudentProfileView = {
  userId,
  username: 'student001',
  fullName: 'Nguyễn Văn A',
  email: 'student001@example.edu.vn',
  studentCode: 'SV001',
  class: {
    id: '505da565-8e6a-4de6-80b6-69024c46654a',
    code: 'QLGD-K15A',
    name: 'Quản lý giáo dục K15A',
  },
  faculty: {
    id: '66b599ca-c87e-4a19-8de8-b81348e65ba6',
    code: 'QLGD',
    name: 'Khoa Quản lý giáo dục',
  },
}

const now = new Date('2026-09-05T00:00:00.000Z')

const advisor: CurrentAdvisorView = {
  userId: 'd960e04b-7f2d-4dc5-a622-40babcc56b7b',
  username: 'advisor001',
  fullName: 'Giảng viên Cố vấn',
  email: 'advisor001@example.edu.vn',
  class: profile.class,
  validFrom: new Date('2026-01-01T00:00:00.000Z'),
  validTo: null,
}

class FakeStudentProfileRepository implements StudentProfileRepository {
  receivedAdvisorLookup: { userId: string; now: Date } | undefined

  constructor(
    private readonly storedProfile: StudentProfileView | null,
    private readonly storedAdvisor: CurrentAdvisorView | null,
  ) {}

  async findStudentProfileByUserId() {
    return this.storedProfile
  }

  async findCurrentAdvisorForStudentUserId(receivedUserId: string, receivedNow: Date) {
    this.receivedAdvisorLookup = {
      userId: receivedUserId,
      now: receivedNow,
    }

    return this.storedAdvisor
  }
}

test('trả hồ sơ sinh viên khi tồn tại', async () => {
  const service = new StudentProfileService(new FakeStudentProfileRepository(profile, advisor))

  assert.deepEqual(await service.getProfile(userId), profile)
})

test('báo lỗi khi sinh viên chưa có hồ sơ học vụ', async () => {
  const service = new StudentProfileService(new FakeStudentProfileRepository(null, advisor))

  await assert.rejects(service.getProfile(userId), StudentProfileNotFoundError)
})

test('tìm cố vấn hiện tại tại đúng thời điểm nghiệp vụ', async () => {
  const repository = new FakeStudentProfileRepository(profile, advisor)
  const service = new StudentProfileService(repository, () => now)

  assert.deepEqual(await service.getCurrentAdvisor(userId), advisor)
  assert.deepEqual(repository.receivedAdvisorLookup, { userId, now })
})

test('trả null khi lớp chưa có cố vấn hiện tại', async () => {
  const service = new StudentProfileService(
    new FakeStudentProfileRepository(profile, null),
    () => now,
  )

  assert.equal(await service.getCurrentAdvisor(userId), null)
})
