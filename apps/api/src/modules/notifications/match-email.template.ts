/**
 * The match email (FR-C-2, F10). Ported from the "Match Email" screen of
 * mockups/TOR Radar App.dc.html.
 *
 * Written as email HTML, not as web HTML, which is why it looks dated next to
 * the app: tables instead of flexbox, every style inline, no web fonts, no
 * `<style>` block. Gmail strips `<style>` in some clients, Outlook renders with
 * Word's engine and ignores flexbox and border-radius, and neither loads a
 * font. A layout that survives those is the one that reaches the vendor.
 *
 * A plain-text alternative is produced alongside the HTML, because a message
 * with no text part scores as spam and cannot be read by a screen reader that
 * refuses HTML.
 */

/** Everything about one matched TOR that the email shows. */
export interface MatchedTor {
  /** The public reference, e.g. TOR-2569-0812-041. */
  reference: string;
  title: string;
  agency: string;
  /** Budget in baht. Null when the TOR states none — the line then says so. */
  budgetThb: number | null;
  /** Submission deadline, or null when the announcement states none. */
  deadline: Date | null;
  /** 0–100, the vendor's match score for this TOR (FR-C-1). */
  matchPercent: number;
  /** Why it matched — the vendor's own profile terms, at most three (FR-C-2). */
  reasons: string[];
  /** Absolute link to the TOR detail page. */
  url: string;
}

export interface MatchEmailInput {
  /** The vendor's display name, used once in the greeting. */
  vendorName: string;
  /** The threshold this vendor set, shown so the email explains itself. */
  minMatchPercent: number;
  tors: MatchedTor[];
  /** Where "ตั้งค่าการแจ้งเตือน" and "ยกเลิกการรับอีเมล" point (PDPA, FR-D-3). */
  settingsUrl: string;
  unsubscribeUrl: string;
  /** Injected so the rendered output is deterministic in tests. */
  now?: Date;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Hex only, no rgba(): Outlook's Word engine drops colours it cannot parse, and
 * a dropped colour is black text on a black band. These are the app's tokens
 * flattened against white.
 */
const BRAND = {
  ink: "#12233c",
  ink70: "#5b6879",
  ink60: "#6b7789",
  line: "#dfe4ec",
  lineSoft: "#eef1f6",
  blue: "#1d63d8",
  blueDark: "#1746a0",
  blueWash: "#eef3fc",
  match: "#2b6e5a",
  matchWash: "#e8f2ee",
  urgent: "#b45309",
  urgentWash: "#fdf3e7",
  navy: "#12233c",
  paper: "#ffffff",
  page: "#eef1f6",
  footer: "#f7f9fc",
};

/** A deadline closer than this gets the amber treatment. */
const URGENT_DAYS = 7;

/** No web fonts in email; name what Thai systems actually have installed. */
const FONT = "'IBM Plex Sans Thai', 'Noto Sans Thai', 'Leelawadee UI', Tahoma, sans-serif";
const MONO = "'IBM Plex Mono', Consolas, monospace";

/**
 * Every date in this product is a Thai calendar date: the announcement said
 * "25 ส.ค." and the vendor's deadline is that day in Bangkok, whatever the
 * server's clock is set to. Formatting with the local-time getters printed one
 * day earlier on a UTC host — which CI is, and so is every deployment.
 */
const DISPLAY_TIME_ZONE = "Asia/Bangkok";

const THAI_MONTHS = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Every value below is extracted by AI from a document this system did not
 * write, so all of it is untrusted input. Escaping here, at the single point
 * where it becomes markup, is what keeps a crafted TOR title from injecting
 * into a vendor's mail client.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Buddhist-era, in Bangkok time, matching every date shown in the interface. */
export function formatThaiDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: DISPLAY_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(date);

  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");

  return `${value("day")} ${THAI_MONTHS[value("month") - 1]} ${value("year") + 543}`;
}

export function formatBaht(amount: number): string {
  return `฿${amount.toLocaleString("en-US")}`;
}

/**
 * "ยื่นภายใน 25 ส.ค. 2569 · เหลือ 13 วัน" — the day count is why a vendor opens
 * the mail at all, so it is returned separately and gets its own emphasis.
 */
function deadlineParts(deadline: Date | null, now: Date): { date: string; remaining: string; urgent: boolean } {
  if (!deadline) return { date: "ไม่ระบุวันยื่นในประกาศ", remaining: "", urgent: false };
  const days = Math.ceil((deadline.getTime() - now.getTime()) / MS_PER_DAY);
  const date = `ยื่นภายใน ${formatThaiDate(deadline)}`;
  if (days < 0) return { date, remaining: "ปิดรับแล้ว", urgent: false };
  if (days === 0) return { date, remaining: "วันนี้", urgent: true };
  return { date, remaining: `เหลือ ${days} วัน`, urgent: days <= URGENT_DAYS };
}

/** The score as a bar. Tables, because no email client can be trusted with a div width. */
function matchMeter(percent: number): string {
  const filled = Math.max(0, Math.min(100, Math.round(percent)));
  return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px">
        <tr>
          <td width="${filled}%" bgcolor="${BRAND.match}" style="background:${BRAND.match};height:4px;line-height:4px;font-size:0">&nbsp;</td>
          <td width="${100 - filled}%" bgcolor="${BRAND.lineSoft}" style="background:${BRAND.lineSoft};height:4px;line-height:4px;font-size:0">&nbsp;</td>
        </tr>
      </table>`;
}

/** Each reason as its own bordered chip, the way the profile screen shows skills. */
function reasonChips(reasons: string[]): string {
  return reasons
    .slice(0, 3)
    .map(
      (reason) =>
        `<span style="display:inline-block;font-family:${FONT};font-size:11px;color:${BRAND.match};background:${BRAND.matchWash};border:1px solid #cfe2da;border-radius:3px;padding:4px 9px;margin:0 6px 6px 0">✓ ${escapeHtml(reason)}</span>`,
    )
    .join("");
}

function torCard(tor: MatchedTor, now: Date, primary: boolean): string {
  const deadline = deadlineParts(tor.deadline, now);
  const chips = reasonChips(tor.reasons);

  const button = primary
    ? `background:${BRAND.blue};color:#ffffff;border:1px solid ${BRAND.blue}`
    : `background:${BRAND.paper};color:${BRAND.blue};border:1px solid #c3d3ee`;

  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
         style="border:1px solid ${BRAND.line};border-radius:8px;margin-bottom:16px;background:${BRAND.paper}">
    <tr>
      <!-- A colour rail instead of a coloured card: it survives clients that drop
           background-color, and it ranks the two matches at a glance. -->
      <td width="4" bgcolor="${primary ? BRAND.match : BRAND.line}" style="width:4px;background:${primary ? BRAND.match : BRAND.line};font-size:0;line-height:0">&nbsp;</td>
      <td style="padding:20px 22px">

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="font-family:${MONO};font-size:10px;color:${BRAND.ink60};letter-spacing:.06em">${escapeHtml(tor.reference)}</td>
            <td align="right" style="font-family:${MONO};font-size:11px;font-weight:600;color:${BRAND.match}">ตรงกับโปรไฟล์ ${tor.matchPercent}%</td>
          </tr>
        </table>
        ${matchMeter(tor.matchPercent)}

        <div style="font-family:${FONT};font-size:16px;font-weight:600;line-height:1.55;color:${BRAND.ink};margin:16px 0 12px">
          ${escapeHtml(tor.title)}
        </div>

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:14px">
          <tr>
            <td width="50%" valign="top" style="font-family:${FONT};font-size:11px;color:${BRAND.ink60};padding-bottom:4px">งบประมาณ</td>
            <td width="50%" valign="top" style="font-family:${FONT};font-size:11px;color:${BRAND.ink60};padding-bottom:4px">กำหนดยื่น</td>
          </tr>
          <tr>
            <td valign="top" style="font-family:${MONO};font-size:17px;font-weight:600;color:${BRAND.ink};line-height:1.3">
              ${tor.budgetThb === null ? `<span style="font-family:${FONT};font-size:13px;color:${BRAND.ink70}">ไม่ระบุ</span>` : formatBaht(tor.budgetThb)}
            </td>
            <td valign="top" style="font-family:${FONT};font-size:13px;color:${BRAND.ink};line-height:1.5">
              ${deadline.date.replace("ยื่นภายใน ", "")}
              ${
                deadline.remaining
                  ? `<br><span style="display:inline-block;margin-top:4px;font-family:${MONO};font-size:10px;font-weight:600;color:${deadline.urgent ? BRAND.urgent : BRAND.ink60};background:${deadline.urgent ? BRAND.urgentWash : BRAND.lineSoft};border-radius:3px;padding:3px 7px">${deadline.remaining}</span>`
                  : ""
              }
            </td>
          </tr>
        </table>

        <div style="font-family:${FONT};font-size:12.5px;color:${BRAND.ink70};line-height:1.7;padding-bottom:14px;border-bottom:1px solid ${BRAND.lineSoft}">
          ${escapeHtml(tor.agency)}
        </div>

        ${
          chips
            ? `<div style="padding-top:14px">
          <div style="font-family:${MONO};font-size:9.5px;color:${BRAND.ink60};letter-spacing:.1em;margin-bottom:8px">ทำไมงานนี้ตรงกับคุณ</div>
          ${chips}
        </div>`
            : ""
        }

        <div style="margin-top:16px">
          <a href="${escapeHtml(tor.url)}"
             style="display:inline-block;font-family:${FONT};font-size:13px;font-weight:600;text-decoration:none;padding:11px 22px;border-radius:5px;${button}">
            ดูรายละเอียด TOR →
          </a>
        </div>

      </td>
    </tr>
  </table>`;
}

/** The same deadline, flattened for the plain-text part. */
function textDeadline(deadline: Date | null, now: Date): string {
  const parts = deadlineParts(deadline, now);
  return parts.remaining ? `${parts.date} (${parts.remaining})` : parts.date;
}

/** "TOR ใหม่ 2 รายการตรงกับทักษะของคุณ" — Thai has no plural form to vary. */
export function matchSubject(count: number): string {
  return `TOR ใหม่ ${count} รายการตรงกับทักษะของคุณ`;
}

export function renderMatchEmail(input: MatchEmailInput): RenderedEmail {
  const now = input.now ?? new Date();
  const tors = input.tors;

  const html = `<!doctype html>
<html lang="th">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(matchSubject(tors.length))}</title></head>
<body style="margin:0;padding:0;background:${BRAND.page}">

<!-- The line the inbox shows beside the subject. Hidden in the message itself,
     and followed by spacers so the client does not pad it with body text. -->
<div style="display:none;font-size:1px;color:${BRAND.page};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">
  ${tors.length ? `${escapeHtml(tors[0].agency)} · ${tors[0].budgetThb === null ? "ไม่ระบุงบประมาณ" : formatBaht(tors[0].budgetThb)} · ตรงกับโปรไฟล์ ${tors[0].matchPercent}%` : ""}
  ${"&#847;&zwnj;&nbsp;".repeat(60)}
</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.page}">
  <tr><td align="center" style="padding:28px 12px">

    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
           style="width:600px;max-width:100%;background:${BRAND.paper};border:1px solid ${BRAND.line};border-radius:10px">

      <!-- Masthead. The dark band is the only place the brand shouts; everything
           below it stays quiet so the TOR titles carry the page. -->
      <tr><td bgcolor="${BRAND.navy}" style="background:${BRAND.navy};padding:22px 26px;border-radius:10px 10px 0 0">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="font-family:${FONT};font-size:15px;font-weight:700;color:#ffffff;letter-spacing:.04em">TOR RADAR</td>
            <td align="right" style="font-family:${MONO};font-size:9.5px;color:#93a4bd;letter-spacing:.08em">ส่งภายใน 5 นาทีหลังประกาศ</td>
          </tr>
        </table>
      </td></tr>

      <tr><td style="padding:26px 26px 4px">
        <div style="font-family:${FONT};font-size:19px;font-weight:700;color:${BRAND.ink};line-height:1.5">
          มี TOR ใหม่ ${tors.length} รายการที่ตรงกับทักษะของคุณ
        </div>
        <div style="font-family:${FONT};font-size:13px;color:${BRAND.ink70};line-height:1.8;margin-top:8px">
          สวัสดี${escapeHtml(input.vendorName)} — คัดจากประกาศที่เผยแพร่วันนี้ ตามเกณฑ์ขั้นต่ำ ${input.minMatchPercent}% ที่คุณตั้งไว้
        </div>
      </td></tr>

      <tr><td style="padding:22px 26px 0">
        ${tors.map((tor, index) => torCard(tor, now, index === 0)).join("\n")}
      </td></tr>

      <tr><td style="padding:6px 26px 26px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
               style="background:${BRAND.blueWash};border:1px solid #d6e2f7;border-radius:6px">
          <tr><td style="padding:14px 16px;font-family:${FONT};font-size:11.5px;color:${BRAND.ink70};line-height:1.8">
            ข้อมูลสกัดโดย AI จากประกาศสาธารณะ และแสดงตามที่สกัดได้ —
            <strong style="color:${BRAND.ink};font-weight:600">ตรวจสอบกับเอกสารต้นฉบับก่อนยื่นข้อเสนอเสมอ</strong>
          </td></tr>
        </table>
      </td></tr>

      <tr><td bgcolor="${BRAND.footer}" style="padding:18px 26px;border-top:1px solid ${BRAND.line};background:${BRAND.footer};font-family:${MONO};font-size:10px;color:${BRAND.ink60};line-height:2;border-radius:0 0 10px 10px">
        TOR RADAR · แพลตฟอร์มอิสระ ไม่ใช่หน่วยงานราชการ<br>
        <a href="${escapeHtml(input.settingsUrl)}" style="color:${BRAND.blue};text-decoration:none">ตั้งค่าการแจ้งเตือน</a> ·
        <a href="${escapeHtml(input.unsubscribeUrl)}" style="color:${BRAND.blue};text-decoration:none">ยกเลิกการรับอีเมล</a> ·
        PDPA
      </td></tr>

    </table>

  </td></tr>
</table>
</body>
</html>`;

  const text = [
    `TOR RADAR`,
    ``,
    `สวัสดี${input.vendorName} — มี TOR ใหม่ ${tors.length} รายการที่ตรงกับทักษะในโปรไฟล์ของคุณ (เกณฑ์ขั้นต่ำ ${input.minMatchPercent}%)`,
    ``,
    ...tors.flatMap((tor) => [
      `[จับคู่ ${tor.matchPercent}%] ${tor.reference}`,
      tor.title,
      `${tor.agency} · ${tor.budgetThb === null ? "ไม่ระบุงบประมาณ" : formatBaht(tor.budgetThb)} · ${textDeadline(tor.deadline, now)}`,
      ...(tor.reasons.length ? [`ทำไมงานนี้ตรงกับคุณ: ${tor.reasons.slice(0, 3).join(", ")}`] : []),
      tor.url,
      ``,
    ]),
    `ข้อมูลสกัดโดย AI จากประกาศสาธารณะ — ตรวจสอบกับเอกสารต้นฉบับก่อนยื่นข้อเสนอเสมอ`,
    ``,
    `TOR RADAR · แพลตฟอร์มอิสระ ไม่ใช่หน่วยงานราชการ`,
    `ตั้งค่าการแจ้งเตือน: ${input.settingsUrl}`,
    `ยกเลิกการรับอีเมล: ${input.unsubscribeUrl}`,
  ].join("\n");

  return { subject: matchSubject(tors.length), html, text };
}
