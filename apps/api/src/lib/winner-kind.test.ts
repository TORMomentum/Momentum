import { describe, expect, it } from "vitest";
import { winnerKindOf } from "./winner-kind.js";

describe("winnerKindOf (TOR-221, FR-B-5)", () => {
  it("names a company, partnership, cooperative, joint venture or shop as juristic", () => {
    for (const name of [
      "บริษัท สยามก่อสร้าง จำกัด",
      "ห้างหุ้นส่วนจำกัด ช.การช่าง",
      "หจก.รุ่งเรืองวิศวกรรม",
      "บริษัท ไทยพัฒนา จำกัด (มหาชน)",
      "สหกรณ์การเกษตรบางกรวย จำกัด",
      "กิจการร่วมค้า เอบี",
      "ร้านเจริญพาณิชย์",
      "Siam Engineering Co., Ltd.",
    ]) {
      expect(winnerKindOf(name), name).toBe("juristic");
    }
  });

  it("treats a person's name as an individual's, even one with a company word in the surname", () => {
    for (const name of ["นายสมชาย ใจดี", "นางสาวสุดา มีสุข", "น.ส. วิภา รักไทย", "นายสมชาย จำกัดพันธ์", "Mr. John Smith"]) {
      expect(winnerKindOf(name), name).toBe("individual");
    }
  });

  it("keeps a name it cannot place, or none, out of public view", () => {
    expect(winnerKindOf("สมชาย ใจดี")).toBe("individual");
    expect(winnerKindOf(null)).toBe("individual");
    expect(winnerKindOf("   ")).toBe("individual");
  });
});
