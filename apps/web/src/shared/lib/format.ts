/**
 * Display formatting for values this system computed or normalised — never for
 * an extracted value, which is shown exactly as extracted (NFR-F7).
 *
 * Dates are Thai calendar dates in Bangkok, whatever the server's clock says:
 * formatting with local-time getters prints the previous day on a UTC host.
 * The API carries Gregorian ISO values; the Buddhist era is added here, in one
 * place (rendering spec §11).
 */
const DISPLAY_TIME_ZONE = "Asia/Bangkok";

const THAI_MONTHS = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];

function bangkokParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: DISPLAY_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "0";
  return {
    day: Number(value("day")),
    month: Number(value("month")),
    year: Number(value("year")),
    hour: value("hour").padStart(2, "0"),
    minute: value("minute").padStart(2, "0"),
  };
}

/** "11 ส.ค. 2569" */
export function formatThaiDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const { day, month, year } = bangkokParts(date);
  return `${day} ${THAI_MONTHS[month - 1]} ${year + 543}`;
}

/** "16 ก.ย. 2569 · 09:42" */
export function formatThaiDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const { day, month, year, hour, minute } = bangkokParts(date);
  return `${day} ${THAI_MONTHS[month - 1]} ${year + 543} · ${hour}:${minute}`;
}

/** "฿4,850,000" — a budget in full, as the search and detail screens show it. */
export function formatBaht(n: number): string {
  return "฿" + n.toLocaleString("en-US");
}

/** "฿1.3B" / "฿4.9M" / "฿500K" — for slider labels and chart axes, not for an extracted budget. */
export function formatBudgetShort(n: number): string {
  if (n === 0) return "฿0";
  if (n >= 1_000_000_000) {
    const billions = n / 1_000_000_000;
    return "฿" + billions.toFixed(n % 1_000_000_000 ? 1 : 0) + "B";
  }
  if (n >= 1_000_000) {
    const millions = n / 1_000_000;
    return "฿" + millions.toFixed(n % 1_000_000 ? 1 : 0) + "M";
  }
  return "฿" + Math.round(n / 1000) + "K";
}

const THAI_DIGITS = "๐๑๒๓๔๕๖๗๘๙";

/**
 * "๑๗" → "17". The site shows every number in Arabic numerals, whatever digits
 * the document used — a change of digit glyphs only; the words and the values
 * are left as extracted.
 */
export function thaiDigitsToArabic(text: string): string {
  return text.replace(/[๐-๙]/g, (digit) => String(THAI_DIGITS.indexOf(digit)));
}

/**
 * The same data with every string's Thai digits in Arabic numerals. Applied once,
 * where API data enters the web app, so no page has to remember it.
 */
export function withArabicDigits<T>(data: T): T {
  if (typeof data === "string") return thaiDigitsToArabic(data) as T;
  if (Array.isArray(data)) return data.map(withArabicDigits) as T;
  if (data !== null && typeof data === "object") {
    return Object.fromEntries(
      Object.entries(data).map(([key, value]) => [key, withArabicDigits(value)]),
    ) as T;
  }
  return data;
}

/**
 * The submission window as the document states it, e.g. "09:00–12:00 น.",
 * from wording such as "ระหว่างเวลา ๐๙.๐๐ น. ถึง ๑๒.๐๐ น.". Null when the
 * wording names no time.
 */
export function timeWindowFrom(raw: string): string | null {
  const times = [...thaiDigitsToArabic(raw).matchAll(/(\d{1,2})[.:](\d{2})\s*น/g)]
    .map(([, hour, minute]) => `${hour.padStart(2, "0")}:${minute}`)
    .filter((time) => Number(time.slice(0, 2)) < 24 && Number(time.slice(3)) < 60);
  if (times.length === 0) return null;
  return `${times.length > 1 ? `${times[0]}–${times[times.length - 1]}` : times[0]} น.`;
}

/**
 * A deadline in the interface's own format — "17 ก.ย. 2569 · 09:00–12:00 น." —
 * built from the normalised date and the time the wording states. It sits
 * beside the extracted wording, which is still shown exactly as extracted
 * (NFR-F7); it never replaces it. Null when there is no date to format.
 */
export function formatDeadline(value: string | null | undefined, raw: string): string | null {
  const parts = deadlineParts(value, raw);
  if (!parts) return null;
  return parts.window ? `${parts.date} · ${parts.window}` : parts.date;
}

/** The same deadline as a date and a time window, for layouts that set them on separate lines. */
export function deadlineParts(
  value: string | null | undefined,
  raw: string,
): { date: string; window: string | null } | null {
  const day = value?.slice(0, 10);
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const date = formatThaiDate(`${day}T00:00:00Z`);
  if (!date) return null;
  return { date, window: timeWindowFrom(raw) };
}

const WEBSITE = /\b(?:https?:\/\/|www\.)[^\s,;()<>"'\u0E00-\u0E7F]+/i;

/**
 * The first web address a contact line states, as an https-safe href, or null.
 * Read from the contact text as published — after redaction, which keeps
 * government URLs and removes email addresses. Thai digits in a host name
 * ("egp๒.bangkok.go.th") are read as Arabic, so the address is not cut short.
 */
export function websiteFrom(text: string | null | undefined): string | null {
  const match = text ? thaiDigitsToArabic(text).match(WEBSITE)?.[0].replace(/[.]+$/, "") : undefined;
  if (!match) return null;
  return /^https?:\/\//i.test(match) ? match : `https://${match}`;
}

// A label that introduces an address; the address is what follows it.
const ADDRESS_LABEL = /(?:ที่อยู่|ตั้งอยู่ที่?)\s*:?\s*/;
// Without a label, an address starts at its house number or its road.
const ADDRESS_START = /เลขที่\s*\d|ถนน|ซอย/;
// Where the address ends: the next part of the contact line.
const ADDRESS_END =
  /\s*(?:(?:ทาง|หรือ)\s*)?(?:(?:หมายเลข)?โทรศัพท์|โทรสาร|โทร|แฟกซ์|เว็บไซต์|อีเมล|e-?mail|https?:\/\/|www\.)/i;

/**
 * The address a TOR's contact section states, in Arabic numerals, or null.
 * Contact sections are written as "<office> สำนักงานตั้งอยู่ที่ <address> ทางเว็บไซต์ …"
 * or "<office> ถนน… แขวง… โทรศัพท์ …"; the words of the address are kept as written.
 */
export function addressFrom(text: string | null | undefined): string | null {
  if (!text) return null;
  const line = thaiDigitsToArabic(text);
  const label = line.match(ADDRESS_LABEL);
  const start = label?.index !== undefined ? label.index + label[0].length : line.search(ADDRESS_START);
  if (start < 0) return null;
  const rest = line.slice(start);
  const end = rest.search(ADDRESS_END);
  const address = (end < 0 ? rest : rest.slice(0, end)).replace(/[\s,:;]+$/, "");
  return address || null;
}
