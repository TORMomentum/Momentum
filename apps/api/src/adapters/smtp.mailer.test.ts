import nodemailer, { type Transporter } from "nodemailer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLogSink } from "../core/logger.js";
import { SmtpMailer } from "./smtp.mailer.js";

vi.mock("nodemailer", () => ({ default: { createTransport: vi.fn() } }));

beforeEach(() => setLogSink(() => {}));
afterEach(() => {
  setLogSink();
  vi.restoreAllMocks();
});

describe("SmtpMailer", () => {
  it("uses the configured sender and SMTP deadlines without opening a connection", async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: "smtp-message-1" });
    vi.mocked(nodemailer.createTransport).mockReturnValue({ sendMail } as unknown as Transporter);

    const mailer = new SmtpMailer({
      url: "smtp://mail.example.test",
      from: "TOR Radar <mail@tor-radar.example>",
      timeoutMs: 1_234,
    });

    await expect(mailer.send({ to: "vendor@example.test", subject: "หัวข้อ", html: "<p>เนื้อหา</p>", text: "เนื้อหา" }))
      .resolves.toEqual({ messageId: "smtp-message-1" });

    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      url: "smtp://mail.example.test",
      connectionTimeout: 1_234,
      greetingTimeout: 1_234,
      socketTimeout: 1_234,
    });
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: "TOR Radar <mail@tor-radar.example>",
      to: "vendor@example.test",
    }));
  });
});
