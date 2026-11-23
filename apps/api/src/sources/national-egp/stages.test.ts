import { describe, expect, it } from "vitest";
import { latestStage, parseProjectStages, stageKindOf, torAnnouncedOn } from "./stages.js";
import { projectStagesUrl } from "./client.js";

const TZ = "Asia/Bangkok";

/** e-GP's answer for project 69109234234 on 2026-11-23, trimmed to the fields read. */
const RESPONSE = {
  data: {
    alProcurePriceAndReceiveResponce: null,
    greenBookAnnouncementTypeLinkDto: [
      { announceDate: "2026-10-20T17:00:00.000Z", announceType: "B0", announceTypeDesc: "ร่างเอกสารประกวดราคา(e-Bidding)", projectId: "69109234234" },
      { announceDate: "2026-10-20T17:00:00.000Z", announceType: "BOQ", announceTypeDesc: null, projectId: "69109234234" },
      { announceDate: "2026-10-29T17:00:00.000Z", announceType: "D0", announceTypeDesc: "ประกาศเชิญชวน", projectId: "69109234234" },
    ],
    processDataAnnouncementTypeResponceList: null,
  },
  response: { responseCode: 0, responseDesc: "" },
};

describe("e-GP project stages (TOR-204)", () => {
  it("reads every stage with its day in Thailand, as the project page shows it", () => {
    expect(parseProjectStages(RESPONSE, TZ)).toEqual([
      { type: "B0", description: "ร่างเอกสารประกวดราคา(e-Bidding)", announcedOn: "2026-10-21" },
      { type: "BOQ", description: null, announcedOn: "2026-10-21" },
      { type: "D0", description: "ประกาศเชิญชวน", announcedOn: "2026-10-30" },
    ]);
    expect(torAnnouncedOn(parseProjectStages(RESPONSE, TZ))).toBe("2026-10-21");
  });

  it("drops a row it cannot read rather than guessing, and treats a failed answer as no stages", () => {
    const rows = [
      { announceDate: "not a date", announceType: "B0" },
      { announceDate: "2026-10-20T17:00:00.000Z", announceType: { $ne: 1 } },
      { announceDate: null, announceType: "D0" },
    ];
    expect(parseProjectStages({ response: { responseCode: 0 }, data: { greenBookAnnouncementTypeLinkDto: rows } }, TZ)).toEqual([]);
    expect(parseProjectStages({ response: { responseCode: 1 }, data: null }, TZ)).toEqual([]);
    expect(parseProjectStages({ response: { responseCode: 0 }, data: { greenBookAnnouncementTypeLinkDto: null } }, TZ)).toEqual([]);
    expect(parseProjectStages(null, TZ)).toEqual([]);
    expect(torAnnouncedOn([])).toBeNull();
    expect(torAnnouncedOn([{ type: "BOQ", description: null, announcedOn: "2026-10-01" }])).toBeNull();
  });

  it("dates the draft TOR from B3 too, and keeps lower-case codes such as the bid summary (sampled 2026-11-23)", () => {
    // e-GP's answer for project 69069300968, in e-GP's own order: not date order.
    const cancelled = {
      response: { responseCode: 0 },
      data: {
        greenBookAnnouncementTypeLinkDto: [
          { announceType: "B3", announceTypeDesc: "ร่างเอกสารประกวดราคา(e-Bidding)", announceDate: "2026-08-16T17:00:00.000Z" },
          { announceType: "BOQ", announceTypeDesc: null, announceDate: "2026-08-23T17:00:00.000Z" },
          { announceType: "price", announceTypeDesc: "สรุปข้อมูลการเสนอราคาเบื้องต้น", announceDate: "2026-09-09T17:00:00.000Z" },
          { announceType: "D0", announceTypeDesc: "ประกาศเชิญชวน", announceDate: "2026-08-23T17:00:00.000Z" },
          { announceType: "D1", announceTypeDesc: "ยกเลิกประกาศเชิญชวน", announceDate: "2026-11-22T17:00:00.000Z" },
        ],
      },
    };
    const stages = parseProjectStages(cancelled, TZ);
    expect(stages.map((stage) => stage.type)).toEqual(["B3", "BOQ", "price", "D0", "D1"]);
    expect(torAnnouncedOn(stages)).toBe("2026-08-17");
    expect(torAnnouncedOn([{ type: "B3", description: null, announcedOn: "2026-09-02" }, { type: "B0", description: null, announcedOn: "2026-09-01" }])).toBe("2026-09-01");
  });

  it("asks e-GP for the table with the parameter it requires", () => {
    const url = new URL(projectStagesUrl("69109234234"));
    expect(url.pathname).toBe("/egp-oann10-service/pb/a-egp-allt-project/announcement/greenBook");
    expect(Object.fromEntries(url.searchParams)).toEqual({ mode: "LINK", tempProjectId: "69109234234", pageAnnounceType: "B0" });
  });

  it("dates a TOR with no draft stage from its first invitation, and a draft still wins when listed (sampled 2026-11-23)", () => {
    // A project that skipped the draft hearing: its TOR went out with the invitation. Listed out of order,
    // cancelled and invited again: the first invitation is the day.
    const noDraft = [
      { type: "D0", description: "ประกาศเชิญชวน", announcedOn: "2026-11-02" },
      { type: "BOQ", description: null, announcedOn: "2026-10-20" },
      { type: "D1", description: "ยกเลิกประกาศเชิญชวน", announcedOn: "2026-10-25" },
      { type: "D0", description: "ประกาศเชิญชวน", announcedOn: "2026-10-20" },
    ];
    expect(torAnnouncedOn(noDraft)).toBe("2026-10-20");
    expect(torAnnouncedOn([...noDraft, { type: "B0", description: null, announcedOn: "2026-10-28" }])).toBe("2026-10-28");
  });

  it("names only the codes confirmed on a real project, and keeps any other as `other` (TOR-205)", () => {
    expect(["B0", "B3", "BOQ", "D0", "W0", "D1"].map(stageKindOf)).toEqual(["draft", "draft", "median-price", "invitation", "awarded", "cancelled"]);
    // The bid summary is real but says nothing about whether bids are still taken.
    expect(stageKindOf("price")).toBe("other");
    expect(stageKindOf("Z9")).toBe("other");
    // An inherited property is not a code.
    expect(stageKindOf("constructor")).toBe("other");
    expect(stageKindOf("toString")).toBe("other");
  });

  it("takes the latest day as the current stage, and on a tie the one e-GP lists last", () => {
    const stages = parseProjectStages(RESPONSE, TZ);
    expect(latestStage(stages)?.type).toBe("D0");
    // B0 and BOQ share a day: BOQ is listed after B0, so it is the newer.
    expect(latestStage(stages.slice(0, 2))?.type).toBe("BOQ");
    expect(latestStage([...stages].reverse())?.type).toBe("D0");
    expect(latestStage([])).toBeNull();
  });
});
