import { env } from '../config/env.js'

import { createNodemailerTransport } from '../infrastructure/mail/nodemailer-transport.js'

import { SmtpInvitationMailer } from '../modules/users/smtp-invitation-mailer.js'

async function sendTestInvitationEmail(): Promise<void> {
  const transport = createNodemailerTransport()

  const mailer = new SmtpInvitationMailer(transport, env.mailFrom)

  const activationUrl = new URL('/activate', env.webBaseUrl)

  activationUrl.searchParams.set('token', 'local-smoke-test-token')

  await mailer.sendActivationEmail({
    recipientEmail: 'student001@example.edu.vn',

    recipientName: 'Sinh viên kiểm thử',

    activationUrl: activationUrl.toString(),
  })

  console.log('Invitation email accepted by local SMTP server')
}

try {
  await sendTestInvitationEmail()
} catch (error: unknown) {
  console.error('Failed to send test invitation email', error)

  process.exitCode = 1
}
