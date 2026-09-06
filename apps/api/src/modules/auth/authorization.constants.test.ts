import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  SYSTEM_ROLES,
} from './auth.constants.js'
import {
  SYSTEM_PERMISSIONS,
  SYSTEM_ROLE_PERMISSIONS,
} from './authorization.constants.js'

test(
  'mọi system role đều có permission mapping tường minh',
  () => {
    const roleCodes = SYSTEM_ROLES
      .map((role) => role.code)
      .sort()

    assert.deepEqual(
      Object.keys(
        SYSTEM_ROLE_PERMISSIONS,
      ).sort(),
      roleCodes,
    )
  },
)

test(
  'SYSTEM_ADMIN có toàn bộ system permission',
  () => {
    const allPermissionCodes =
      SYSTEM_PERMISSIONS
        .map(
          (permission) =>
            permission.code,
        )
        .sort()

    assert.deepEqual(
      [
        ...SYSTEM_ROLE_PERMISSIONS
          .SYSTEM_ADMIN,
      ].sort(),
      allPermissionCodes,
    )
  },
)

test(
  'ADMIN không tự có quyền ký tài liệu',
  () => {
    const adminPermissions:
      readonly string[] =
        SYSTEM_ROLE_PERMISSIONS.ADMIN

    assert.equal(
      adminPermissions.includes(
        'document.sign',
      ),
      false,
    )
  },
)

test(
  'audit.read mặc định chỉ cấp cho SYSTEM_ADMIN',
  () => {
    const rolesWithAuditRead =
      Object.entries(
        SYSTEM_ROLE_PERMISSIONS,
      )
        .filter(([, permissionCodes]) =>
          (
            permissionCodes as readonly string[]
          ).includes('audit.read'),
        )
        .map(([roleCode]) => roleCode)

    assert.deepEqual(
      rolesWithAuditRead,
      ['SYSTEM_ADMIN'],
    )
  },
)

test(
  'catalog mặc định có đúng 31 role-permission grants',
  () => {
    const grantCount = Object.values(
      SYSTEM_ROLE_PERMISSIONS,
    ).reduce(
      (total, permissionCodes) =>
        total + permissionCodes.length,
      0,
    )

    assert.equal(grantCount, 31)
  },
)
