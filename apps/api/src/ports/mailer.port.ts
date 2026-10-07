/**
 * Outbound email boundary. Authentication and match delivery need the same
 * reliable result, while tests and local development must exercise those flows
 * without an SMTP server or exposing recipients in application logs.
 */
export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<{ messageId: string }>;
}
