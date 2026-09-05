import type {
  InvitationMailer,
  SendActivationEmailInput,
} from './invitation-mailer.js'

export interface MailMessage {
  from: string
  to: string
  subject: string
  text: string
}

export interface MailTransport {
  sendMail(
    message: MailMessage,
  ): Promise<unknown>
}

export class SmtpInvitationMailer
implements InvitationMailer {
  constructor(
    private readonly transport:
      MailTransport,

    private readonly fromAddress:
      string,
  ) {}

  async sendActivationEmail(
    input: SendActivationEmailInput,
  ): Promise<void> {
    await this.transport.sendMail({
      from: this.fromAddress,
      to: input.recipientEmail,
      subject:
        'Kích hoạt tài khoản Cổng Dịch vụ Sinh viên',
      text: [
        `Xin chào ${input.recipientName},`,
        '',
        'Tài khoản của bạn đã được tạo.',
        '',
        'Vui lòng mở liên kết sau để đặt mật khẩu và kích hoạt tài khoản:',
        input.activationUrl,
        '',
        'Liên kết có hiệu lực trong 72 giờ và chỉ được sử dụng một lần.',
        '',
        'Nếu bạn không mong đợi email này, vui lòng bỏ qua.',
      ].join('\n'),
    })
  }
}