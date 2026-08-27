import {
  databaseClient,
  db,
} from './client.js'
import { services } from './schema.js'
import { SYSTEM_ROLES } from '../modules/auth/auth.constants.js'
import { roles } from '../modules/auth/auth.schema.js'

async function seed() {
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
  })
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