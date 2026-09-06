import assert from 'node:assert/strict'
import {
  and,
  eq,
  sql,
} from 'drizzle-orm'
import {
  after,
  beforeEach,
  test,
} from 'node:test'

import {
  databaseClient,
  db,
} from '../../db/client.js'

import {
  roles,
  userRoles,
  users,
} from '../auth/auth.schema.js'
import {
  authorizationScopes,
  permissions,
  rolePermissions,
  userRoleScopes,
} from '../auth/authorization.schema.js'
import {
  auditLogs,
} from '../audit/audit.schema.js'
import {
  academicAdvisorAssignments,
  academicClasses,
  faculties,
  studentProfiles,
} from '../organizations/organization.schema.js'

import {
  userActionTokens,
} from './user-account.schema.js'

import {
  AcademicClassOutsideScopeError,
  AcademicClassNotFoundError,
  DrizzleUserInvitationRepository,
  InvitationConflictError,
  InvitationTargetForbiddenError,
} from './user-invitation.repository.js'

const databaseUrl =
  process.env.DATABASE_URL

if (
  !databaseUrl
  || new URL(databaseUrl).pathname
    !== '/student_service_test'
) {
  throw new Error(
    'Integration tests must use the student_service_test database',
  )
}

const invitedAt =
  new Date('2026-01-01T00:00:00.000Z')

beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE ${auditLogs}`)
  await db.delete(userActionTokens)
  await db.delete(userRoleScopes)
  await db.delete(authorizationScopes)
  await db.delete(rolePermissions)
  await db.delete(permissions)
  await db.delete(studentProfiles)
  await db.delete(academicAdvisorAssignments)
  await db.delete(academicClasses)
  await db.delete(faculties)
  await db.delete(userRoles)
  await db.delete(users)
  await db.delete(roles)
})

after(async () => {
  await databaseClient.end()
})

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === 'object'
    && value !== null
  )
}

async function createActor() {
  const insertedActors =
    await db
      .insert(users)
      .values({
        username: 'system.admin',
        email: 'admin@example.edu.vn',
        passwordHash: 'not-used',
        fullName: 'System Admin',
        status: 'ACTIVE',
        mustChangePassword: false,
      })
      .returning({
        id: users.id,
      })

  const actor =
    insertedActors[0]

  assert.ok(actor)

  return actor
}

async function createStudentRole() {
  await db
    .insert(roles)
    .values({
      code: 'STUDENT',
      name: 'Sinh viên',
      isSystem: true,
    })
}

async function createAcademicClass(
  facultyCode = 'QLGD',
  classCode = 'QLGD-K15A',
) {
  const faculty = (await db
    .insert(faculties)
    .values({
      code: facultyCode,
      name: `Khoa ${facultyCode}`,
      status: 'ACTIVE',
    })
    .returning({ id: faculties.id }))[0]
  assert.ok(faculty)

  const academicClass = (await db
    .insert(academicClasses)
    .values({
      facultyId: faculty.id,
      code: classCode,
      name: `Lớp ${classCode}`,
      status: 'ACTIVE',
    })
    .returning({
      id: academicClasses.id,
      facultyId: academicClasses.facultyId,
    }))[0]
  assert.ok(academicClass)

  return academicClass
}

type InvitationScope =
  | { scopeType: 'GLOBAL' }
  | {
      scopeType: 'FACULTY'
      facultyId: string
    }
  | {
      scopeType: 'CLASS'
      classId: string
    }

async function grantStudentCreateScope(
  actorUserId: string,
  scopeValues: InvitationScope,
) {
  const [actorRole] = await db
    .insert(roles)
    .values({
      code: 'ADMIN',
      name: 'Quản trị nghiệp vụ',
      isSystem: true,
    })
    .returning({ id: roles.id })
  assert.ok(actorRole)

  const [permission] = await db
    .insert(permissions)
    .values({
      code: 'student.create',
      name: 'Tạo sinh viên',
      isSystem: true,
    })
    .returning({ id: permissions.id })
  assert.ok(permission)

  await db.insert(userRoles).values({
    userId: actorUserId,
    roleId: actorRole.id,
  })
  await db.insert(rolePermissions).values({
    roleId: actorRole.id,
    permissionId: permission.id,
  })

  const [scope] = await db
    .insert(authorizationScopes)
    .values(scopeValues)
    .returning({ id: authorizationScopes.id })
  assert.ok(scope)

  await db.insert(userRoleScopes).values({
    userId: actorUserId,
    roleId: actorRole.id,
    scopeId: scope.id,
  })

  return actorRole.id
}

test(
  'tạo user INVITED cùng role và activation token trong một transaction',
  async () => {
    await createStudentRole()

    const actor =
      await createActor()
    const academicClass =
      await createAcademicClass()
    await grantStudentCreateScope(
      actor.id,
      { scopeType: 'GLOBAL' },
    )

    const repository =
      new DrizzleUserInvitationRepository()

    const tokenHash =
      'a'.repeat(64)

    const tokenExpiresAt =
      new Date(
        invitedAt.getTime()
        + 72 * 60 * 60 * 1000,
      )

    const result =
      await repository
        .createInvitedUserWithToken({
          username: 'student001',
          email:
            'student001@example.edu.vn',
          fullName: 'Nguyễn Văn A',
          targetRoles: ['STUDENT'],
          invitedAt,
          tokenHash,
          tokenExpiresAt,
          createdByUserId: actor.id,
          studentCode: 'SV001',
          classId: academicClass.id,
          actorUsername: 'system.admin',
          auditContext: {
            requestId: 'req-1',
            ipAddress: '127.0.0.1',
            userAgent: 'test',
          },
        })

    const invitedUsers =
      await db
        .select({
          id: users.id,
          username: users.username,
          email: users.email,
          passwordHash:
            users.passwordHash,
          status: users.status,
          mustChangePassword:
            users.mustChangePassword,
          invitedAt: users.invitedAt,
          lastInvitationSentAt:
            users.lastInvitationSentAt,
          activatedAt:
            users.activatedAt,
        })
        .from(users)
        .where(
          eq(users.id, result.userId),
        )

    assert.deepEqual(
      invitedUsers[0],
      {
        id: result.userId,
        username: 'student001',
        email:
          'student001@example.edu.vn',
        passwordHash: null,
        status: 'INVITED',
        mustChangePassword: false,
        invitedAt,
        lastInvitationSentAt: null,
        activatedAt: null,
      },
    )

    const assignedRoles =
      await db
        .select({
          code: roles.code,
        })
        .from(userRoles)
        .innerJoin(
          roles,
          eq(
            userRoles.roleId,
            roles.id,
          ),
        )
        .where(
          eq(
            userRoles.userId,
            result.userId,
          ),
        )

    assert.deepEqual(
      assignedRoles,
      [
        {
          code: 'STUDENT',
        },
      ],
    )

    const storedProfiles = await db
      .select({
        studentCode: studentProfiles.studentCode,
        classId: studentProfiles.classId,
      })
      .from(studentProfiles)
      .where(eq(studentProfiles.userId, result.userId))

    assert.deepEqual(storedProfiles, [
      {
        studentCode: 'SV001',
        classId: academicClass.id,
      },
    ])

    const storedAuditEvents = await db
      .select({
        action: auditLogs.action,
        resourceId: auditLogs.resourceId,
        before: auditLogs.before,
        after: auditLogs.after,
      })
      .from(auditLogs)
      .where(eq(auditLogs.resourceId, result.userId))

    assert.deepEqual(
      storedAuditEvents.map((event) => event.action).sort(),
      ['ROLE_ASSIGNMENT', 'USER_INVITATION_CREATE'],
    )

    const storedTokens =
      await db
        .select({
          purpose:
            userActionTokens.purpose,
          tokenHash:
            userActionTokens.tokenHash,
          expiresAt:
            userActionTokens.expiresAt,
          createdAt:
            userActionTokens.createdAt,
          createdByUserId:
            userActionTokens
              .createdByUserId,
        })
        .from(userActionTokens)
        .where(
          eq(
            userActionTokens.userId,
            result.userId,
          ),
        )

    assert.deepEqual(
      storedTokens[0],
      {
        purpose:
          'ACCOUNT_ACTIVATION',
        tokenHash,
        expiresAt: tokenExpiresAt,
        createdAt: invitedAt,
        createdByUserId: actor.id,
      },
    )

    const sentAt =
      new Date(
        '2026-01-01T00:01:00.000Z',
      )

    await repository
      .markInvitationSent(
        result.userId,
        sentAt,
      )

    const updatedUsers =
      await db
        .select({
          lastInvitationSentAt:
            users.lastInvitationSentAt,
          updatedAt:
            users.updatedAt,
        })
        .from(users)
        .where(
          eq(users.id, result.userId),
        )

    assert.deepEqual(
      updatedUsers[0],
      {
        lastInvitationSentAt:
          sentAt,
        updatedAt: sentAt,
      },
    )
  },
)

test(
  'rollback user và role khi activation token vi phạm constraint',
  async () => {
    await createStudentRole()

    const actor =
      await createActor()
    const academicClass =
      await createAcademicClass()
    await grantStudentCreateScope(
      actor.id,
      { scopeType: 'GLOBAL' },
    )

    const repository =
      new DrizzleUserInvitationRepository()

    const invalidTokenHash =
      'b'.repeat(64)

    const invalidExpiresAt =
      new Date(
        invitedAt.getTime()
        + 73 * 60 * 60 * 1000,
      )

    await assert.rejects(
      () =>
        repository
          .createInvitedUserWithToken({
            username: 'student002',
            email:
              'student002@example.edu.vn',
            fullName: 'Trần Văn B',
            targetRoles: ['STUDENT'],
            invitedAt,
            tokenHash:
              invalidTokenHash,
            tokenExpiresAt:
              invalidExpiresAt,
            createdByUserId:
              actor.id,
            studentCode: 'SV002',
            classId: academicClass.id,
            actorUsername:
              'system.admin',
            auditContext: {
              requestId: 'req-2',
              ipAddress: '127.0.0.1',
              userAgent: 'test',
            },
          }),
      (error: unknown) => {
        assert.ok(isRecord(error))

        const cause =
          error['cause']

        assert.ok(isRecord(cause))

        assert.equal(
          cause['code'],
          '23514',
        )

        assert.equal(
          cause['constraint_name'],
          'user_action_tokens_expiration_policy_check',
        )

        return true
      },
    )

    const rolledBackUsers =
      await db
        .select({
          id: users.id,
        })
        .from(users)
        .where(
          eq(
            users.username,
            'student002',
          ),
        )

    assert.deepEqual(
      rolledBackUsers,
      [],
    )

    const rolledBackTokens =
      await db
        .select({
          id: userActionTokens.id,
        })
        .from(userActionTokens)
        .where(
          eq(
            userActionTokens.tokenHash,
            invalidTokenHash,
          ),
        )

    assert.deepEqual(
      rolledBackTokens,
      [],
    )

    const roleAssignments =
      await db
        .select({
          userId: userRoles.userId,
        })
        .from(userRoles)

    assert.deepEqual(
      roleAssignments,
      [{ userId: actor.id }],
    )
  },
)

test(
  'từ chối classId không tồn tại trước khi tạo user',
  async () => {
    await createStudentRole()
    const actor = await createActor()
    await grantStudentCreateScope(
      actor.id,
      { scopeType: 'GLOBAL' },
    )
    const repository =
      new DrizzleUserInvitationRepository()

    await assert.rejects(
      () => repository.createInvitedUserWithToken({
        username: 'student.no-class',
        email: 'student.no-class@example.edu.vn',
        fullName: 'Sinh viên chưa có lớp',
        targetRoles: ['STUDENT'],
        studentCode: 'SV-NO-CLASS',
        classId: '00000000-0000-4000-8000-000000000999',
        invitedAt,
        tokenHash: 'c'.repeat(64),
        tokenExpiresAt: new Date(
          invitedAt.getTime() + 72 * 60 * 60 * 1000,
        ),
        createdByUserId: actor.id,
        actorUsername: 'system.admin',
        auditContext: {
          requestId: 'req-no-class',
          ipAddress: '127.0.0.1',
          userAgent: 'test',
        },
      }),
      AcademicClassNotFoundError,
    )

    const partialUsers = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, 'student.no-class'))

    assert.deepEqual(partialUsers, [])
  },
)

test(
  'từ chối tạo sinh viên ở lớp nằm ngoài scope của actor',
  async () => {
    await createStudentRole()
    const actor = await createActor()
    const allowedClass = await createAcademicClass(
      'FACULTY-ALLOWED',
      'CLASS-ALLOWED',
    )
    const outsideClass = await createAcademicClass(
      'FACULTY-OUTSIDE',
      'CLASS-OUTSIDE',
    )
    await grantStudentCreateScope(
      actor.id,
      {
        scopeType: 'CLASS',
        classId: allowedClass.id,
      },
    )

    const repository =
      new DrizzleUserInvitationRepository()

    await assert.rejects(
      () => repository.createInvitedUserWithToken({
        username: 'student.outside-scope',
        email: 'student.outside-scope@example.edu.vn',
        fullName: 'Sinh viên ngoài phạm vi',
        targetRoles: ['STUDENT'],
        studentCode: 'SV-OUTSIDE-SCOPE',
        classId: outsideClass.id,
        invitedAt,
        tokenHash: '1'.repeat(64),
        tokenExpiresAt: new Date(
          invitedAt.getTime() + 72 * 60 * 60 * 1000,
        ),
        createdByUserId: actor.id,
        actorUsername: 'system.admin',
        auditContext: {
          requestId: 'req-outside-scope',
          ipAddress: '127.0.0.1',
          userAgent: 'test',
        },
      }),
      AcademicClassOutsideScopeError,
    )

    const partialUsers = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(
        users.username,
        'student.outside-scope',
      ))

    assert.deepEqual(partialUsers, [])
  },
)

test(
  'từ chối studentCode trùng và chỉ rõ field xung đột',
  async () => {
    await createStudentRole()
    const actor = await createActor()
    const academicClass = await createAcademicClass()
    await grantStudentCreateScope(
      actor.id,
      { scopeType: 'GLOBAL' },
    )
    const repository =
      new DrizzleUserInvitationRepository()
    const tokenExpiresAt = new Date(
      invitedAt.getTime() + 72 * 60 * 60 * 1000,
    )

    const baseInput = {
      fullName: 'Sinh viên đầu tiên',
      targetRoles: ['STUDENT'],
      studentCode: 'SV-DUPLICATE',
      classId: academicClass.id,
      invitedAt,
      tokenExpiresAt,
      createdByUserId: actor.id,
      actorUsername: 'system.admin',
      auditContext: {
        requestId: 'req-duplicate',
        ipAddress: '127.0.0.1',
        userAgent: 'test',
      },
    } as const

    await repository.createInvitedUserWithToken({
      ...baseInput,
      username: 'student.first',
      email: 'student.first@example.edu.vn',
      tokenHash: 'd'.repeat(64),
    })

    await assert.rejects(
      () => repository.createInvitedUserWithToken({
        ...baseInput,
        username: 'student.second',
        email: 'student.second@example.edu.vn',
        tokenHash: 'e'.repeat(64),
      }),
      (error: unknown) => {
        assert.ok(error instanceof InvitationConflictError)
        assert.equal(error.field, 'studentCode')
        return true
      },
    )

    const partialUsers = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, 'student.second'))

    assert.deepEqual(partialUsers, [])
  },
)

test(
  'gửi lại lời mời sinh viên khi actor còn quyền và scope',
  async () => {
    await createStudentRole()
    const actor = await createActor()
    const academicClass = await createAcademicClass()
    await grantStudentCreateScope(
      actor.id,
      { scopeType: 'GLOBAL' },
    )
    const repository =
      new DrizzleUserInvitationRepository()
    const originalTokenHash = '5'.repeat(64)
    const replacementTokenHash = '6'.repeat(64)

    const invitation = await repository
      .createInvitedUserWithToken({
        username: 'student.resend.allowed',
        email: 'student.resend.allowed@example.edu.vn',
        fullName: 'Sinh viên được gửi lại',
        targetRoles: ['STUDENT'],
        studentCode: 'SV-RESEND-ALLOWED',
        classId: academicClass.id,
        invitedAt,
        tokenHash: originalTokenHash,
        tokenExpiresAt: new Date(
          invitedAt.getTime() + 72 * 60 * 60 * 1000,
        ),
        createdByUserId: actor.id,
        actorUsername: 'system.admin',
        auditContext: {
          requestId: 'req-create-resend-allowed',
          ipAddress: '127.0.0.1',
          userAgent: 'test',
        },
      })

    const resendAt = new Date(
      invitedAt.getTime() + 60 * 60 * 1000,
    )
    const result = await repository
      .replaceActivationToken({
        userId: invitation.userId,
        tokenHash: replacementTokenHash,
        tokenExpiresAt: new Date(
          resendAt.getTime() + 72 * 60 * 60 * 1000,
        ),
        createdAt: resendAt,
        createdByUserId: actor.id,
        actorUsername: 'system.admin',
        auditContext: {
          requestId: 'req-resend-allowed',
          ipAddress: '127.0.0.1',
          userAgent: 'test',
        },
      })

    assert.deepEqual(result, {
      userId: invitation.userId,
      email: 'student.resend.allowed@example.edu.vn',
      fullName: 'Sinh viên được gửi lại',
    })

    const tokens = await db
      .select({
        tokenHash: userActionTokens.tokenHash,
        revokedAt: userActionTokens.revokedAt,
      })
      .from(userActionTokens)
      .where(eq(
        userActionTokens.userId,
        invitation.userId,
      ))

    assert.equal(
      tokens.find(
        token => token.tokenHash === originalTokenHash,
      )?.revokedAt?.toISOString(),
      resendAt.toISOString(),
    )
    assert.equal(
      tokens.find(
        token => token.tokenHash === replacementTokenHash,
      )?.revokedAt,
      null,
    )
  },
)

test(
  'gửi lại ngoài scope rollback việc revoke và tạo token mới',
  async () => {
    await createStudentRole()
    const actor = await createActor()
    const targetClass = await createAcademicClass(
      'FACULTY-TARGET',
      'CLASS-TARGET',
    )
    const actorRoleId = await grantStudentCreateScope(
      actor.id,
      { scopeType: 'GLOBAL' },
    )
    const repository =
      new DrizzleUserInvitationRepository()
    const originalTokenHash = '7'.repeat(64)
    const rejectedTokenHash = '8'.repeat(64)

    const invitation = await repository
      .createInvitedUserWithToken({
        username: 'student.resend.outside',
        email: 'student.resend.outside@example.edu.vn',
        fullName: 'Sinh viên ngoài phạm vi gửi lại',
        targetRoles: ['STUDENT'],
        studentCode: 'SV-RESEND-OUTSIDE',
        classId: targetClass.id,
        invitedAt,
        tokenHash: originalTokenHash,
        tokenExpiresAt: new Date(
          invitedAt.getTime() + 72 * 60 * 60 * 1000,
        ),
        createdByUserId: actor.id,
        actorUsername: 'system.admin',
        auditContext: {
          requestId: 'req-create-resend-outside',
          ipAddress: '127.0.0.1',
          userAgent: 'test',
        },
      })

    await db.delete(userRoleScopes).where(
      and(
        eq(userRoleScopes.userId, actor.id),
        eq(userRoleScopes.roleId, actorRoleId),
      ),
    )
    await db.delete(authorizationScopes)

    const otherClass = await createAcademicClass(
      'FACULTY-OTHER',
      'CLASS-OTHER',
    )
    const [otherScope] = await db
      .insert(authorizationScopes)
      .values({
        scopeType: 'CLASS',
        classId: otherClass.id,
      })
      .returning({ id: authorizationScopes.id })
    assert.ok(otherScope)
    await db.insert(userRoleScopes).values({
      userId: actor.id,
      roleId: actorRoleId,
      scopeId: otherScope.id,
    })

    const resendAt = new Date(
      invitedAt.getTime() + 60 * 60 * 1000,
    )

    await assert.rejects(
      () => repository.replaceActivationToken({
        userId: invitation.userId,
        tokenHash: rejectedTokenHash,
        tokenExpiresAt: new Date(
          resendAt.getTime() + 72 * 60 * 60 * 1000,
        ),
        createdAt: resendAt,
        createdByUserId: actor.id,
        actorUsername: 'system.admin',
        auditContext: {
          requestId: 'req-resend-outside',
          ipAddress: '127.0.0.1',
          userAgent: 'test',
        },
      }),
      InvitationTargetForbiddenError,
    )

    const tokens = await db
      .select({
        tokenHash: userActionTokens.tokenHash,
        revokedAt: userActionTokens.revokedAt,
      })
      .from(userActionTokens)
      .where(eq(
        userActionTokens.userId,
        invitation.userId,
      ))

    assert.deepEqual(tokens, [{
      tokenHash: originalTokenHash,
      revokedAt: null,
    }])
    assert.equal(
      tokens.some(
        token => token.tokenHash === rejectedTokenHash,
      ),
      false,
    )
  },
)

test(
  'rollback toàn bộ khi audit bắt buộc không ghi được',
  async () => {
    await createStudentRole()
    const actor = await createActor()
    const academicClass = await createAcademicClass()
    await grantStudentCreateScope(
      actor.id,
      { scopeType: 'GLOBAL' },
    )
    const repository =
      new DrizzleUserInvitationRepository()

    await assert.rejects(
      () => repository.createInvitedUserWithToken({
        username: 'student.audit-failure',
        email: 'student.audit-failure@example.edu.vn',
        fullName: 'Sinh viên Audit Failure',
        targetRoles: ['STUDENT'],
        studentCode: 'SV-AUDIT-FAILURE',
        classId: academicClass.id,
        invitedAt,
        tokenHash: 'f'.repeat(64),
        tokenExpiresAt: new Date(
          invitedAt.getTime() + 72 * 60 * 60 * 1000,
        ),
        createdByUserId: actor.id,
        // audit_logs.actor_username chỉ cho phép tối đa 100 ký tự.
        // Lỗi này được kích hoạt sau các insert nghiệp vụ để chứng minh rollback.
        actorUsername: 'a'.repeat(101),
        auditContext: {
          requestId: 'req-audit-failure',
          ipAddress: '127.0.0.1',
          userAgent: 'test',
        },
      }),
    )

    const partialUsers = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, 'student.audit-failure'))

    const partialProfiles = await db
      .select({ userId: studentProfiles.userId })
      .from(studentProfiles)
      .where(eq(
        studentProfiles.studentCode,
        'SV-AUDIT-FAILURE',
      ))

    const partialTokens = await db
      .select({ id: userActionTokens.id })
      .from(userActionTokens)
      .where(eq(userActionTokens.tokenHash, 'f'.repeat(64)))

    assert.deepEqual(partialUsers, [])
    assert.deepEqual(partialProfiles, [])
    assert.deepEqual(partialTokens, [])
  },
)
