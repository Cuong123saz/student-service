import argon2 from 'argon2'
import { and, eq } from 'drizzle-orm'
import {
  databaseClient,
  db,
} from './client.js'
import { services } from './schema.js'
import { env } from '../config/env.js'
import { SYSTEM_ROLES } from '../modules/auth/auth.constants.js'
import {
  SYSTEM_PERMISSIONS,
  SYSTEM_ROLE_PERMISSIONS,
  type SystemPermissionCode,
} from '../modules/auth/authorization.constants.js'
import {
  authorizationScopes,
  permissions,
  rolePermissions,
  userRoleScopes,
} from '../modules/auth/authorization.schema.js'
import {
  roles,
  userRoles,
  users,
} from '../modules/auth/auth.schema.js'
import {
  academicAdvisorAssignments,
  academicClasses,
  faculties,
  organizationalUnits,
} from '../modules/organizations/organization.schema.js'

const DEMO_FACULTY_ID =
  '2f8d4b77-5555-4e4c-9b90-111111111111'
const DEMO_CLASS_ID =
  '2f8d4b77-5555-4e4c-9b90-222222222222'
const DEMO_ADVISOR_ID =
  '2f8d4b77-5555-4e4c-9b90-333333333333'

async function seed() {
  if (env.isProduction) {
    throw new Error(
      'Demo seed is disabled when APP_ENV=production',
    )
  }

  const demoAdvisorPasswordHash =
    await argon2.hash(
      `seed-only-${Date.now()}-${Math.random()}`,
    )

  let seededClassId = DEMO_CLASS_ID

  await db.transaction(async (transaction) => {
    await transaction
      .insert(services)
      .values([
        {
          code: 'STUDENT_CONFIRMATION',
          name: 'Cấp giấy xác nhận sinh viên',
          description:
            'Cấp giấy xác nhận đang theo học tại trường',
          processingDays: 3,
          status: 'ACTIVE',
        },
        {
          code: 'LEAVE_REQUEST',
          name: 'Đơn xin nghỉ học',
          description:
            'Sinh viên gửi yêu cầu xin nghỉ học có phép',
          processingDays: 2,
          status: 'ACTIVE',
        },
        {
          code: 'STUDY_SUSPENSION',
          name: 'Đề nghị bảo lưu học tập',
          description:
            'Sinh viên gửi yêu cầu bảo lưu kết quả học tập',
          processingDays: 7,
          status: 'ACTIVE',
        },
      ])
      .onConflictDoNothing({
        target: services.code,
      })

    for (const role of SYSTEM_ROLES) {
      await transaction
        .insert(roles)
        .values(role)
        .onConflictDoUpdate({
          target: roles.code,
          set: {
            name: role.name,
            description: role.description,
            isSystem: role.isSystem,
          },
        })
    }

    for (
      const permission
      of SYSTEM_PERMISSIONS
    ) {
      await transaction
        .insert(permissions)
        .values({
          ...permission,
          isSystem: true,
        })
        .onConflictDoUpdate({
          target: permissions.code,
          set: {
            name: permission.name,
            description:
              permission.description,
            isSystem: true,
          },
        })
    }

    const rolePermissionEntries =
      Object.entries(
        SYSTEM_ROLE_PERMISSIONS,
      ) as [
        keyof typeof SYSTEM_ROLE_PERMISSIONS,
        readonly SystemPermissionCode[],
      ][]

    for (
      const [roleCode, permissionCodes]
      of rolePermissionEntries
    ) {
      const roleRow = (await transaction
        .select({ id: roles.id })
        .from(roles)
        .where(eq(roles.code, roleCode))
        .limit(1))[0]

      if (!roleRow) {
        throw new Error(
          `Role was not seeded: ${roleCode}`,
        )
      }

      for (
        const permissionCode
        of permissionCodes
      ) {
        const permissionRow =
          (await transaction
            .select({
              id: permissions.id,
            })
            .from(permissions)
            .where(
              eq(
                permissions.code,
                permissionCode,
              ),
            )
            .limit(1))[0]

        if (!permissionRow) {
          throw new Error(
            `Permission was not seeded: ${permissionCode}`,
          )
        }

        await transaction
          .insert(rolePermissions)
          .values({
            roleId: roleRow.id,
            permissionId:
              permissionRow.id,
          })
          // Seed only adds safe defaults. It must not silently revoke
          // grants configured after the initial installation.
          .onConflictDoNothing()
      }
    }

    await transaction
      .insert(authorizationScopes)
      .values({ scopeType: 'GLOBAL' })
      .onConflictDoNothing()

    const [globalScope] = await transaction
      .select({ id: authorizationScopes.id })
      .from(authorizationScopes)
      .where(
        eq(
          authorizationScopes.scopeType,
          'GLOBAL',
        ),
      )
      .limit(1)

    if (!globalScope) {
      throw new Error(
        'GLOBAL authorization scope was not seeded',
      )
    }

    const [systemAdminRole] =
      await transaction
        .select({ id: roles.id })
        .from(roles)
        .where(
          eq(roles.code, 'SYSTEM_ADMIN'),
        )
        .limit(1)

    if (!systemAdminRole) {
      throw new Error(
        'SYSTEM_ADMIN role was not seeded',
      )
    }

    const systemAdminAssignments =
      await transaction
        .select({ userId: userRoles.userId })
        .from(userRoles)
        .where(
          eq(
            userRoles.roleId,
            systemAdminRole.id,
          ),
        )

    if (systemAdminAssignments.length > 0) {
      await transaction
        .insert(userRoleScopes)
        .values(
          systemAdminAssignments.map(
            (assignment) => ({
              userId: assignment.userId,
              roleId: systemAdminRole.id,
              scopeId: globalScope.id,
            }),
          ),
        )
        .onConflictDoNothing()
    }

    await transaction
      .insert(organizationalUnits)
      .values([
        {
          code: 'DAO_TAO',
          name: 'Phòng Đào tạo',
        },
        {
          code: 'CTSV',
          name: 'Phòng Công tác sinh viên',
        },
        {
          code: 'KH_TAI_CHINH',
          name: 'Phòng Kế hoạch và Tài chính',
        },
      ])
      .onConflictDoNothing()

    await transaction
      .insert(faculties)
      .values({
        id: DEMO_FACULTY_ID,
        code: 'QLGD',
        name: 'Khoa Quản lý giáo dục',
        status: 'ACTIVE',
      })
      .onConflictDoUpdate({
        target: faculties.code,
        set: {
          name: 'Khoa Quản lý giáo dục',
          status: 'ACTIVE',
        },
      })

    const facultyRow = (await transaction
      .select({ id: faculties.id })
      .from(faculties)
      .where(eq(faculties.code, 'QLGD'))
      .limit(1))[0]
    if (!facultyRow) throw new Error('Demo faculty was not seeded')

    await transaction
      .insert(academicClasses)
      .values({
        id: DEMO_CLASS_ID,
        facultyId: facultyRow.id,
        code: 'QLGD-K15A',
        name: 'Quản lý giáo dục K15A',
        status: 'ACTIVE',
      })
      .onConflictDoUpdate({
        target: academicClasses.code,
        set: {
          facultyId: facultyRow.id,
          name: 'Quản lý giáo dục K15A',
          status: 'ACTIVE',
        },
      })

    const classRow = (await transaction
      .select({ id: academicClasses.id })
      .from(academicClasses)
      .where(eq(academicClasses.code, 'QLGD-K15A'))
      .limit(1))[0]
    if (!classRow) throw new Error('Demo class was not seeded')
    seededClassId = classRow.id

    await transaction
      .insert(users)
      .values({
        id: DEMO_ADVISOR_ID,
        username: 'demo.advisor',
        email: 'demo.advisor@naem.edu.vn',
        fullName: 'Giảng viên cố vấn mẫu',
        passwordHash: demoAdvisorPasswordHash,
        status: 'ACTIVE',
        mustChangePassword: false,
      })
      .onConflictDoUpdate({
        target: users.username,
        set: {
          fullName: 'Giảng viên cố vấn mẫu',
          status: 'ACTIVE',
          updatedAt: new Date(),
        },
      })

    const advisorRow = (await transaction
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, 'demo.advisor'))
      .limit(1))[0]
    if (!advisorRow) throw new Error('Demo advisor was not seeded')

    const advisorRole = await transaction
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.code, 'ACADEMIC_ADVISOR'))
      .limit(1)

    const advisorRoleRow = advisorRole[0]
    if (!advisorRoleRow) {
      throw new Error('ACADEMIC_ADVISOR role was not seeded')
    }

    await transaction
      .insert(userRoles)
      .values({
        userId: advisorRow.id,
        roleId: advisorRoleRow.id,
      })
      .onConflictDoNothing()

    await transaction
      .insert(authorizationScopes)
      .values({
        scopeType: 'CLASS',
        classId: classRow.id,
      })
      .onConflictDoNothing()

    const [classScope] = await transaction
      .select({ id: authorizationScopes.id })
      .from(authorizationScopes)
      .where(
        and(
          eq(
            authorizationScopes.scopeType,
            'CLASS',
          ),
          eq(
            authorizationScopes.classId,
            classRow.id,
          ),
        ),
      )
      .limit(1)

    if (!classScope) {
      throw new Error(
        'Demo class scope was not seeded',
      )
    }

    await transaction
      .insert(userRoleScopes)
      .values({
        userId: advisorRow.id,
        roleId: advisorRoleRow.id,
        scopeId: classScope.id,
      })
      .onConflictDoNothing()

    const existingAssignment = await transaction
      .select({ id: academicAdvisorAssignments.id })
      .from(academicAdvisorAssignments)
      .where(and(
        eq(
          academicAdvisorAssignments.classId,
          classRow.id,
        ),
        eq(
          academicAdvisorAssignments.status,
          'ACTIVE',
        ),
      ))
      .limit(1)

    if (existingAssignment.length === 0) {
      await transaction
        .insert(academicAdvisorAssignments)
        .values({
          advisorUserId: advisorRow.id,
          classId: classRow.id,
          validFrom: new Date('2026-01-01T00:00:00.000Z'),
          status: 'ACTIVE',
        })
    }
  })

  console.log(
    `Demo academic data ready. classId=${seededClassId}`,
  )
}

seed()
  .then(() => {
    console.log('Seed completed')
  })
  .catch((error: unknown) => {
    console.error('Seed failed', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await databaseClient.end()
  })
