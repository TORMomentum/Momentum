import rateLimit from "express-rate-limit";
import type { Request, RequestHandler } from "express";
import { normalizeEmail } from "../modules/accounts/accounts.repository.js";
import type { Config } from "./config.js";

const AUTH_RATE_LIMIT_WINDOW_MS = 60_000;

function emailKey(req: Request): string {
  const body = req.body as { email?: unknown } | undefined;
  return typeof body?.email === "string" ? normalizeEmail(body.email) : "";
}

function tooManyRequests(_req: Request, res: Parameters<RequestHandler>[1]): void {
  // A uniform empty response does not disclose whether the address or email limit fired.
  res.status(429).end();
}

/**
 * Both dimensions make credential stuffing costly without allowing one shared
 * address to exhaust the entire service's allowance for a targeted address.
 */
export function authRateLimit(limits: Pick<Config, "authRateLimitPerIp" | "authRateLimitPerEmail">): RequestHandler[] {
  const common = {
    windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
    standardHeaders: false,
    legacyHeaders: false,
    handler: tooManyRequests,
  };
  return [
    rateLimit({ ...common, limit: limits.authRateLimitPerIp }),
    rateLimit({
      ...common,
      limit: limits.authRateLimitPerEmail,
      keyGenerator: emailKey,
      // Without this, every request carrying no address shares one bucket, and a
      // handful of them would lock out the whole service's email allowance.
      skip: (req) => emailKey(req) === "",
    }),
  ];
}
