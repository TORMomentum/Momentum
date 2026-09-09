import { describe, expect, it } from "vitest";
import { mapQualifications, tagLabel } from "./extraction.taxonomy.js";

describe("mapQualifications", () => {
  it("maps a road-construction contractor requirement to its tags", () => {
    const tags = mapQualifications([
      "เป็นผู้ประกอบการที่ขึ้นทะเบียนงานก่อสร้าง สาขางานก่อสร้างทาง ไม่น้อยกว่าชั้น 6 ประเภททั่วไป กับกรมบัญชีกลาง",
      "ในการปฏิบัติงานต้องมีวิศวกรประจำที่ได้รับใบอนุญาตประกอบวิชาชีพวิศวกรรมควบคุม",
    ]);
    expect(tags).toContain("construction-road");
    expect(tags).toContain("contractor-registered");
    expect(tags).toContain("licensed-engineer");
  });

  it("maps an irrigation / dredging requirement", () => {
    expect(mapQualifications(["ขึ้นทะเบียนงานก่อสร้าง สาขางานก่อสร้างชลประทาน ไม่น้อยกว่าชั้น 4"])).toEqual(
      expect.arrayContaining(["construction-irrigation", "contractor-registered"]),
    );
  });

  it("maps the school-uniform tailoring case with its TIS certificate", () => {
    const tags = mapQualifications([
      "เป็นบุคคลธรรมดาหรือนิติบุคคลผู้มีอาชีพรับจ้างงาน",
      "ได้รับใบอนุญาตแสดงเครื่องหมายมาตรฐานผลิตภัณฑ์อุตสาหกรรม มอก.2137-2559 (เครื่องแบบนักเรียน) และ มอก.2138-2559",
    ]);
    expect(tags).toContain("school-uniform");
    expect(tags).toContain("tis-certified");
  });

  it("maps the IT data-systems maintenance case", () => {
    expect(
      mapQualifications(["มีผลงานบำรุงรักษาระบบคอมพิวเตอร์ศูนย์ข้อมูล ที่ใช้ซอฟต์แวร์ SAS Enterprise Business Intelligence"]),
    ).toEqual(expect.arrayContaining(["it-infrastructure"]));
  });

  it("returns an empty array for nothing recognisable, and for null/empty input", () => {
    expect(mapQualifications(["ต้องมีความสามารถตามกฎหมาย"])).toEqual([]);
    expect(mapQualifications(null)).toEqual([]);
    expect(mapQualifications([])).toEqual([]);
  });

  it("does not repeat a tag matched by two aliases", () => {
    const tags = mapQualifications(["งานก่อสร้างทาง ปรับปรุงถนน ผิวจราจร"]);
    expect(tags.filter((t) => t === "construction-road")).toHaveLength(1);
  });

  it("exposes the Thai label for a tag", () => {
    expect(tagLabel("licensed-engineer")).toBe("วิศวกรผู้ได้รับใบอนุญาตประกอบวิชาชีพ");
    expect(tagLabel("unknown-id")).toBe("unknown-id");
  });
});
