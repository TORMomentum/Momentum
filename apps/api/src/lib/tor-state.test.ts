import { describe, expect, it } from "vitest";
import { torStateOf } from "./tor-state.js";

const TODAY = "2026-10-06";

describe("torStateOf", () => {
  it("is open while the deadline has not passed", () => {
    expect(torStateOf({ torStatus: "announced", deadline: "2026-10-06" }, TODAY)).toBe("open");
    expect(torStateOf({ torStatus: "announced", deadline: "2026-12-01" }, TODAY)).toBe("open");
  });

  it("is closed once the deadline has passed, whatever the label says", () => {
    expect(torStateOf({ torStatus: "announced", deadline: "2026-10-05" }, TODAY)).toBe("closed");
  });

  it("waits for the invitation when a published scope has no deadline", () => {
    // The draft scope is out; the invitation to bid that carries the deadline is
    // not. A vendor cannot act on it yet, and saying "open" would imply they can.
    expect(torStateOf({ torStatus: "announced", deadline: null }, TODAY)).toBe("awaiting-invitation");
  });

  it("keeps awarded and cancelled whatever their deadline says", () => {
    expect(torStateOf({ torStatus: "awarded", deadline: "2026-12-01" }, TODAY)).toBe("awarded");
    expect(torStateOf({ torStatus: "cancelled", deadline: "2026-12-01" }, TODAY)).toBe("cancelled");
  });

  it("treats an unreadable status as closed rather than inviting a bid on it", () => {
    expect(torStateOf({ torStatus: null, deadline: "2026-12-01" }, TODAY)).toBe("closed");
    expect(torStateOf({ torStatus: "closed", deadline: null }, TODAY)).toBe("closed");
  });
});
