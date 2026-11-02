import assert from 'node:assert/strict'
import { test } from 'node:test'

import { SYSTEM_ROLES } from './auth.constants.js'
import { SYSTEM_PERMISSIONS, SYSTEM_ROLE_PERMISSIONS } from './authorization.constants.js'

test('mọi system role đều có permission mapping tường minh', () => {
  const roleCodes = SYSTEM_ROLES.map((role) => role.code).sort()

  assert.deepEqual(Object.keys(SYSTEM_ROLE_PERMISSIONS).sort(), roleCodes)
})

test('SYSTEM_ADMIN có toàn bộ quyền vận hành, trừ mô phỏng và quản lý CLB (ADR 0029)', () => {
  const allPermissionCodes = SYSTEM_PERMISSIONS.filter(
    (p) =>
      ![
        'document.mock_sign',
        'club.manage',
        'activity.mandatory.manage',
        'activity.moderate',
        'activity.club.manage',
      ].includes(p.code),
  )
    .map((permission) => permission.code)
    .sort()

  assert.deepEqual([...SYSTEM_ROLE_PERMISSIONS.SYSTEM_ADMIN].sort(), allPermissionCodes)
})

test('ADMIN không tự có quyền ký tài liệu', () => {
  const adminPermissions: readonly string[] = SYSTEM_ROLE_PERMISSIONS.ADMIN

  assert.equal(adminPermissions.includes('document.sign'), false)
})

test('audit.read mặc định chỉ cấp cho SYSTEM_ADMIN', () => {
  const rolesWithAuditRead = Object.entries(SYSTEM_ROLE_PERMISSIONS)
    .filter(([, permissionCodes]) => (permissionCodes as readonly string[]).includes('audit.read'))
    .map(([roleCode]) => roleCode)

  assert.deepEqual(rolesWithAuditRead, ['SYSTEM_ADMIN'])
})

test('catalog mặc định có đúng 50 role-permission grants', () => {
  const grantCount = Object.values(SYSTEM_ROLE_PERMISSIONS).reduce(
    (total, permissionCodes) => total + permissionCodes.length,
    0,
  )

  assert.equal(grantCount, 50)
})

test('submission.assign mặc định chỉ SYSTEM_ADMIN; catalog có đúng 26 quyền', () => {
  assert.equal(SYSTEM_PERMISSIONS.length, 26)
  const holders = Object.entries(SYSTEM_ROLE_PERMISSIONS)
    .filter(([, codes]) => (codes as readonly string[]).includes('submission.assign'))
    .map(([role]) => role)
  assert.deepEqual(holders, ['SYSTEM_ADMIN'])
})

test('document.retry mặc định chỉ SYSTEM_ADMIN; ADMIN và người ký không được tự mở lượt', () => {
  const holders = Object.entries(SYSTEM_ROLE_PERMISSIONS)
    .filter(([, codes]) => (codes as readonly string[]).includes('document.retry'))
    .map(([role]) => role)
  assert.deepEqual(holders, ['SYSTEM_ADMIN'])
})

test('document.mock_sign không được tự cấp cho bất kỳ vai trò hệ thống nào', () => {
  for (const codes of Object.values(SYSTEM_ROLE_PERMISSIONS))
    assert.equal((codes as readonly string[]).includes('document.mock_sign'), false)
})

test('training period management defaults only to SYSTEM_ADMIN', () => {
  const holders = Object.entries(SYSTEM_ROLE_PERMISSIONS)
    .filter(([, codes]) => (codes as readonly string[]).includes('training_point.period.manage'))
    .map(([role]) => role)
  assert.deepEqual(holders, ['SYSTEM_ADMIN'])
})

test('ADR 0029: chỉ CTSV quản lý CLB; Phòng Đào tạo và người phụ trách chỉ xem', () => {
  const holders = Object.entries(SYSTEM_ROLE_PERMISSIONS)
    .filter(([, codes]) => (codes as readonly string[]).includes('club.manage'))
    .map(([role]) => role)
  assert.deepEqual(holders, ['STUDENT_AFFAIRS'])
  assert.deepEqual([...SYSTEM_ROLE_PERMISSIONS.CLUB_LEADER], ['club.read', 'activity.club.manage'])
  const mandatory = Object.entries(SYSTEM_ROLE_PERMISSIONS)
    .filter(([, codes]) => (codes as readonly string[]).includes('activity.mandatory.manage'))
    .map(([role]) => role)
  // ADR 0030: only CTSV and Phòng Đào tạo create mandatory activities; only CTSV moderates.
  assert.deepEqual(mandatory, ['STUDENT_AFFAIRS', 'TRAINING_OFFICE'])
  assert.equal(
    (SYSTEM_ROLE_PERMISSIONS.TRAINING_OFFICE as readonly string[]).includes('club.manage'),
    false,
  )
})
