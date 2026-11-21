import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { HibpBreachedPasswords } from "./hibp.breached-passwords.js";

const config = { enabled: true, apiUrl: "https://range.example.test/range", timeoutMs: 1000, minCount: 1 };
const sha1 = (value: string) => createHash("sha1").update(value).digest("hex").toUpperCase();

describe("HibpBreachedPasswords", () => {
  it("sends only the 5-character prefix with Add-Padding, and matches the suffix locally", async () => {
    const digest = sha1("hunter2-test");
    const body = ["0000000000000000000000000000000000A:0", `${digest.slice(5)}:42`, "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:3"].join("\r\n");
    const fetchMock = vi.fn(async () => new Response(body));
    const adapter = new HibpBreachedPasswords(config, fetchMock as unknown as typeof fetch);

    expect(await adapter.occurrences("hunter2-test")).toBe(42);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://range.example.test/range/${digest.slice(0, 5)}`);
    expect(url).not.toContain(digest.slice(5));
    expect((init.headers as Record<string, string>)["Add-Padding"]).toBe("true");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns 0 when the suffix is absent (padding rows count 0) and rejects on a non-2xx reply", async () => {
    const miss = new HibpBreachedPasswords(config, (async () => new Response("ABC:0\r\nDEF:7")) as typeof fetch);
    expect(await miss.occurrences("not-in-there")).toBe(0);
    const down = new HibpBreachedPasswords(config, (async () => new Response("no", { status: 503 })) as typeof fetch);
    await expect(down.occurrences("x")).rejects.toThrow();
  });
});
