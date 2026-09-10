import { Router, type Request } from "express";
import { z } from "zod";
import { requireKey } from "../intake/intake.auth.js";
import type { AdminService } from "./admin.service.js";

export interface AdminRouterDeps {
  service: AdminService;
  adminKeys: string[];
  /** How many queue rows one request may return. */
  queuePageSize: number;
}

/**
 * Filters and bodies are parsed as primitives only, so nothing shaped like a
 * Mongo operator can reach a query (spec §5.6).
 */
const queueQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
  reason: z.string().min(1).max(64).optional(),
});

const editSchema = z.object({
  field: z.enum([
    "title",
    "agency",
    "budget",
    "category",
    "scopeSummary",
    "qualifications",
    "deadline",
    "contact",
    "torStatus",
    "procurementMethod",
    "referenceNo",
  ]),
  value: z.string().max(4000),
});

const editsBodySchema = z.object({ edits: z.array(editSchema).max(20).default([]) });

const rejectSchema = z.object({ reason: z.string().min(3).max(300) });

/**
 * The review queue's HTTP surface (FR-G-1, FR-G-2).
 *
 * Every route is behind the admin key. Slice 4 replaces that with a staff
 * session; the routes do not change, only what `requireKey` becomes — which is
 * why the actor is read from the request rather than hard-coded.
 */
export function buildAdminRouter(deps: AdminRouterDeps): Router {
  const router = Router();
  // requireKey stamps the actor on the request; slice 4 replaces the key with a
  // staff session and stamps a real identity in the same place.
  const actorOf = (req: Request) => (req as Request & { actor?: string }).actor ?? "admin";

  router.use(requireKey(deps.adminKeys, "admin"));

  router.get("/queue", async (req, res) => {
    const { limit, reason } = queueQuerySchema.parse(req.query);
    res.json(await deps.service.queue(limit ?? deps.queuePageSize, reason));
  });

  router.get("/overview", async (_req, res) => {
    res.json(await deps.service.overview());
  });

  router.get("/events", async (req, res) => {
    const { limit } = queueQuerySchema.parse(req.query);
    res.json(await deps.service.events(limit ?? deps.queuePageSize * 2));
  });

  router.get("/tors/:id", async (req, res) => {
    res.json(await deps.service.load(req.params.id));
  });

  router.patch("/tors/:id/fields", async (req, res) => {
    const { edits } = editsBodySchema.parse(req.body);
    const record = await deps.service.correct(req.params.id, edits, actorOf(req));
    res.json(record);
  });

  router.post("/tors/:id/approve", async (req, res) => {
    const { edits } = editsBodySchema.parse(req.body ?? {});
    await deps.service.approve(req.params.id, edits, actorOf(req));
    res.json({ id: req.params.id, unverified: false });
  });

  router.post("/tors/:id/reextract", async (req, res) => {
    await deps.service.reextract(req.params.id, actorOf(req));
    res.status(202).json({ id: req.params.id, state: "queued" });
  });

  router.post("/tors/:id/reject", async (req, res) => {
    const { reason } = rejectSchema.parse(req.body);
    await deps.service.reject(req.params.id, reason, actorOf(req));
    res.json({ id: req.params.id, restricted: true });
  });

  return router;
}
