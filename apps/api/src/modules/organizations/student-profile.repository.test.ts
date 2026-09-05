import assert from 'node:assert/strict'
import { test } from 'node:test'

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
  academicAdvisorAssignments,
  academicClasses,
  faculties,
  studentProfiles,
} from './organization.schema.js'
import {
  DrizzleStudentProfileRepository,
} from './student-profile.repository.js'

const databaseUrl = process.env.DATABASE_URL

if (
  !databaseUrl
  || new URL(databaseUrl).pathname
    !== '/student_service_test'
) {
  throw new Error(
    'Integration tests must use the student_service_test database',
  )
}

test(
  'repository trả hồ sơ và đúng cố vấn đang hiệu lực',
  async (context) => {
    context.after(async () => {
      await db.delete(
        academicAdvisorAssignments,
      )
      await db.delete(studentProfiles)
      await db.delete(academicClasses)
      await db.delete(faculties)
      await db.delete(userRoles)
      await db.delete(users)
      await databaseClient.end()
    })

    const [faculty] = await db
      .insert(faculties)
      .values({
        code: 'REPO-QLGD',
        name: 'Khoa Quản lý giáo dục',
      })
      .returning({ id: faculties.id })
    assert.ok(faculty)

    const [academicClass] = await db
      .insert(academicClasses)
      .values({
        facultyId: faculty.id,
        code: 'REPO-K15A',
        name: 'Quản lý giáo dục K15A',
      })
      .returning({ id: academicClasses.id })
    assert.ok(academicClass)

    const insertedUsers = await db
      .insert(users)
      .values([
        {
          username: 'repo.student',
          fullName: 'Sinh viên Repository',
          email: 'repo.student@example.edu.vn',
          status: 'ACTIVE',
        },
        {
          username: 'repo.advisor',
          fullName: 'Cố vấn Repository',
          email: 'repo.advisor@example.edu.vn',
          status: 'ACTIVE',
        },
      ])
      .returning({ id: users.id })

    const student = insertedUsers[0]
    const advisor = insertedUsers[1]
    assert.ok(student)
    assert.ok(advisor)

    const [advisorRole] = await db
      .insert(roles)
      .values({
        code: 'ACADEMIC_ADVISOR',
        name: 'Cố vấn học tập',
        isSystem: true,
      })
      .onConflictDoUpdate({
        target: roles.code,
        set: { name: 'Cố vấn học tập' },
      })
      .returning({ id: roles.id })
    assert.ok(advisorRole)

    await db.insert(userRoles).values({
      userId: advisor.id,
      roleId: advisorRole.id,
    })

    await db.insert(studentProfiles).values({
      userId: student.id,
      studentCode: 'REPO-SV001',
      classId: academicClass.id,
    })

    const validFrom =
      new Date('2026-01-01T00:00:00.000Z')
    await db
      .insert(academicAdvisorAssignments)
      .values({
        advisorUserId: advisor.id,
        classId: academicClass.id,
        validFrom,
        validTo: null,
        status: 'ACTIVE',
      })

    const repository =
      new DrizzleStudentProfileRepository()

    const profile = await repository
      .findStudentProfileByUserId(student.id)
    const currentAdvisor = await repository
      .findCurrentAdvisorForStudentUserId(
        student.id,
        new Date('2026-09-05T00:00:00.000Z'),
      )

    assert.deepEqual(profile, {
      userId: student.id,
      username: 'repo.student',
      fullName: 'Sinh viên Repository',
      email: 'repo.student@example.edu.vn',
      studentCode: 'REPO-SV001',
      class: {
        id: academicClass.id,
        code: 'REPO-K15A',
        name: 'Quản lý giáo dục K15A',
      },
      faculty: {
        id: faculty.id,
        code: 'REPO-QLGD',
        name: 'Khoa Quản lý giáo dục',
      },
    })

    assert.deepEqual(currentAdvisor, {
      userId: advisor.id,
      username: 'repo.advisor',
      fullName: 'Cố vấn Repository',
      email: 'repo.advisor@example.edu.vn',
      class: {
        id: academicClass.id,
        code: 'REPO-K15A',
        name: 'Quản lý giáo dục K15A',
      },
      validFrom,
      validTo: null,
    })
  },
)
