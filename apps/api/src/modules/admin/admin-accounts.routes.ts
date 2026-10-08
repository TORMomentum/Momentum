import { Router, type Request } from "express";
import { z } from "zod";
import { TAXONOMY_VERSION } from "@tor-radar/seeds";
import { profileSchema } from "../profile/profile.routes.js";
import { requireKey } from "../intake/intake.auth.js";
import type { AdminAccountsService } from "./admin-accounts.service.js";

export interface AdminAccountsRouterDeps {
  service: AdminAccountsService;
  adminKeys: string[];
  pageSize: number;
}

/** Primitives only, as for every admin filter: nothing operator-shaped reaches a query. */
const listSchema = z.object({
  q: z.string().max(200).optional(),
  page: z.coerce.number().int().positive().max(10_000).default(1),
});
const roleSchema = z.object({ role: z.enum(["vendor", "admin"]) });
const disableSchema = z.object({ reason: z.string().trim().min(3).max(300) });

/**
 * Vendor accounts, for staff (FR-G, NFR-S2). Behind the admin key like the rest of /admin; the
 * actor every audit entry names is read from the request, as the review queue's is.
 */
export function buildAdminAccountsRouter(deps: AdminAccountsRouterDeps): Router {
  const router = Router();
  const actorOf = (req: Request) => (req as Request & { actor?: string }).actor ?? "admin";

  router.use(requireKey(deps.adminKeys, "admin"));

  router.get("/accounts", async (req, res) => {
    const { q, page } = listSchema.parse(req.query);
    res.json(await deps.service.list(q, page, deps.pageSize));
  });

  router.get("/accounts/:id", async (req, res) => {
    res.json(await deps.service.open(req.params.id, actorOf(req)));
  });

  router.put("/accounts/:id/profile", async (req, res) => {
    // Stored exactly as the vendor's own save stores it: de-duplicated, stamped with the vocabulary.
    const input = profileSchema.parse(req.body);
    await deps.service.editProfile(req.params.id, {
      categories: [...new Set(input.categories)],
      areas: [...new Set(input.areas)],
      otherCategories: [...new Set(input.otherCategories)],
      budget: input.budget,
      taxonomyVersion: TAXONOMY_VERSION,
    }, actorOf(req));
    res.json({ id: req.params.id, updatedBy: "admin" });
  });

  router.post("/accounts/:id/role", async (req, res) => {
    const { role } = roleSchema.parse(req.body);
    await deps.service.changeRole(req.params.id, role, actorOf(req));
    res.json({ id: req.params.id, role });
  });

  router.post("/accounts/:id/disable", async (req, res) => {
    const { reason } = disableSchema.parse(req.body);
    await deps.service.setDisabled(req.params.id, true, actorOf(req), reason);
    res.json({ id: req.params.id, disabled: true });
  });

  router.post("/accounts/:id/enable", async (req, res) => {
    await deps.service.setDisabled(req.params.id, false, actorOf(req));
    res.json({ id: req.params.id, disabled: false });
  });

  router.post("/accounts/:id/verification-email", async (req, res) => {
    await deps.service.resendVerification(req.params.id, actorOf(req));
    res.status(202).json({ id: req.params.id, sent: "verification" });
  });

  router.post("/accounts/:id/match-email", async (req, res) => {
    res.json({ id: req.params.id, ...(await deps.service.sendMatchEmail(req.params.id, actorOf(req))) });
  });

  router.post("/accounts/:id/password-reset", async (req, res) => {
    await deps.service.sendPasswordReset(req.params.id, actorOf(req));
    res.status(202).json({ id: req.params.id, sent: "password-reset" });
  });

  return router;
}
