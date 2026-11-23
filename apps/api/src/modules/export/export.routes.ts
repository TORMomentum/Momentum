import { Router } from "express";
import type { Config } from "../../core/config.js";
import { UnauthorizedError } from "../../core/errors.js";
import { publicRateLimit } from "../../core/public-rate-limit.js";
import { calendarDate } from "../../lib/calendar-date.js";
import type { BehaviourRepository } from "../behaviour/behaviour.repository.js";
import type { MatchingRepository } from "../matching/matching.repository.js";
import type { ProfileRepository } from "../profile/profile.repository.js";
import { matchIdsFor } from "../tors/tors.match-filter.js";
import { parseSearchQuery } from "../tors/tors.query.js";
import type { ExportService } from "./export.service.js";

export interface ExportRouterDeps {
  service: ExportService;
  config: Config;
  profiles: ProfileRepository;
  matching: MatchingRepository;
  behaviour?: BehaviourRepository;
}

/** Public CSV export of the filtered TOR list (FR-E-7, spec 2026-11-23). */
export function buildExportRouter(deps: ExportRouterDeps): Router {
  const router = Router();
  const limit = publicRateLimit(deps.config.export.rateLimitPerMin);

  router.get("/tors.csv", limit, async (req, res) => {
    // The same schema as GET /tors: a malformed filter is a 400, never an operator in a query.
    // cursor and pageSize are parsed (so they are still validated) and then ignored.
    const { filter } = parseSearchQuery(req.query, deps.config.search);
    let matchIds;
    if (filter.minMatch !== undefined || filter.maxMatch !== undefined) {
      if (!req.auth) throw new UnauthorizedError();
      matchIds = await matchIdsFor(deps, req.auth.account._id.toString(), filter.minMatch, filter.maxMatch);
    }

    const file = await deps.service.csv({ filter }, matchIds);
    const day = calendarDate(new Date(), deps.config.search.timeZone);
    res.set({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="tor-radar-${day}.csv"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Export-Total": String(file.total),
      "X-Export-Truncated": String(file.truncated),
    });
    // The body is CSV served as text/csv with nosniff and as an attachment, so a browser downloads it and
    // never renders it as HTML; cells are RFC 4180-quoted and formula-guarded in export.csv.ts.
    // nosemgrep: javascript.express.security.audit.xss.direct-response-write.direct-response-write -- CSV download, not HTML: text/csv + nosniff + attachment
    res.send(file.csv);
  });

  return router;
}
