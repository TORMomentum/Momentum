import { randomUUID } from "node:crypto";
import type { MailMessage, Mailer } from "../ports/mailer.port.js";

/**
 * Captures local delivery instead of pretending an unconfigured SMTP service
 * accepted a message. The record lets flow tests inspect the exact email while
 * the log remains safe to retain.
 */
export class LogMailer implements Mailer {
  readonly messages: MailMessage[] = [];

  async send(message: MailMessage): Promise<{ messageId: string }> {
    this.messages.push({ ...message });
    const messageId = randomUUID();
    console.log(JSON.stringify({ event: "mail_recorded", outcome: "recorded", subject: message.subject, recipient: "[redacted]" }));
    return { messageId };
  }
}
