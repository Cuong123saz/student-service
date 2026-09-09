import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  AdminStudentService,
  InvalidStudentUpdateError,
  type AdminStudentRepository,
  type UpdateStudentInput,
} from './admin-student.service.js'

class FakeRepository implements AdminStudentRepository {
  updated: UpdateStudentInput | undefined

  async listVisibleTo() {
    return { students: [], nextCursor: null }
  }

  async updateStudent(input: UpdateStudentInput) {
    this.updated = input
  }
}

const baseInput = {
  actorUserId: 'actor-1',
  actorUsername: 'admin',
  userId: 'student-1',
  facultyId: 'faculty-1',
  classId: 'class-1',
  audit: {
    requestId: null,
    ipAddress: null,
    userAgent: null,
  },
}

test('chuẩn hóa mã số và tên trước khi cập nhật sinh viên', async () => {
  const repository = new FakeRepository()
  const changedAt = new Date('2026-09-09T00:00:00.000Z')
  const service = new AdminStudentService(repository, () => changedAt)

  await service.updateStudent({
    ...baseInput,
    studentCode: ' 001234 ',
    fullName: ' Nguyễn   Văn A ',
  })

  assert.equal(repository.updated?.studentCode, '001234')
  assert.equal(repository.updated?.fullName, 'Nguyễn Văn A')
  assert.equal(repository.updated?.changedAt, changedAt)
})

test('từ chối mã sinh viên chứa ký tự không phải số', () => {
  const service = new AdminStudentService(new FakeRepository())

  assert.throws(
    () => service.updateStudent({
      ...baseInput,
      studentCode: 'SV001',
      fullName: 'Nguyễn Văn A',
    }),
    InvalidStudentUpdateError,
  )
})
