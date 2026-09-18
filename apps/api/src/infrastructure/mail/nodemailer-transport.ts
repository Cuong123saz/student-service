import nodemailer from 'nodemailer'

import { env } from '../../config/env.js'

import type { MailTransport } from '../../modules/users/smtp-invitation-mailer.js'

export function createNodemailerTransport(): MailTransport {
  const transporter = nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpSecure,

    connectionTimeout: 5_000,
    greetingTimeout: 5_000,
    socketTimeout: 10_000,

    // Email của hệ thống không được tự ý
    // đọc file hoặc tải nội dung từ URL.
    disableFileAccess: true,
    disableUrlAccess: true,
  })

  return {
    async sendMail(message) {
      return transporter.sendMail(message)
    },
  }
}
