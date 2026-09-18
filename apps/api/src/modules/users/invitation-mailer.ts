export interface SendActivationEmailInput {
  recipientEmail: string
  recipientName: string
  activationUrl: string
}

export interface InvitationMailer {
  sendActivationEmail(input: SendActivationEmailInput): Promise<void>
}
