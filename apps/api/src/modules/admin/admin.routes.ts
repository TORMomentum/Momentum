import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { TorFields } from "@tor-radar/shared";
import { BadRequestError } from "../../core/errors.js";
import { parseDisposition } from "../../lib/content-disposition.js";
import { streamDocument } from "../../lib/stream-document.js";
import type { Storage } from "../../ports/storage.port.js";
import { requireKey } from "../intake/intake.auth.js";
import type { ReviewFieldName } from "./admin.repository.js";
import type { AdminService } from "./admin.service.js";

export interface AdminRouterDeps {
  service: AdminService;
  storage: Storage;
  adminKeys: string[];
  /** How many queue rows one request may return. */
  queuePageSize: number;
  /** How many TORs one bulk action may touch. */
  bulkMax: number;
}

/**
 * Filters and bodies are parsed as primitives only, so nothing shaped like a
 * Mongo operator can reach a query (spec §5.6).
 */
const queueQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
  reason: z.string().min(1).max(64).optional(),
  view: z.enum(["confidence", "fields"]).optional(),
});

const reviewFieldNames = [
  "title",
  "agency",
  "budget",
  "category",
  "scopeSummary",
  "qualifications",
  "deadline",
  "contact",
  "torStatus",
] as const satisfies readonly ReviewFieldName[];

const editableFieldNames = [
  ...reviewFieldNames,
  "procurementMethod",
  "referenceNo",
] as const satisfies readonly (keyof TorFields)[];

const editSchema = z.object({
  field: z.enum(editableFieldNames),
  value: z.string().max(4000),
});

const editsBodySchema = z.object({ edits: z.array(editSchema).max(20).default([]) });

const rejectSchema = z.object({ reason: z.string().min(3).max(300) });

/** The all-TORs list: primitives only, like every other admin filter. */
const torsQuerySchema = z.object({
  q: z.string().max(200).optional(),
  status: z.enum(["all", "public", "restricted", "unverified", "processing", "stuck", "failed"]).default("all"),
  kind: z.enum(["tor", "invitation", "all"]).default("tor"),
  page: z.coerce.number().int().positive().max(10_000).default(1),
});
const verificationParamsSchema = z.object({ field: z.enum(reviewFieldNames) });
const verificationBodySchema = z.object({ confirmed: z.boolean() });

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
    const { limit, reason, view } = queueQuerySchema.parse(req.query);
    res.json(await deps.service.queue(limit ?? deps.queuePageSize, reason, view));
  });

  router.get("/overview", async (_req, res) => {
    res.json(await deps.service.overview());
  });

  router.get("/events", async (req, res) => {
    const { limit } = queueQuerySchema.parse(req.query);
    res.json(await deps.service.events(limit ?? deps.queuePageSize * 2));
  });

  router.get("/tors", async (req, res) => {
    const { q, status, kind, page } = torsQuerySchema.parse(req.query);
    res.json(await deps.service.listAll({ ...(q ? { q } : {}), status, kind, page, pageSize: deps.queuePageSize }));
  });

  router.get("/tors/:id", async (req, res) => {
    res.json(await deps.service.load(req.params.id));
  });

  const document = async (req: Request<{ id: string }>, res: Response) => {
    const disposition = parseDisposition(req.query.disposition);
    if (!disposition) throw new BadRequestError("disposition must be inline or attachment");
    const doc = await deps.service.documentToStream(req.params.id);
    await streamDocument(req, res, deps.storage, doc, disposition);
  };

  // HEAD before GET: in Express 5 a GET route answers HEAD when no earlier HEAD
  // route matches, and the HEAD path must not open the object.
  router.head("/tors/:id/document", document);
  router.get("/tors/:id/document", document);

  router.patch("/tors/:id/fields", async (req, res) => {
    const { edits } = editsBodySchema.parse(req.body);
    const record = await deps.service.correct(req.params.id, edits, actorOf(req));
    res.json(record);
  });

  router.patch("/tors/:id/fields/:field/verification", async (req, res) => {
    const { field } = verificationParamsSchema.parse(req.params);
    const { confirmed } = verificationBodySchema.parse(req.body);
    const record = await deps.service.verifyField(req.params.id, field, confirmed, actorOf(req));
    res.json(record);
  });

  router.post("/tors/:id/approve", async (req, res) => {
    const { edits } = editsBodySchema.parse(req.body ?? {});
    await deps.service.approve(req.params.id, edits, actorOf(req));
    res.json({ id: req.params.id, unverified: false });
  });

  // One action over many TORs. Each goes through the same service call as the
  // single-TOR routes, so every one keeps its own history and audit entry; a
  // TOR that cannot take the action is reported, not allowed to stop the rest.
  const bulkSchema = z.object({
    action: z.enum(["reextract", "reject", "restore"]),
    ids: z.array(z.string().regex(/^[0-9a-f]{24}$/i)).min(1, "ยังไม่ได้เลือกรายการ").max(deps.bulkMax, `เลือกได้ไม่เกิน ${deps.bulkMax} รายการต่อครั้ง`),
    reason: z.string().trim().min(3).max(300).optional(),
  }).strict().refine((body) => body.action !== "reject" || body.reason, { message: "ต้องระบุเหตุผลในการถอดจากหน้าสาธารณะ", path: ["reason"] });
  router.post("/tors/bulk", async (req, res) => {
    const { action, ids, reason } = bulkSchema.parse(req.body);
    res.json(await deps.service.bulk(action, [...new Set(ids)], reason, actorOf(req)));
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

  router.post("/tors/:id/restore", async (req, res) => {
    await deps.service.restore(req.params.id, actorOf(req));
    res.json({ id: req.params.id, restricted: false });
  });

  return router;
}
