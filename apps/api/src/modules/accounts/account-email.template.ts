import type { MailMessage } from "../../ports/mailer.port.js";

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function message(to: string, subject: string, heading: string, detail: string, url: string): MailMessage {
  const safeUrl = escapeHtml(url);
  return { to, subject, text: `${heading}\n\n${detail}\n${url}`, html: `<!doctype html><html lang="th"><body><h1>${heading}</h1><p>${detail}</p><p><a href="${safeUrl}">ดำเนินการต่อ</a></p><p>${safeUrl}</p></body></html>` };
}

export function verificationEmail(to: string, url: string): MailMessage {
  return message(to, "ยืนยันอีเมล TOR Radar", "ยืนยันอีเมล", "โปรดยืนยันอีเมลเพื่อเริ่มใช้งาน TOR Radar", url);
}

export function passwordResetEmail(to: string, url: string): MailMessage {
  return message(to, "ตั้งรหัสผ่านใหม่ TOR Radar", "ตั้งรหัสผ่านใหม่", "หากคุณขอเปลี่ยนรหัสผ่าน โปรดใช้ลิงก์นี้", url);
}

/**
 * Sent when someone registers an address that already has a verified account.
 * It exists so registration does the same amount of work either way — the reply
 * must not reveal whether the address is known — and it is also the only way
 * the real owner learns that someone tried.
 */
export function accountAlreadyExistsEmail(to: string, url: string): MailMessage {
  return message(
    to,
    "มีบัญชี TOR Radar ด้วยอีเมลนี้อยู่แล้ว",
    "มีบัญชีอยู่แล้ว",
    "มีผู้พยายามสมัครสมาชิกด้วยอีเมลนี้ หากเป็นคุณ โปรดเข้าสู่ระบบตามปกติ หากไม่ใช่ คุณไม่ต้องดำเนินการใด",
    url,
  );
}
