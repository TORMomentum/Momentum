import { describe, expect, it } from "vitest";
import { parseProjectStages, torAnnouncedOn } from "./stages.js";
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
  });

  it("asks e-GP for the table with the parameter it requires", () => {
    const url = new URL(projectStagesUrl("69109234234"));
    expect(url.pathname).toBe("/egp-oann10-service/pb/a-egp-allt-project/announcement/greenBook");
    expect(Object.fromEntries(url.searchParams)).toEqual({ mode: "LINK", tempProjectId: "69109234234", pageAnnounceType: "B0" });
  });
});
