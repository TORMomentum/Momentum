import type { Request, RequestHandler } from "express";

export interface SecurityHeadersOptions {
  /** HSTS lifetime in seconds; 0 sends no Strict-Transport-Security header. */
  hstsMaxAgeSeconds: number;
}

/**
 * Applied to every API response (TOR-317, ASVS V3.4, spec §5.6 revision 2026-11-20).
 *
 * The API serves JSON and streamed documents only, never a page, so the policy
 * is the strictest one: the response may load nothing, may be framed by nobody,
 * and leaks no referrer. Documents keep their own nosniff, no-store and
 * Content-Disposition from stream-document.ts; nothing here overrides those.
 *
 * Written by hand rather than with helmet: the set is short, and every header
 * is visible in one place for review.
 */
export const API_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "X-Permitted-Cross-Domain-Policies": "none",
};

/**
 * HTTPS as the client saw it. Cloud Run terminates TLS and forwards plain HTTP
 * with X-Forwarded-Proto. Trusting that header here is safe: a forged value can
 * only add HSTS to a plain-HTTP response, which browsers ignore by specification.
 */
function servedOverHttps(req: Request): boolean {
  if (req.secure) return true;
  const forwarded = req.get("X-Forwarded-Proto");
  return forwarded?.split(",")[0]?.trim().toLowerCase() === "https";
}

export function securityHeaders(options: SecurityHeadersOptions): RequestHandler {
  return (req, res, next) => {
    for (const [name, value] of Object.entries(API_SECURITY_HEADERS)) res.setHeader(name, value);
    if (options.hstsMaxAgeSeconds > 0 && servedOverHttps(req)) {
      res.setHeader("Strict-Transport-Security", `max-age=${options.hstsMaxAgeSeconds}; includeSubDomains`);
    }
    next();
  };
}
