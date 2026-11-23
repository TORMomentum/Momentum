import type { SourceHealthDocument } from "../../core/db.js";

/** Every value here is ours or a source's error message; the message is untrusted, so all of it is escaped. */
function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const HEADLINES = {
  failing: "ล้มเหลวต่อเนื่อง",
  stale: "ไม่ได้อัปเดตเกินกำหนด",
  recovered: "กลับมาปกติแล้ว",
} as const;

export interface SourceAlertInput {
  source: string;
  event: keyof typeof HEADLINES;
  record: Pick<SourceHealthDocument, "lastSeenAt" | "lastSuccessAt" | "lastFailureAt" | "lastError" | "consecutiveFailures">;
  settings: { alertFailures: number; staleHours: number };
  pageUrl: string;
  timeZone: string;
  now: Date;
}

/** The admin alert (TOR-294, spec 2026-11-24-source-health §5): plain, and readable as text alone. */
export function renderSourceAlert(input: SourceAlertInput): { subject: string; html: string; text: string } {
  const when = (date: Date | null) =>
    date ? new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: input.timeZone }).format(date) : "—";
  const { record, settings } = input;
  const subject =
    input.event === "recovered"
      ? `[TOR Radar] แหล่งข้อมูลกลับมาปกติ: ${input.source}`
      : `[TOR Radar] แหล่งข้อมูลมีปัญหา: ${input.source}`;
  const why =
    input.event === "failing"
      ? `ดึงข้อมูลล้มเหลวติดกัน ${record.consecutiveFailures} ครั้ง (เกณฑ์ ${settings.alertFailures} ครั้ง)`
      : input.event === "stale"
        ? `ไม่มีสัญญาณจากตัวดึงข้อมูลเกิน ${settings.staleHours} ชั่วโมง — ตัวดึงข้อมูลอาจหยุดทำงาน`
        : "ดึงข้อมูลสำเร็จอีกครั้ง ไม่ต้องดำเนินการต่อ";
  const lines: Array<[string, string]> = [
    ["สถานะ", HEADLINES[input.event]],
    ["สาเหตุ", why],
    ["สำเร็จล่าสุด", when(record.lastSuccessAt)],
    ["ล้มเหลวล่าสุด", when(record.lastFailureAt)],
    ["ข้อความผิดพลาดล่าสุด", record.lastError ?? "—"],
    ["มีสัญญาณล่าสุด", when(record.lastSeenAt)],
  ];
  const text = [
    `${input.source}: ${HEADLINES[input.event]}`,
    "",
    ...lines.map(([label, value]) => `${label}: ${value}`),
    "",
    `ดูสถานะทุกแหล่งข้อมูล: ${input.pageUrl}`,
    `ส่งเมื่อ ${when(input.now)}`,
  ].join("\n");
  const rows = lines
    .map(([label, value]) => `<tr><td style="padding:4px 12px 4px 0;color:#64748b;vertical-align:top">${escapeHtml(label)}</td><td style="padding:4px 0;color:#0f172a">${escapeHtml(value)}</td></tr>`)
    .join("");
  const html = `<!doctype html><html lang="th"><body style="margin:0;padding:24px;background:#f1f5f9;font-family:Tahoma,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px">
<tr><td style="padding:20px 24px;background:#0f172a;color:#ffffff;font-weight:bold">TOR RADAR · แหล่งข้อมูล</td></tr>
<tr><td style="padding:24px">
<h1 style="margin:0 0 16px;font-size:20px;color:${input.event === "recovered" ? "#166534" : "#b91c1c"}">${escapeHtml(input.source)}: ${escapeHtml(HEADLINES[input.event])}</h1>
<table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px">${rows}</table>
<p style="margin:24px 0 0"><a href="${escapeHtml(input.pageUrl)}" style="display:inline-block;padding:10px 18px;background:#1d4ed8;color:#ffffff;text-decoration:none;border-radius:6px">ดูสถานะทุกแหล่งข้อมูล →</a></p>
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b">ส่งถึงผู้ดูแลระบบทุกคน · ส่งเมื่อ ${escapeHtml(when(input.now))}</td></tr>
</table></body></html>`;
  return { subject, html, text };
}
