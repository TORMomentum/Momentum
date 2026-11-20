import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, FRAMEABLE_DOCUMENT_ROUTES, securityHeaderRules } from "./security-headers";

function headersFor(source: string, dev = false, hstsMaxAgeSeconds = 31_536_000): Record<string, string> {
  const rule = securityHeaderRules({ dev, hstsMaxAgeSeconds }).find((candidate) => candidate.source === source);
  if (!rule) throw new Error(`no rule for ${source}`);
  return Object.fromEntries(rule.headers.map(({ key, value }) => [key, value]));
}

describe("web security headers (TOR-321)", () => {
  it("gives every page a CSP that loads only from this origin and cannot be framed", () => {
    const csp = contentSecurityPolicy({ dev: false });
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).not.toMatch(/\*/);
  });

  it("allows eval and the hot-reload socket only in development", () => {
    expect(contentSecurityPolicy({ dev: false })).not.toContain("'unsafe-eval'");
    expect(contentSecurityPolicy({ dev: false })).not.toContain("ws:");
    expect(contentSecurityPolicy({ dev: true })).toContain("'unsafe-eval'");
    expect(contentSecurityPolicy({ dev: true })).toContain("connect-src 'self' ws: wss:");
  });

  it("sets the full header set on all paths", () => {
    const headers = headersFor("/:path*");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Cross-Origin-Opener-Policy"]).toBe("same-origin");
    expect(headers["Permissions-Policy"]).toContain("camera=()");
    expect(headers["Strict-Transport-Security"]).toBe("max-age=31536000; includeSubDomains");
  });

  it("omits HSTS when its lifetime is 0", () => {
    expect(headersFor("/:path*", false, 0)["Strict-Transport-Security"]).toBeUndefined();
  });

  it("lets only our own pages frame the document routes", () => {
    for (const source of FRAMEABLE_DOCUMENT_ROUTES) {
      const headers = headersFor(source);
      expect(headers["Content-Security-Policy"]).toBe("frame-ancestors 'self'");
      expect(headers["X-Frame-Options"]).toBe("SAMEORIGIN");
    }
  });

  it("orders the document overrides after the page rule, so theirs win", () => {
    const sources = securityHeaderRules({ dev: false, hstsMaxAgeSeconds: 0 }).map((rule) => rule.source);
    expect(sources[0]).toBe("/:path*");
    expect(sources.slice(1)).toEqual([...FRAMEABLE_DOCUMENT_ROUTES]);
  });
});
