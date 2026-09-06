import assert from 'node:assert/strict'
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
  academicClasses,
  faculties,
  organizationalUnits,
} from '../organizations/organization.schema.js'
import {
  authorizationScopes,
  userRoleScopes,
} from './authorization.schema.js'

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

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === 'object'
    && value !== null
}

function findPostgresError(
  error: unknown,
): Record<string, unknown> | null {
  let current = error

  while (isRecord(current)) {
    if (typeof current['code'] === 'string') {
      return current
    }

    current = current['cause']
  }

  return null
}

beforeEach(async () => {
  await db.delete(userRoleScopes)
  await db.delete(authorizationScopes)
  await db.delete(academicClasses)
  await db.delete(faculties)
  await db.delete(organizationalUnits)
})

after(async () => {
  await databaseClient.end()
})

test(
  'database chấp nhận bốn loại scope đúng target',
  async () => {
    const [faculty] = await db
      .insert(faculties)
      .values({
        code: 'SCOPE-FACULTY',
        name: 'Khoa kiểm thử scope',
      })
      .returning({ id: faculties.id })
    assert.ok(faculty)

    const [academicClass] = await db
      .insert(academicClasses)
      .values({
        facultyId: faculty.id,
        code: 'SCOPE-CLASS',
        name: 'Lớp kiểm thử scope',
      })
      .returning({ id: academicClasses.id })
    assert.ok(academicClass)

    const [unit] = await db
      .insert(organizationalUnits)
      .values({
        code: 'CTSV',
        name: 'Phòng Công tác sinh viên',
      })
      .returning({ id: organizationalUnits.id })
    assert.ok(unit)

    const insertedScopes = await db
      .insert(authorizationScopes)
      .values([
        { scopeType: 'GLOBAL' },
        {
          scopeType: 'FACULTY',
          facultyId: faculty.id,
        },
        {
          scopeType: 'CLASS',
          classId: academicClass.id,
        },
        {
          scopeType: 'ORGANIZATION',
          organizationalUnitId: unit.id,
        },
      ])
      .returning({
        scopeType:
          authorizationScopes.scopeType,
      })

    assert.deepEqual(
      insertedScopes.map(
        (scope) => scope.scopeType,
      ),
      [
        'GLOBAL',
        'FACULTY',
        'CLASS',
        'ORGANIZATION',
      ],
    )
  },
)

test(
  'database từ chối scope có target không khớp loại',
  async () => {
    await assert.rejects(
      db
        .insert(authorizationScopes)
        .values({
          scopeType: 'FACULTY',
        }),
      (error: unknown) => {
        const postgresError =
          findPostgresError(error)

        assert.equal(
          postgresError?.['code'],
          '23514',
        )
        assert.equal(
          postgresError?.['constraint_name'],
          'authorization_scopes_target_check',
        )
        return true
      },
    )
  },
)

test(
  'database chỉ cho một GLOBAL scope',
  async () => {
    await db
      .insert(authorizationScopes)
      .values({ scopeType: 'GLOBAL' })

    await assert.rejects(
      db
        .insert(authorizationScopes)
        .values({ scopeType: 'GLOBAL' }),
      (error: unknown) => {
        const postgresError =
          findPostgresError(error)

        assert.equal(
          postgresError?.['code'],
          '23505',
        )
        assert.equal(
          postgresError?.['constraint_name'],
          'authorization_scopes_global_unique',
        )
        return true
      },
    )
  },
)
