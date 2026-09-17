import { describe, expect, it } from "vitest";
import {
  addressFrom,
  formatBudgetShort,
  formatDeadline,
  thaiDigitsToArabic,
  timeWindowFrom,
  websiteFrom,
  withArabicDigits,
} from "./format";

describe("deadline formatting", () => {
  const raw = "วันที่ ๑๗ กันยายน ๒๕๖๙ ระหว่างเวลา ๐๙.๐๐ น. ถึง ๑๒.๐๐ น.";

  it("reads Thai digits as Arabic numerals", () => {
    expect(thaiDigitsToArabic("๐๙.๐๐ น. ถึง ๑๒.๓๐")).toBe("09.00 น. ถึง 12.30");
  });

  it("formats the date and the submission window from a real invitation's wording", () => {
    expect(formatDeadline("2026-09-17", raw)).toBe("17 ก.ย. 2569 · 09:00–12:00 น.");
  });

  it("uses the date part of a value that carries a time, without shifting the day", () => {
    expect(formatDeadline("2026-08-17T16:00:00", "๑๗ สิงหาคม ๒๕๖๙")).toBe("17 ส.ค. 2569");
  });

  it("reads a single time, and wording already in Arabic numerals", () => {
    expect(timeWindowFrom("ภายในเวลา 16.30 น.")).toBe("16:30 น.");
  });

  it("names no time when the wording states none", () => {
    expect(formatDeadline("2026-09-17", "๑๗ กันยายน ๒๕๖๙")).toBe("17 ก.ย. 2569");
  });

  it("formats nothing without a normalised date", () => {
    expect(formatDeadline(null, raw)).toBeNull();
    expect(formatDeadline("not a date", raw)).toBeNull();
  });
});

// Contact lines as the API publishes them (after redaction), from the collected corpus.
const WICHUTIT =
  "โรงเรียนวิชูทิศ ที่อยู่ 4095/1 ซอยประชาสงเคราะห์ 13 ถนนประชาสงเคราะห์ แขวงดินแดง เขตดินแดง กรุงเทพมหานคร 10400 โทรศัพท์ 0 2246 1551 โทรสาร 0 2246 1551 เว็บไซต์ www.wichutit.ac.th";
const KLANG =
  "โรงพยาบาลกลาง (ฝ่ายพัสดุ) สำนักงานตั้งอยู่ที่ ๕๑๔ ถนนหลวง แขวงป้อมปราบ เขตป้อมปราบศัตรูพ่าย กรุงเทพมหานคร รหัสไปรษณีย์ ๑๐๑๐๐ ทางเว็บไซต์ : http://www.klanghospital.go.th และ www.gprocurement.go.th ทาง e-mail :";
const TAKSIN_TYPO =
  "โรงพยาบาลตากสิน (หน่วยงานเวชภัณฑ์กลาง) สำนักงานตั้งอยู่ที ๕๔๓ ถนนสมเด็จเจ้าพระยา แขวงคลองสาน เขตคลองสาน กรุงเทพมหานคร รหัสไปรษณีย์ ๑๐๖๐๐";
const LIBRARY =
  "กลุ่มงานห้องสมุดและการเรียนรู้ ๑ ส่วนห้องสมุดและการเรียนรู้ สำนักวัฒนธรรม กีฬา และการท่องเที่ยว ชั้น ๑๓ สำนักงานเขตดินแดง เลขที่ ๑ ถนนประชาสงเคราะห์ แขวงดินแดง เขตดินแดง กรุงเทพมหานคร รหัสไปรษณีย์ ๑๐๔๐๐ หมายเลขโทรศัพท์ ๐๒ ๒๔๖ ๒๔๒๒ E-mail: x";
const PUBLIC_WORKS =
  "ศูนย์เครื่องมือกล ส่วนก่อสร้างและบูรณะ ๑ สำนักงานก่อสร้างและบูรณะ สำนักการโยธา ถนนมิตรไมตรี แขวงดินแดง เขตดินแดง กรุงเทพมหานคร โทรศัพท์ ๐ ๒๒๔๕ ๔๒๖๖";

describe("website from a contact line", () => {
  it("reads the first web address, adding a scheme to a bare www one", () => {
    expect(websiteFrom(WICHUTIT)).toBe("https://www.wichutit.ac.th");
    expect(websiteFrom(KLANG)).toBe("http://www.klanghospital.go.th");
    expect(websiteFrom("หรือเว็บไซต์ www.bangkok.go.th/thawiwatthana.")).toBe("https://www.bangkok.go.th/thawiwatthana");
  });

  it("keeps a Thai digit in the host name, as an Arabic one", () => {
    expect(websiteFrom("https://www.egp๒.bangkok.go.th หรือ www.gprocurement.go.th")).toBe(
      "https://www.egp2.bangkok.go.th",
    );
  });

  it("is null when the line states no web address", () => {
    expect(websiteFrom(TAKSIN_TYPO)).toBeNull();
    expect(websiteFrom("")).toBeNull();
    expect(websiteFrom(undefined)).toBeNull();
  });
});

describe("address from a contact line", () => {
  it("reads a labelled address up to the next part of the line", () => {
    expect(addressFrom(WICHUTIT)).toBe(
      "4095/1 ซอยประชาสงเคราะห์ 13 ถนนประชาสงเคราะห์ แขวงดินแดง เขตดินแดง กรุงเทพมหานคร 10400",
    );
    expect(addressFrom(KLANG)).toBe("514 ถนนหลวง แขวงป้อมปราบ เขตป้อมปราบศัตรูพ่าย กรุงเทพมหานคร รหัสไปรษณีย์ 10100");
  });

  it("reads the label as the document misspells it, and an address that ends the line", () => {
    expect(addressFrom(TAKSIN_TYPO)).toBe(
      "543 ถนนสมเด็จเจ้าพระยา แขวงคลองสาน เขตคลองสาน กรุงเทพมหานคร รหัสไปรษณีย์ 10600",
    );
  });

  it("starts an unlabelled address at its house number or road", () => {
    expect(addressFrom(LIBRARY)).toBe(
      "เลขที่ 1 ถนนประชาสงเคราะห์ แขวงดินแดง เขตดินแดง กรุงเทพมหานคร รหัสไปรษณีย์ 10400",
    );
    expect(addressFrom(PUBLIC_WORKS)).toBe("ถนนมิตรไมตรี แขวงดินแดง เขตดินแดง กรุงเทพมหานคร");
  });

  it("is null when the line names only an office", () => {
    expect(addressFrom("ฝ่ายการศึกษา สำนักงานเขตห้วยขวาง")).toBeNull();
    expect(addressFrom("โทรศัพท์หมายเลข ๐-๒๔๔๑-๔๙๗๓ ต่อ ๕๕๐๗ หรือเว็บไซต์ www.bangkok.go.th/thawiwatthana")).toBeNull();
    expect(addressFrom(undefined)).toBeNull();
  });
});

describe("API data in Arabic numerals", () => {
  it("converts every string, however deep, and leaves other values alone", () => {
    const data = {
      id: "6aaa7042673879f45a46815e",
      fields: { title: { raw: "จำนวน ๒ รายการ", value: "จำนวน ๒ รายการ", confidence: 0.9, verified: true } },
      qualifications: ["ไม่น้อยกว่า ๓ ปี", "ชั้น ๖"],
      budget: 7062000,
      announcedAt: null,
      unverified: false,
    };
    expect(withArabicDigits(data)).toEqual({
      ...data,
      fields: { title: { raw: "จำนวน 2 รายการ", value: "จำนวน 2 รายการ", confidence: 0.9, verified: true } },
      qualifications: ["ไม่น้อยกว่า 3 ปี", "ชั้น 6"],
    });
  });
});

describe("chart labels", () => {
  it("shortens budgets for axes", () => {
    expect(formatBudgetShort(0)).toBe("฿0");
    expect(formatBudgetShort(500_000)).toBe("฿500K");
    expect(formatBudgetShort(4_860_000)).toBe("฿4.9M");
    expect(formatBudgetShort(1_280_000_000)).toBe("฿1.3B");
  });
});
