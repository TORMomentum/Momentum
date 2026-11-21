import rateLimit from "express-rate-limit";
import type { RequestHandler } from "express";

const PUBLIC_RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * A per-client-address cap for a costly public read (TOR-318). The key is `req.ip`, so it is
 * only per client once `trust proxy` is set (see app.ts); express-rate-limit v8 folds IPv6
 * addresses into one /56 bucket itself. Each call builds its own store, so search and
 * document downloads never draw on one another's allowance. The answer is the same empty
 * 429 as the login limiter, and no rate-limit headers, so the limit is not advertised.
 */
export function publicRateLimit(limit: number): RequestHandler {
  return rateLimit({
    windowMs: PUBLIC_RATE_LIMIT_WINDOW_MS,
    limit,
    standardHeaders: false,
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).end();
    },
  });
}
