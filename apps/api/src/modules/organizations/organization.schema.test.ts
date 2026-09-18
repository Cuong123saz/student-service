import assert from 'node:assert/strict'
import { test } from 'node:test'

import { databaseClient, db } from '../../db/client.js'
import { users } from '../auth/auth.schema.js'
import {
  academicAdvisorAssignments,
  academicClasses,
  faculties,
  studentProfiles,
} from './organization.schema.js'

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl || new URL(databaseUrl).pathname !== '/student_service_test') {
  throw new Error('Integration tests must use the student_service_test database')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function findPostgresError(error: unknown): Record<string, unknown> | null {
  let current = error

  while (isRecord(current)) {
    if (typeof current['code'] === 'string') {
      return current
    }

    current = current['cause']
  }

  return null
}

test('database ngăn hai phân công cố vấn ACTIVE bị chồng thời gian trong cùng lớp', async (context) => {
  context.after(async () => {
    await db.delete(academicAdvisorAssignments)
    await db.delete(studentProfiles)
    await db.delete(academicClasses)
    await db.delete(faculties)
    await db.delete(users)
    await databaseClient.end()
  })

  const [faculty] = await db
    .insert(faculties)
    .values({
      code: 'ORG-TEST',
      name: 'Khoa kiểm thử',
    })
    .returning({ id: faculties.id })
  assert.ok(faculty)

  const [academicClass] = await db
    .insert(academicClasses)
    .values({
      facultyId: faculty.id,
      code: 'ORG-TEST-K1',
      name: 'Lớp kiểm thử K1',
    })
    .returning({ id: academicClasses.id })
  assert.ok(academicClass)

  const advisorRows = await db
    .insert(users)
    .values([
      {
        username: 'schema.advisor.1',
        fullName: 'Cố vấn 1',
        status: 'ACTIVE',
      },
      {
        username: 'schema.advisor.2',
        fullName: 'Cố vấn 2',
        status: 'ACTIVE',
      },
    ])
    .returning({ id: users.id })

  const firstAdvisor = advisorRows[0]
  const secondAdvisor = advisorRows[1]
  assert.ok(firstAdvisor)
  assert.ok(secondAdvisor)

  await db.insert(academicAdvisorAssignments).values({
    advisorUserId: firstAdvisor.id,
    classId: academicClass.id,
    validFrom: new Date('2026-01-01T00:00:00.000Z'),
    validTo: new Date('2026-06-01T00:00:00.000Z'),
    status: 'ACTIVE',
  })

  await assert.rejects(
    db.insert(academicAdvisorAssignments).values({
      advisorUserId: secondAdvisor.id,
      classId: academicClass.id,
      validFrom: new Date('2026-05-01T00:00:00.000Z'),
      validTo: new Date('2026-12-01T00:00:00.000Z'),
      status: 'ACTIVE',
    }),
    (error: unknown) => {
      const postgresError = findPostgresError(error)

      assert.ok(postgresError)
      assert.equal(postgresError['code'], '23P01')
      assert.equal(
        postgresError['constraint_name'],
        'academic_advisor_assignments_no_overlapping_active',
      )
      return true
    },
  )

  await db.insert(academicAdvisorAssignments).values({
    advisorUserId: secondAdvisor.id,
    classId: academicClass.id,
    validFrom: new Date('2026-06-01T00:00:00.000Z'),
    validTo: new Date('2026-12-01T00:00:00.000Z'),
    status: 'ACTIVE',
  })

  await db.insert(academicAdvisorAssignments).values({
    advisorUserId: firstAdvisor.id,
    classId: academicClass.id,
    validFrom: new Date('2026-12-01T00:00:00.000Z'),
    validTo: null,
    status: 'ACTIVE',
  })

  await assert.rejects(
    db.insert(academicAdvisorAssignments).values({
      advisorUserId: secondAdvisor.id,
      classId: academicClass.id,
      validFrom: new Date('2027-01-01T00:00:00.000Z'),
      validTo: new Date('2027-06-01T00:00:00.000Z'),
      status: 'ACTIVE',
    }),
    (error: unknown) => {
      const postgresError = findPostgresError(error)

      assert.equal(postgresError?.['code'], '23P01')
      return true
    },
  )
})
