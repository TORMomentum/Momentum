import { Router } from "express";
import { z } from "zod";
import { authRateLimit } from "../../core/auth-rate-limit.js";
import type { Config } from "../../core/config.js";
import { NotFoundError, UnauthorizedError } from "../../core/errors.js";
import { requireSameOrigin } from "../../core/require-same-origin.js";
import { TorsRepository } from "../tors/tors.repository.js";
import { BookmarksRepository } from "./bookmarks.repository.js";

const paramsSchema = z.object({ torId: z.string().regex(/^[0-9a-f]{24}$/i) });
const idsSchema = z.object({ torId: z.union([z.string(), z.array(z.string())]).optional() });

export function buildBookmarksRouter(deps: { config: Config; bookmarks: BookmarksRepository; tors: TorsRepository }): Router {
  const router = Router();
  const writes = [requireSameOrigin(deps.config.appOrigin), ...authRateLimit(deps.config)];

  router.get("/me/bookmarks", async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const saved = await deps.bookmarks.listFor(req.auth.account._id.toString());
    const rows = await deps.tors.bookmarkRows(saved.map((bookmark) => bookmark.torId));
    const byId = new Map(rows.map((row) => [row.id, row]));
    // Preserve save order while silently omitting a record that a takedown has
    // made unavailable; a bookmark never widens access to a TOR.
    res.json(saved.flatMap((bookmark) => {
      const row = byId.get(bookmark.torId);
      return row ? [{ ...row, savedAt: bookmark.createdAt.toISOString() }] : [];
    }));
  });

  router.get("/me/bookmarks/ids", async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const input = idsSchema.parse(req.query);
    const torIds = input.torId === undefined ? [] : Array.isArray(input.torId) ? input.torId : [input.torId];
    res.json({ ids: await deps.bookmarks.idsFor(req.auth.account._id.toString(), torIds) });
  });

  router.put("/me/bookmarks/:torId", ...writes, async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const { torId } = paramsSchema.parse(req.params);
    if (!await deps.tors.exists(torId)) throw new NotFoundError();
    await deps.bookmarks.add(req.auth.account._id.toString(), torId);
    res.json({ ok: true });
  });

  router.delete("/me/bookmarks/:torId", ...writes, async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const { torId } = paramsSchema.parse(req.params);
    await deps.bookmarks.remove(req.auth.account._id.toString(), torId);
    res.json({ ok: true });
  });
  return router;
}
