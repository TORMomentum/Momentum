import rateLimit from "express-rate-limit";
import type { Request, RequestHandler } from "express";
import { normalizeEmail } from "../modules/accounts/accounts.repository.js";
import type { Config } from "./config.js";

const AUTH_RATE_LIMIT_WINDOW_MS = 60_000;

function emailKey(req: Request): string {
  const body = req.body as { email?: unknown } | undefined;
  return typeof body?.email === "string" ? normalizeEmail(body.email) : "";
}

function tooManyRequests(keyType: "ip" | "email") {
  return (_req: Request, res: Parameters<RequestHandler>[1]): void => {
    // The security-log hook reads this; the response itself stays uniform and empty,
    // so it does not disclose whether the address or email limit fired.
    res.locals.rateLimitKey = keyType;
    res.status(429).end();
  };
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
  };
  return [
    rateLimit({ ...common, limit: limits.authRateLimitPerIp, handler: tooManyRequests("ip") }),
    rateLimit({
      ...common,
      limit: limits.authRateLimitPerEmail,
      handler: tooManyRequests("email"),
      keyGenerator: emailKey,
      // Without this, every request carrying no address shares one bucket, and a
      // handful of them would lock out the whole service's email allowance.
      skip: (req) => emailKey(req) === "",
    }),
  ];
}
