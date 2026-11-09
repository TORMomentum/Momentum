// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ViewBeacon } from "./ViewBeacon";

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("ViewBeacon", () => {
  it("reports one view of the TOR, renders nothing, and survives a failed request", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    await act(async () => root.render(<ViewBeacon torId="0123456789abcdef01234567" />));
    expect(container.innerHTML).toBe("");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/auth/me/events");
    expect(JSON.parse(init.body)).toEqual({ torId: "0123456789abcdef01234567", type: "view" });
  });
});
