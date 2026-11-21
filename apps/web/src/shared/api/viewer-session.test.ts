import { describe, expect, it, vi } from "vitest";
import { apiRequest } from "./api-client";
import { readViewerSession } from "./viewer-session";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "test-session" }) }) }));
vi.mock("./api-client", () => ({ apiRequest: vi.fn() }));

describe("viewer session", () => {
  it.each([
    new Response('{"email":'),
    new Response(new ReadableStream({ pull(controller) { controller.error(new Error("body timed out")); } })),
  ])("renders signed out when a 200 response has an unreadable body", async (response) => {
    vi.mocked(apiRequest).mockResolvedValueOnce(response);
    expect(await readViewerSession()).toEqual({ account: null, expired: false });
  });

  it("recognizes a rejected session without parsing the body", async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce(new Response("unauthorized", { status: 401 }));
    expect(await readViewerSession()).toEqual({ account: null, expired: true });
  });
});
