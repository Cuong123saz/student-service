import { randomUUID } from 'node:crypto'

import { env } from '../config/env.js'
import { databaseClient } from '../db/client.js'
import { createNodemailerTransport } from '../infrastructure/mail/nodemailer-transport.js'
import { DrizzleInvitationDeliveryJobRepository } from '../modules/users/invitation-delivery-job.repository.js'
import { InvitationDeliveryJobService } from '../modules/users/invitation-delivery-job.service.js'
import { SmtpInvitationMailer } from '../modules/users/smtp-invitation-mailer.js'

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
  const mailer = new SmtpInvitationMailer(createNodemailerTransport(), env.mailFrom)
  const service = new InvitationDeliveryJobService(
    new DrizzleInvitationDeliveryJobRepository(),
    mailer,
    env.webBaseUrl,
  )

  do {
    const processed = await service.processNext(workerId)

    if (runOnce) {
      break
    }
    if (!processed) {
      await delay(1_000)
    }
  } while (!stopping)
}

try {
  await run()
} catch (error: unknown) {
  console.error('Invitation worker failed', error)
  process.exitCode = 1
} finally {
  await databaseClient.end()
}
