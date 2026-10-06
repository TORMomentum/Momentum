import type { Config } from "../core/config.js";
import type { Mailer } from "../ports/mailer.port.js";
import { LogMailer } from "./log.mailer.js";
import { SmtpMailer } from "./smtp.mailer.js";

/**
 * The composition boundary prevents deployment from accepting reset requests
 * when it has nowhere to send them, while keeping local flows usable without
 * SMTP credentials.
 */
export function createMailer(config: Config): Mailer {
  if (config.mail.smtpUrl) {
    return new SmtpMailer({
      url: config.mail.smtpUrl,
      from: config.mail.from,
      timeoutMs: config.mail.timeoutMs,
    });
  }

  if (config.nodeEnv === "production") {
    throw new Error("SMTP_URL is required in production");
  }

  return new LogMailer();
}
