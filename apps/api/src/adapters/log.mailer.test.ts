import { afterEach, describe, expect, it, vi } from "vitest";
import { LogMailer } from "./log.mailer.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LogMailer", () => {
  it("records a message that a local flow would have sent", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const mailer = new LogMailer();
    const message = { to: "vendor@example.test", subject: "ยืนยันอีเมล", html: "<p>ยืนยัน</p>", text: "ยืนยัน" };

    const result = await mailer.send(message);

    expect(result.messageId).toEqual(expect.any(String));
    expect(mailer.messages).toEqual([message]);
  });
});
