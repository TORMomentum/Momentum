import { describe, expect, it } from "vitest";
import { provincesIn } from "./province.js";

describe("provincesIn", () => {
  it("finds a province by its official name, and Bangkok by the names documents use", () => {
    expect(provincesIn("ตำบลในเมือง อำเภอเมือง จังหวัดขอนแก่น")).toEqual(["khon-kaen"]);
    expect(provincesIn("เขตบางรัก กรุงเทพฯ")).toEqual(["bangkok"]);
  });

  it("lists several provinces in the order they are first mentioned, each once", () => {
    expect(provincesIn("ชลบุรี ระยอง และ ชลบุรี")).toEqual(["chon-buri", "rayong"]);
  });

  it("reads a short name only when written as a province, not inside another word", () => {
    expect(provincesIn("ต้องปฏิบัติเลยทันที")).toEqual([]);
    expect(provincesIn("อำเภอเมือง จ.เลย")).toEqual(["loei"]);
  });

  it("names nothing for text that names no province", () => {
    expect(provincesIn("อาคารสำนักงาน ชั้น 3")).toEqual([]);
    expect(provincesIn("")).toEqual([]);
  });
});
