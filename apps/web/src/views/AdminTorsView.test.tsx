// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AdminTorsView } from "./AdminTorsView";

vi.mock("next/link", () => ({ default: "a" }));
// The table calls server actions; their staff check is server-only.
vi.mock("../features/admin/admin.actions", () => ({ bulkTorsAction: vi.fn() }));

it("links all-TOR rows to their management page", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <AdminTorsView
        offline={null}
        query={{ status: "all", kind: "tor", page: 1 }}
        result={{
          rows: [
            {
              id: "tor-1",
              title: "TOR",
              agency: "A",
              documentType: "tor",
              state: "published",
              restricted: false,
              unverified: false,
              confidenceLevel: null,
              projectNumber: null,
              createdAt: "2026-10-01T00:00:00.000Z",
            },
          ],
          total: 1,
          page: 1,
          pageSize: 20,
        }}
      />,
    ),
  );
  expect(container.querySelector("a")?.getAttribute("href")).toBe("/admin/tors/tor-1");
  await act(async () => root.unmount());
});
