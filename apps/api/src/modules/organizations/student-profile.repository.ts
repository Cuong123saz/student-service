import { and, eq, gt, isNull, lte, or } from 'drizzle-orm'

import { db } from '../../db/client.js'
import { roles, userRoles, users } from '../auth/auth.schema.js'
import {
  academicAdvisorAssignments,
  academicClasses,
  faculties,
  studentProfiles,
} from './organization.schema.js'

export interface StudentProfileView {
  userId: string
  username: string
  fullName: string
  email: string | null
  studentCode: string
  class: {
    id: string
    code: string
    name: string
  }
  faculty: {
    id: string
    code: string
    name: string
  }
}

export interface CurrentAdvisorView {
  userId: string
  username: string
  fullName: string
  email: string | null
  class: {
    id: string
    code: string
    name: string
  }
  validFrom: Date
  validTo: Date | null
}

export interface StudentProfileRepository {
  findStudentProfileByUserId(userId: string): Promise<StudentProfileView | null>

  findCurrentAdvisorForStudentUserId(userId: string, now: Date): Promise<CurrentAdvisorView | null>
}

export class DrizzleStudentProfileRepository implements StudentProfileRepository {
  async findStudentProfileByUserId(userId: string): Promise<StudentProfileView | null> {
    const rows = await db
      .select({
        userId: users.id,
        username: users.username,
        fullName: users.fullName,
        email: users.email,
        studentCode: studentProfiles.studentCode,
        classId: academicClasses.id,
        classCode: academicClasses.code,
        className: academicClasses.name,
        facultyId: faculties.id,
        facultyCode: faculties.code,
        facultyName: faculties.name,
      })
      .from(studentProfiles)
      .innerJoin(users, eq(studentProfiles.userId, users.id))
      .innerJoin(academicClasses, eq(studentProfiles.classId, academicClasses.id))
      .innerJoin(faculties, eq(academicClasses.facultyId, faculties.id))
      .where(eq(studentProfiles.userId, userId))
      .limit(1)

    const row = rows[0]

    if (!row) {
      return null
    }

    return {
      userId: row.userId,
      username: row.username,
      fullName: row.fullName,
      email: row.email,
      studentCode: row.studentCode,
      class: {
        id: row.classId,
        code: row.classCode,
        name: row.className,
      },
      faculty: {
        id: row.facultyId,
        code: row.facultyCode,
        name: row.facultyName,
      },
    }
  }

  async findCurrentAdvisorForStudentUserId(
    userId: string,
    now: Date,
  ): Promise<CurrentAdvisorView | null> {
    const rows = await db
      .select({
        userId: users.id,
        username: users.username,
        fullName: users.fullName,
        email: users.email,
        classId: academicClasses.id,
        classCode: academicClasses.code,
        className: academicClasses.name,
        validFrom: academicAdvisorAssignments.validFrom,
        validTo: academicAdvisorAssignments.validTo,
      })
      .from(studentProfiles)
      .innerJoin(academicClasses, eq(studentProfiles.classId, academicClasses.id))
      .innerJoin(
        academicAdvisorAssignments,
        eq(academicAdvisorAssignments.classId, academicClasses.id),
      )
      .innerJoin(users, eq(academicAdvisorAssignments.advisorUserId, users.id))
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(
        and(
          eq(studentProfiles.userId, userId),
          eq(academicAdvisorAssignments.status, 'ACTIVE'),
          lte(academicAdvisorAssignments.validFrom, now),
          or(
            isNull(academicAdvisorAssignments.validTo),
            gt(academicAdvisorAssignments.validTo, now),
          ),
          eq(users.status, 'ACTIVE'),
          eq(roles.code, 'ACADEMIC_ADVISOR'),
        ),
      )
      .limit(1)

    const row = rows[0]

    if (!row) {
      return null
    }

    return {
      userId: row.userId,
      username: row.username,
      fullName: row.fullName,
      email: row.email,
      class: {
        id: row.classId,
        code: row.classCode,
        name: row.className,
      },
      validFrom: row.validFrom,
      validTo: row.validTo,
    }
  }
}
