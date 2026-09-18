import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  SmtpInvitationMailer,
  type MailMessage,
  type MailTransport,
} from './smtp-invitation-mailer.js'

class FakeMailTransport implements MailTransport {
  sentMessage: MailMessage | undefined

  async sendMail(message: MailMessage): Promise<void> {
    this.sentMessage = message
  }
}

test('gửi email kích hoạt tới đúng người nhận và chứa activation URL', async () => {
  const transport = new FakeMailTransport()

  const mailer = new SmtpInvitationMailer(transport, 'no-reply@student-service.local')

  const activationUrl = 'http://localhost:3001/activate?token=secret-token'

  await mailer.sendActivationEmail({
    recipientEmail: 'student001@example.edu.vn',
    recipientName: 'Nguyễn Văn A',
    activationUrl,
  })

  const sentMessage = transport.sentMessage

  assert.ok(sentMessage)

  assert.equal(sentMessage.from, 'no-reply@student-service.local')

  assert.equal(sentMessage.to, 'student001@example.edu.vn')

  assert.match(sentMessage.subject, /Kích hoạt tài khoản/)

  assert.match(sentMessage.text, /Nguyễn Văn A/)

  assert.match(sentMessage.text, /72 giờ/)

  assert.equal(sentMessage.text.includes(activationUrl), true)
})
