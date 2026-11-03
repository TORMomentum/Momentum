import { describe, expect, it } from "vitest";
import { driftFindings } from "./docs_drift.mjs";

const docs = (changes: { status: string; path: string }[]) => driftFindings(changes).map((f) => f.doc);

describe("driftFindings", () => {
  it("asks for API.md when a router changes without it", () => {
    expect(docs([{ status: "M", path: "apps/api/src/modules/admin/admin.routes.ts" }])).toContain("docs/API.md");
  });

  it("is satisfied once the matching doc is in the same change", () => {
    expect(
      docs([
        { status: "M", path: "apps/api/src/modules/admin/admin.routes.ts" },
        { status: "M", path: "docs/API.md" },
        { status: "M", path: "docs/TODO.md" },
      ]),
    ).toEqual([]);
  });

  it("asks for ARCHITECTURE.md for a new module file but not for an edit inside one", () => {
    expect(docs([{ status: "A", path: "apps/api/src/modules/x/x.service.ts" }])).toContain("docs/ARCHITECTURE.md");
    expect(docs([{ status: "M", path: "apps/api/src/modules/x/x.service.ts" }])).not.toContain("docs/ARCHITECTURE.md");
    expect(docs([{ status: "M", path: "apps/api/src/core/db.ts" }])).toContain("docs/ARCHITECTURE.md");
  });

  it("asks for TESTING.md only when a test is added or removed", () => {
    expect(docs([{ status: "A", path: "apps/web/src/views/X.test.tsx" }])).toContain("docs/TESTING.md");
    expect(docs([{ status: "M", path: "apps/web/src/views/X.test.tsx" }])).not.toContain("docs/TESTING.md");
  });

  it("keeps CLAUDE.md and AGENTS.md moving together", () => {
    expect(docs([{ status: "M", path: "CLAUDE.md" }])).toEqual(["AGENTS.md"]);
    expect(docs([{ status: "M", path: "CLAUDE.md" }, { status: "M", path: "AGENTS.md" }])).toEqual([]);
  });

  it("asks nothing of a docs-only change", () => {
    expect(docs([{ status: "M", path: "docs/SRS.md" }])).toEqual([]);
  });
});
