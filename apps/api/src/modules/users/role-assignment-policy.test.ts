import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  EmptyRoleAssignmentError,
  ForbiddenRoleAssignmentError,
  assertCanAssignRoles,
} from './role-assignment-policy.js'

test('SYSTEM_ADMIN được gán mọi system role', () => {
  assert.doesNotThrow(() => {
    assertCanAssignRoles(['SYSTEM_ADMIN'], ['SYSTEM_ADMIN', 'ADMIN', 'STUDENT'])
  })
})

test('ADMIN được gán các role nghiệp vụ', () => {
  assert.doesNotThrow(() => {
    assertCanAssignRoles(
      ['ADMIN'],
      ['STUDENT', 'ACADEMIC_ADVISOR', 'FACULTY_REVIEWER', 'DOCUMENT_SIGNER'],
    )
  })
})

test('ADR 0029: ADMIN gán được CTSV và Phòng Đào tạo, không gán role theo nhiệm kỳ', () => {
  assert.doesNotThrow(() => assertCanAssignRoles(['ADMIN'], ['STUDENT_AFFAIRS', 'TRAINING_OFFICE']))
  for (const role of ['CLUB_LEADER', 'CLASS_MONITOR'] as const)
    assert.throws(() => assertCanAssignRoles(['ADMIN'], [role]), ForbiddenRoleAssignmentError)
})

test('ADMIN không được gán SYSTEM_ADMIN', () => {
  assert.throws(() => {
    assertCanAssignRoles(['ADMIN'], ['SYSTEM_ADMIN'])
  }, ForbiddenRoleAssignmentError)
})

test('actor không phải admin không được gán role', () => {
  assert.throws(() => {
    assertCanAssignRoles(['STUDENT'], ['STUDENT'])
  }, ForbiddenRoleAssignmentError)
})

test('không được tạo tài khoản thiếu role', () => {
  assert.throws(() => {
    assertCanAssignRoles(['SYSTEM_ADMIN'], [])
  }, EmptyRoleAssignmentError)
})
