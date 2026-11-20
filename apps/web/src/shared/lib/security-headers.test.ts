import { describe, expect, it } from "vitest";
import { buildCsp, generateNonce, isViewerPath, securityHeaders } from "./security-headers";

const prod = { NODE_ENV: "production" } as NodeJS.ProcessEnv;

describe("security headers", () => {
  it("makes a different nonce every time and puts it in script-src", () => {
    const a = generateNonce();
    expect(a).not.toBe(generateNonce());
    expect(buildCsp(a, "/", prod)).toContain(`script-src 'self' 'nonce-${a}' 'strict-dynamic'`);
  });

  it("denies framing everywhere except the original viewer, which allows only its own origin", () => {
    expect(buildCsp("n", "/search", prod)).toContain("frame-ancestors 'none'");
    expect(securityHeaders("n", "/search", prod)["X-Frame-Options"]).toBe("DENY");
    for (const path of ["/tors/abc/document", "/admin/tors/abc/document", "/admin/tors/abc/pages/2"]) {
      expect(isViewerPath(path)).toBe(true);
      expect(buildCsp("n", path, prod)).toContain("frame-ancestors 'self'");
      expect(securityHeaders("n", path, prod)["X-Frame-Options"]).toBe("SAMEORIGIN");
    }
    // the page that EMBEDS the viewer is not itself framed
    expect(isViewerPath("/tors/abc/original")).toBe(false);
    expect(isViewerPath("/tors/abc")).toBe(false);
  });

  it("allows unsafe-eval only outside production", () => {
    expect(buildCsp("n", "/", prod)).not.toContain("unsafe-eval");
    expect(buildCsp("n", "/", { NODE_ENV: "development" } as NodeJS.ProcessEnv)).toContain("'unsafe-eval'");
  });

  it("sends HSTS only in production, with the other fixed headers always", () => {
    expect(securityHeaders("n", "/", prod)["Strict-Transport-Security"]).toBe("max-age=63072000; includeSubDomains");
    const dev = securityHeaders("n", "/", { NODE_ENV: "development" } as NodeJS.ProcessEnv);
    expect(dev["Strict-Transport-Security"]).toBeUndefined();
    expect(dev["X-Content-Type-Options"]).toBe("nosniff");
    expect(dev["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
  });

  it("takes extra sources from the environment", () => {
    const csp = buildCsp("n", "/", { ...prod, CSP_EXTRA_IMG_SRC: "https://img.example", CSP_EXTRA_CONNECT_SRC: "https://api.example" });
    expect(csp).toContain("img-src 'self' blob: data: https://img.example");
    expect(csp).toContain("connect-src 'self' https://api.example");
  });
});
