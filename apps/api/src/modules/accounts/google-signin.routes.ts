import { Router } from "express";
import { z } from "zod";
import { authRateLimit } from "../../core/auth-rate-limit.js";
import type { Config } from "../../core/config.js";
import { requireSameOrigin } from "../../core/require-same-origin.js";
import { GoogleSigninService } from "./google-signin.service.js";

// Google sends the code and state back in the query string; the web server relays them here in a body.
const callbackSchema = z.object({ code: z.string().min(1).max(2048), state: z.string().min(1).max(512), binding: z.string().min(1).max(512) });
const completeSchema = z.object({ ticket: z.string().min(1).max(512), consent: z.literal(true), behaviourConsent: z.boolean().optional() });

/**
 * Mounted only when `GOOGLE_OAUTH_ENABLED` is on, so a deployment without an OAuth client answers 404 rather than
 * redirecting anyone to a Google error page. Reached only through the web server's `/api/auth/google/*` handlers,
 * which own the browser's cookies and redirects.
 */
export function buildGoogleSigninRouter(deps: { config: Config; service: GoogleSigninService }): Router {
  const router = Router();
  const limits = authRateLimit(deps.config);
  const writes = [requireSameOrigin(deps.config.appOrigin), ...limits];

  router.get("/google/start", ...limits, async (_req, res) => {
    res.set("cache-control", "no-store").json(await deps.service.start());
  });

  router.post("/google/callback", ...writes, async (req, res) => {
    const result = await deps.service.callback(callbackSchema.parse(req.body));
    res.set("cache-control", "no-store").json(result);
  });

  router.post("/google/complete", ...writes, async (req, res) => {
    const input = completeSchema.parse(req.body);
    const result = await deps.service.complete({ ticket: input.ticket, ...(input.behaviourConsent ? { behaviourConsent: true } : {}) });
    res.set("cache-control", "no-store").json(result);
  });

  return router;
}
