import { describe, expect, it } from "vitest";
import { nextDueAt, passOutcome, stageHistoryOf } from "./stages.service.js";

const STAGES = [
  { code: "B0", description: "ร่างเอกสารประกวดราคา(e-Bidding)", on: "2026-10-21" },
  { code: "BOQ", description: null, on: "2026-10-21" },
  { code: "D0", description: "ประกาศเชิญชวน", on: "2026-10-30" },
  { code: "W0", description: "ประกาศผู้ชนะ", on: "2026-11-20" },
];

describe("stageHistoryOf (TOR-205)", () => {
  it("keeps the source's order and wording, names known codes, and links the documents we hold", () => {
    expect(stageHistoryOf(STAGES, { torId: "tor1", invitationId: "inv1" }, 20)).toEqual([
      { code: "B0", kind: "draft", description: "ร่างเอกสารประกวดราคา(e-Bidding)", on: "2026-10-21", recordId: "tor1" },
      { code: "BOQ", kind: "median-price", description: null, on: "2026-10-21" },
      { code: "D0", kind: "invitation", description: "ประกาศเชิญชวน", on: "2026-10-30", recordId: "inv1" },
      { code: "W0", kind: "awarded", description: "ประกาศผู้ชนะ", on: "2026-11-20" },
    ]);
  });

  it("links nothing it does not hold, and keeps only the newest rows past the cap", () => {
    const history = stageHistoryOf(STAGES, { torId: null, invitationId: null }, 2);
    expect(history.map((row) => row.code)).toEqual(["D0", "W0"]);
    expect(history.every((row) => row.recordId === undefined)).toBe(true);
  });
});

describe("nextDueAt (TOR-205)", () => {
  const now = new Date("2026-11-23T03:00:00Z");
  const settings = { refreshMs: 24 * 3_600_000, maxAgeDays: 180 };

  it("reads an open project again after the refresh interval", () => {
    expect(nextDueAt({ kind: "invitation", on: "2026-10-30" }, "2026-10-21", "2026-11-23", now, settings)).toEqual(
      new Date("2026-11-24T03:00:00Z"),
    );
    // An unconfirmed code is followed like any other open stage.
    expect(nextDueAt({ kind: "other", on: "2026-11-20" }, "2026-10-21", "2026-11-23", now, settings)).not.toBeNull();
  });

  it("stops once a winner is announced, but keeps following a cancelled invitation that may be issued again", () => {
    expect(nextDueAt({ kind: "awarded", on: "2026-11-20" }, "2026-10-21", "2026-11-23", now, settings)).toBeNull();
    expect(nextDueAt({ kind: "cancelled", on: "2026-11-20" }, "2026-10-21", "2026-11-23", now, settings)).toEqual(
      new Date("2026-11-24T03:00:00Z"),
    );
  });

  it("stops following a project whose newest stage is older than the limit, and counts from the record when none is listed", () => {
    expect(nextDueAt({ kind: "invitation", on: "2026-05-01" }, "2026-05-01", "2026-11-23", now, settings)).toBeNull();
    expect(nextDueAt(null, "2026-05-01", "2026-11-23", now, settings)).toBeNull();
    expect(nextDueAt(null, "2026-11-01", "2026-11-23", now, settings)).toEqual(new Date("2026-11-24T03:00:00Z"));
  });
});

describe("passOutcome (TOR-87)", () => {
  it("is a success while any project was read, a failure on a back-off or when all failed, and nothing when idle", () => {
    expect(passOutcome({ projects: 0, failed: 0, backOff: false })).toBeNull();
    expect(passOutcome({ projects: 5, failed: 2, backOff: false, lastError: "status 500" })).toEqual({ ok: true, items: 5, failed: 2, error: null });
    expect(passOutcome({ projects: 3, failed: 3, backOff: true, lastError: "Source responded with status 429" })).toEqual({
      ok: false,
      items: 3,
      failed: 3,
      error: "Source responded with status 429",
    });
    expect(passOutcome({ projects: 2, failed: 2, backOff: false })).toEqual({ ok: false, items: 2, failed: 2, error: "unknown" });
  });
});

describe("stageHistoryOf — the winner announcement (TOR-221)", () => {
  it("links W0 and its amendment W2 to the award record we hold, and no other awarded code", () => {
    const history = stageHistoryOf(
      [...STAGES, { code: "W2", description: "แก้ไขประกาศผู้ชนะ", on: "2026-11-22" }, { code: "I0", description: null, on: "2026-11-25" }],
      { torId: "tor1", invitationId: "inv1", awardId: "award1" },
      20,
    );
    expect(history.filter((row) => row.recordId === "award1").map((row) => row.code)).toEqual(["W0", "W2"]);
    expect(history.find((row) => row.code === "I0")?.recordId).toBeUndefined();
  });
});
