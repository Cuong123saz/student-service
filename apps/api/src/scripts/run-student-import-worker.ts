import { randomUUID } from 'node:crypto'

import { databaseClient } from '../db/client.js'
import { DrizzleStudentImportPreviewStore } from '../modules/users/student-import-preview.repository.js'
import { DrizzleStudentImportProcessingJobRepository } from '../modules/users/student-import-processing-job.repository.js'
import { StudentImportProcessingJobService } from '../modules/users/student-import-processing-job.service.js'
import { DrizzleStudentImportRepository } from '../modules/users/student-import.repository.js'
import { StudentImportService } from '../modules/users/student-import.service.js'

const workerId = randomUUID()
const runOnce = process.argv.includes('--once')
let stopping = false

process.once('SIGINT', () => {
  stopping = true
})
process.once('SIGTERM', () => {
  stopping = true
})

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds)
  })
}

async function run() {
  const importService = new StudentImportService(
    new DrizzleStudentImportRepository(),
    new DrizzleStudentImportPreviewStore(),
  )
  const service = new StudentImportProcessingJobService(
    new DrizzleStudentImportProcessingJobRepository(),
    importService,
  )

  do {
    const processed = await service.processNext(workerId)
    if (runOnce) break
    if (!processed) await delay(1_000)
  } while (!stopping)
}

try {
  await run()
} catch (error: unknown) {
  console.error('Student import worker failed', error)
  process.exitCode = 1
} finally {
  await databaseClient.end()
}
