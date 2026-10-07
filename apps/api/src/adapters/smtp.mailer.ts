import nodemailer, { type Transporter } from "nodemailer";
import type { MailMessage, Mailer } from "../ports/mailer.port.js";

export interface SmtpMailerSettings {
  url: string;
  from: string;
  timeoutMs: number;
}

/**
 * SMTP is isolated here so email-producing features neither know provider
 * details nor accidentally log a vendor address or message body on failure.
 */
export class SmtpMailer implements Mailer {
  private readonly transport: Transporter;

  constructor(
    private readonly settings: SmtpMailerSettings,
    transport?: Transporter,
  ) {
    this.transport = transport ?? nodemailer.createTransport({
      url: settings.url,
      connectionTimeout: settings.timeoutMs,
      greetingTimeout: settings.timeoutMs,
      socketTimeout: settings.timeoutMs,
    });
  }

  async send(message: MailMessage): Promise<{ messageId: string }> {
    try {
      const result = await this.transport.sendMail({
        from: this.settings.from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
      });
      console.log(JSON.stringify({ event: "mail_sent", outcome: "sent", messageId: result.messageId }));
      return { messageId: result.messageId };
    } catch (error) {
      console.error(JSON.stringify({ event: "mail_sent", outcome: "failed" }));
      throw error;
    }
  }
}
